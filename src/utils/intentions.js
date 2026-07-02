const prisma = require('../db');
const { normalizePhone, isValidPhone } = require('./phone');

function anonymizeName(fullName) {
    const parts = (fullName || '').trim().split(/\s+/).filter(Boolean);
    if (!parts.length) return 'Un hermano en la fe';
    if (parts.length === 1) {
        const n = parts[0];
        return n.length <= 2 ? 'Un hermano en la fe' : n.charAt(0).toUpperCase() + '.';
    }
    const initials = parts.map((p) => p.charAt(0).toUpperCase() + '.').join('');
    return initials.length <= 5 ? initials : 'Un hermano en la fe';
}

function formatIntentionPayload(intention) {
    if (!intention) return null;
    return {
        id: intention.id,
        text: intention.text,
        displayName: intention.displayName || 'Un hermano en la fe',
        createdAt: intention.createdAt,
    };
}

async function markIntentionPrayedById(intentionId) {
    const existing = await prisma.prayerIntention.findUnique({ where: { id: intentionId } });
    if (!existing || existing.status === 'prayed') return existing;
    return prisma.prayerIntention.update({
        where: { id: intentionId },
        data: { status: 'prayed', statusUpdatedAt: new Date(), prayedAt: new Date(), deletedAt: null },
    });
}

async function restoreIntentionById(intentionId) {
    const existing = await prisma.prayerIntention.findUnique({ where: { id: intentionId } });
    if (!existing) return null;
    if (existing.status === 'active') return existing;
    return prisma.prayerIntention.update({
        where: { id: intentionId },
        data: { status: 'active', statusUpdatedAt: new Date(), prayedAt: null, deletedAt: null },
    });
}

async function softDeleteIntentionById(intentionId) {
    const existing = await prisma.prayerIntention.findUnique({ where: { id: intentionId } });
    if (!existing) return null;
    return prisma.prayerIntention.update({
        where: { id: intentionId },
        data: { status: 'deleted', statusUpdatedAt: new Date(), deletedAt: new Date(), prayedAt: null },
    });
}

async function markAssignedIntentionPrayed(reservationId) {
    const intention = await prisma.prayerIntention.findFirst({
        where: { assignedToReservationId: reservationId, status: 'active' },
    });
    if (!intention) return null;
    return markIntentionPrayedById(intention.id);
}

async function assignWallIntentionToReservation(reservationId) {
    return prisma.$transaction(async (tx) => {
        const available = await tx.prayerIntention.findFirst({
            where: {
                status: 'active',
                assignedToReservationId: null,
            },
            orderBy: { createdAt: 'asc' },
        });
        if (!available) return null;

        return tx.prayerIntention.update({
            where: { id: available.id },
            data: { assignedToReservationId: reservationId },
        });
    });
}

async function releaseWallIntentionAssignment(reservationId) {
    await prisma.prayerIntention.updateMany({
        where: { assignedToReservationId: reservationId },
        data: { assignedToReservationId: null },
    });
}

module.exports = {
    anonymizeName,
    formatIntentionPayload,
    markIntentionPrayedById,
    restoreIntentionById,
    softDeleteIntentionById,
    markAssignedIntentionPrayed,
    assignWallIntentionToReservation,
    releaseWallIntentionAssignment,
};
