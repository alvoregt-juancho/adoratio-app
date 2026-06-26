const {
    normalizeWeekDaysInput,
    slotWeekDaysList,
    intersectWeekDays,
    subtractWeekDays,
    scopeCoversEntireSlot,
    weekDaysOverlap,
    parseWeekDays,
} = require('./slotWeekDays');

async function findTimeConflict(prisma, { startTime, endTime, weekDays, excludeId }) {
    const rows = await prisma.slot.findMany({
        where: {
            startTime,
            endTime,
            ...(excludeId ? { id: { not: excludeId } } : {}),
        },
    });
    return rows.find((row) => weekDaysOverlap(row.weekDays, weekDays));
}

async function applyScopedSlotDelete(prisma, slot, scopeRaw) {
    const scope = parseWeekDays(scopeRaw);
    if (!scope.length || scopeCoversEntireSlot(slot, scope)) {
        return { action: 'delete', slotId: slot.id };
    }

    const remaining = subtractWeekDays(slot.weekDays, scope);
    const remainingList = parseWeekDays(remaining);
    if (!remainingList.length) {
        return { action: 'delete', slotId: slot.id };
    }

    return { action: 'trim', slotId: slot.id, weekDays: remaining };
}

async function applyScopedSlotDeactivate(prisma, slot, scopeRaw) {
    const scope = parseWeekDays(scopeRaw);
    if (!scope.length || scopeCoversEntireSlot(slot, scope)) {
        const updated = await prisma.slot.update({
            where: { id: slot.id },
            data: { isActive: false },
        });
        return { action: 'deactivated', slot: updated };
    }

    const affected = intersectWeekDays(slot.weekDays, scope);
    if (!affected.length) {
        throw new Error('SCOPE_MISMATCH');
    }

    const remaining = subtractWeekDays(slot.weekDays, scope);
    const affectedKey = normalizeWeekDaysInput(affected);

    const existingInactive = await prisma.slot.findFirst({
        where: {
            startTime: slot.startTime,
            endTime: slot.endTime,
            capacity: slot.capacity,
            isActive: false,
            weekDays: affectedKey,
            id: { not: slot.id },
        },
    });

    const [updatedActive] = await prisma.$transaction([
        prisma.slot.update({
            where: { id: slot.id },
            data: { weekDays: remaining },
        }),
        existingInactive
            ? Promise.resolve(existingInactive)
            : prisma.slot.create({
                data: {
                    startTime: slot.startTime,
                    endTime: slot.endTime,
                    capacity: slot.capacity,
                    label: slot.label,
                    weekDays: affectedKey,
                    isActive: false,
                },
            }),
    ]);

    return { action: 'split_deactivate', slot: updatedActive };
}

async function applyScopedSlotActivate(prisma, slot) {
    if (slot.isActive) return { action: 'noop', slot };

    const activeSibling = await prisma.slot.findFirst({
        where: {
            startTime: slot.startTime,
            endTime: slot.endTime,
            isActive: true,
            id: { not: slot.id },
        },
    });

    if (activeSibling) {
        const merged = [
            ...new Set([...slotWeekDaysList(activeSibling), ...slotWeekDaysList(slot)]),
        ].sort((a, b) => a - b);
        const [mergedSlot] = await prisma.$transaction([
            prisma.slot.update({
                where: { id: activeSibling.id },
                data: { weekDays: normalizeWeekDaysInput(merged) },
            }),
            prisma.slot.delete({ where: { id: slot.id } }),
        ]);
        return { action: 'merged_activate', slot: mergedSlot };
    }

    const updated = await prisma.slot.update({
        where: { id: slot.id },
        data: { isActive: true },
    });
    return { action: 'activated', slot: updated };
}

module.exports = {
    findTimeConflict,
    applyScopedSlotDelete,
    applyScopedSlotDeactivate,
    applyScopedSlotActivate,
};
