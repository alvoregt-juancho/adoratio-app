const express = require('express');
const prisma = require('../db');
const { requirePermission, PRIV } = require('../middleware/auth');
const { writeAudit } = require('../utils/audit');
const { todayStr } = require('../utils/dates');
const { weekdayFromDate, filterSlotsForDate } = require('../utils/schedule');
const { checkTimelineGaps, GAP_STATUS } = require('../utils/timeline');
const {
    commitmentAppliesOn,
    dateRangeForView,
    weekdayShortLabel,
} = require('../utils/commitmentMatch');
const {
    serializeCaptainRange,
    formatCaptainRangeLabel,
    filterCalendarDaysForCaptain,
    syncCaptainOpenSlotAlerts,
    slotMatchesCaptainScope,
} = require('../utils/captainScope');

const router = express.Router();

function parseRangeBody(body) {
    const userId = Number(body.userId);
    const dayOfWeek =
        body.dayOfWeek === null || body.dayOfWeek === '' || body.dayOfWeek === undefined
            ? null
            : Number(body.dayOfWeek);
    const startTime = String(body.startTime || '').trim();
    const endTime = String(body.endTime || '').trim();
    const label = body.label ? String(body.label).trim() : null;

    if (!userId) return { error: 'Selecciona un usuario.' };
    if (!startTime || !endTime) return { error: 'Hora de inicio y fin son requeridas.' };
    if (dayOfWeek != null && (dayOfWeek < 1 || dayOfWeek > 7)) {
        return { error: 'Día inválido (1=Lun … 7=Dom).' };
    }
    return { userId, dayOfWeek, startTime, endTime, label };
}

// ── Contexto del capitán actual ───────────────────────────────────────
router.get('/context', requirePermission(PRIV.CAPTAIN_VIEW), async (req, res) => {
    try {
        res.json({
            isScopedCaptain: !!req.isScopedCaptain,
            ranges: (req.captainRanges || []).map(serializeCaptainRange),
        });
    } catch (e) {
        console.error(e);
        res.status(500).json({ error: 'Error al obtener contexto.' });
    }
});

// ── Asignaciones (admin ve todas; capitán solo las suyas) ───────────
router.get('/ranges', async (req, res) => {
    try {
        const canAssign = (req.user.privileges & PRIV.CAPTAIN_ASSIGN) === PRIV.CAPTAIN_ASSIGN;
        const canView = (req.user.privileges & PRIV.CAPTAIN_VIEW) === PRIV.CAPTAIN_VIEW;
        if (!canAssign && !canView) {
            return res.status(403).json({ error: 'Sin permisos.' });
        }

        const where = { isActive: true };
        if (!canAssign || req.query.mine === '1') {
            where.userId = req.user.id;
        }

        const ranges = await prisma.captainRange.findMany({
            where,
            include: { user: { select: { id: true, name: true, email: true } } },
            orderBy: [{ user: { name: 'asc' } }, { dayOfWeek: 'asc' }, { startTime: 'asc' }],
        });

        res.json({
            ranges: ranges.map(serializeCaptainRange),
            total: ranges.length,
        });
    } catch (e) {
        console.error(e);
        res.status(500).json({ error: 'Error al listar asignaciones.' });
    }
});

router.post('/ranges', requirePermission(PRIV.CAPTAIN_ASSIGN), async (req, res) => {
    try {
        const parsed = parseRangeBody(req.body || {});
        if (parsed.error) return res.status(400).json({ error: parsed.error });

        const user = await prisma.user.findUnique({ where: { id: parsed.userId } });
        if (!user) return res.status(404).json({ error: 'Usuario no encontrado.' });

        const range = await prisma.captainRange.create({
            data: {
                userId: parsed.userId,
                dayOfWeek: parsed.dayOfWeek,
                startTime: parsed.startTime,
                endTime: parsed.endTime,
                label: parsed.label || formatCaptainRangeLabel(parsed),
            },
            include: { user: { select: { id: true, name: true, email: true } } },
        });

        await writeAudit({
            action: 'captain.assign',
            entity: 'captain_range',
            entityId: range.id,
            targetUserId: parsed.userId,
            meta: { label: range.label, dayOfWeek: range.dayOfWeek },
            req,
        });

        res.status(201).json({
            message: 'Capitán asignado.',
            range: serializeCaptainRange(range),
        });
    } catch (e) {
        console.error(e);
        res.status(500).json({ error: 'Error al asignar capitán.' });
    }
});

router.put('/ranges/:id', requirePermission(PRIV.CAPTAIN_ASSIGN), async (req, res) => {
    try {
        const id = Number(req.params.id);
        const existing = await prisma.captainRange.findUnique({ where: { id } });
        if (!existing) return res.status(404).json({ error: 'Asignación no encontrada.' });

        const parsed = parseRangeBody({ ...existing, ...req.body });
        if (parsed.error) return res.status(400).json({ error: parsed.error });

        const range = await prisma.captainRange.update({
            where: { id },
            data: {
                userId: parsed.userId,
                dayOfWeek: parsed.dayOfWeek,
                startTime: parsed.startTime,
                endTime: parsed.endTime,
                label: parsed.label || formatCaptainRangeLabel(parsed),
            },
            include: { user: { select: { id: true, name: true, email: true } } },
        });

        await writeAudit({
            action: 'captain.update',
            entity: 'captain_range',
            entityId: id,
            targetUserId: range.userId,
            req,
        });

        res.json({ message: 'Asignación actualizada.', range: serializeCaptainRange(range) });
    } catch (e) {
        console.error(e);
        res.status(500).json({ error: 'Error al actualizar asignación.' });
    }
});

router.delete('/ranges/:id', requirePermission(PRIV.CAPTAIN_ASSIGN), async (req, res) => {
    try {
        const id = Number(req.params.id);
        const existing = await prisma.captainRange.findUnique({ where: { id } });
        if (!existing) return res.status(404).json({ error: 'Asignación no encontrada.' });

        await prisma.captainRange.update({
            where: { id },
            data: { isActive: false },
        });

        await writeAudit({
            action: 'captain.unassign',
            entity: 'captain_range',
            entityId: id,
            targetUserId: existing.userId,
            req,
        });

        res.json({ message: 'Asignación eliminada.' });
    } catch (e) {
        console.error(e);
        res.status(500).json({ error: 'Error al eliminar asignación.' });
    }
});

// ── Panel del capitán ─────────────────────────────────────────────────
router.get('/dashboard', requirePermission(PRIV.CAPTAIN_VIEW), async (req, res) => {
    try {
        const ranges = req.captainRanges || [];
        if (!ranges.length) {
            return res.json({
                ranges: [],
                summary: { openSlots: 0, gapAlerts: 0, adorers: 0, unreadNotifications: 0 },
                days: [],
                notifications: [],
                adorers: [],
            });
        }

        await syncCaptainOpenSlotAlerts(req.user.id, ranges);

        const anchor = req.query.start || todayStr();
        const view = req.query.view === 'month' ? 'month' : 'week';
        const calRange = dateRangeForView(view, anchor);

        const [allSlots, reservations, notifications] = await Promise.all([
            prisma.slot.findMany({ where: { isActive: true }, orderBy: { startTime: 'asc' } }),
            prisma.reservation.findMany({
                where: { status: { in: ['confirmed', 'completed'] } },
                include: { slot: true },
            }),
            prisma.captainNotification.findMany({
                where: { captainUserId: req.user.id },
                orderBy: [{ isRead: 'asc' }, { isUrgent: 'desc' }, { createdAt: 'desc' }],
                take: 50,
            }),
        ]);

        let openSlots = 0;
        let gapAlerts = 0;
        const adorerPhones = new Map();

        const days = calRange.dates.map((dateStr) => {
            const weekday = weekdayFromDate(dateStr);
            const { slots: eligible } = filterSlotsForDate(allSlots, dateStr);

            const slotBlocks = eligible
                .filter((slot) =>
                    ranges.some((r) => slotMatchesCaptainScope(weekday, slot.startTime, [r]))
                )
                .map((slot) => {
                    const commitments = reservations
                        .filter((r) => r.slotId === slot.id && commitmentAppliesOn(r, dateStr))
                        .map((r) => ({
                            id: r.id,
                            userName: r.userName,
                            userPhone: r.userPhone,
                        }));

                    commitments.forEach((c) => {
                        if (c.userPhone) adorerPhones.set(c.userPhone, c.userName);
                    });

                    const gapStatus = checkTimelineGaps(
                        reservations
                            .filter((r) => r.slotId === slot.id && commitmentAppliesOn(r, dateStr))
                            .map((r) => ({
                                startTimeOffset: r.startTimeOffset,
                                durationMinutes: r.durationMinutes,
                            }))
                    );
                    const taken = commitments.length;
                    const available = Math.max(0, slot.capacity - taken);
                    if (available > 0) openSlots += available;
                    if (gapStatus === GAP_STATUS.CRITICAL_GAP) gapAlerts += 1;

                    return {
                        slotId: slot.id,
                        startTime: slot.startTime,
                        endTime: slot.endTime,
                        capacity: slot.capacity,
                        taken,
                        available,
                        gapAlert: gapStatus === GAP_STATUS.CRITICAL_GAP,
                        commitments,
                    };
                });

            return {
                date: dateStr,
                weekday,
                label: weekdayShortLabel(dateStr),
                slots: slotBlocks,
            };
        });

        const scopedDays = filterCalendarDaysForCaptain(days, ranges);
        const unread = notifications.filter((n) => !n.isRead).length;

        res.json({
            ranges: ranges.map(serializeCaptainRange),
            summary: {
                openSlots,
                gapAlerts,
                adorers: adorerPhones.size,
                unreadNotifications: unread,
            },
            days: scopedDays,
            notifications: notifications.map((n) => ({
                id: n.id,
                type: n.type,
                title: n.title,
                message: n.message,
                occurrenceDate: n.occurrenceDate,
                isRead: n.isRead,
                isUrgent: n.isUrgent,
                createdAt: n.createdAt,
            })),
            adorers: [...adorerPhones.entries()].map(([phone, userName]) => ({ phone, userName })),
        });
    } catch (e) {
        console.error(e);
        res.status(500).json({ error: 'Error al cargar panel de capitán.' });
    }
});

router.get('/notifications', requirePermission(PRIV.CAPTAIN_VIEW), async (req, res) => {
    try {
        const notifications = await prisma.captainNotification.findMany({
            where: { captainUserId: req.user.id },
            orderBy: [{ isRead: 'asc' }, { createdAt: 'desc' }],
            take: 100,
        });
        res.json({ notifications });
    } catch (e) {
        console.error(e);
        res.status(500).json({ error: 'Error al obtener notificaciones.' });
    }
});

router.patch('/notifications/:id/read', requirePermission(PRIV.CAPTAIN_VIEW), async (req, res) => {
    try {
        const id = Number(req.params.id);
        const notif = await prisma.captainNotification.findFirst({
            where: { id, captainUserId: req.user.id },
        });
        if (!notif) return res.status(404).json({ error: 'Notificación no encontrada.' });
        const updated = await prisma.captainNotification.update({
            where: { id },
            data: { isRead: true },
        });
        res.json({ notification: updated });
    } catch (e) {
        console.error(e);
        res.status(500).json({ error: 'Error al marcar notificación.' });
    }
});

router.post('/notifications/read-all', requirePermission(PRIV.CAPTAIN_VIEW), async (req, res) => {
    try {
        await prisma.captainNotification.updateMany({
            where: { captainUserId: req.user.id, isRead: false },
            data: { isRead: true },
        });
        res.json({ message: 'Notificaciones marcadas como leídas.' });
    } catch (e) {
        console.error(e);
        res.status(500).json({ error: 'Error al actualizar notificaciones.' });
    }
});

router.get('/adoradores-phones', requirePermission(PRIV.CAPTAIN_VIEW), async (req, res) => {
    try {
        const ranges = req.captainRanges || [];
        const reservations = await prisma.reservation.findMany({
            where: { status: { in: ['confirmed', 'completed'] } },
            include: { slot: true },
        });
        const { filterReservationsForCaptain } = require('../utils/captainScope');
        const scoped = filterReservationsForCaptain(reservations, ranges);
        const phones = [...new Set(scoped.map((r) => r.userPhone).filter(Boolean))];
        res.json({ phones, total: phones.length });
    } catch (e) {
        console.error(e);
        res.status(500).json({ error: 'Error al obtener teléfonos.' });
    }
});

router.get('/assignable-users', requirePermission(PRIV.CAPTAIN_ASSIGN), async (req, res) => {
    try {
        const users = await prisma.user.findMany({
            where: { adminRoleId: { not: null } },
            include: { adminRole: true },
            orderBy: { name: 'asc' },
            take: 200,
        });
        res.json({
            users: users.map((u) => ({
                id: u.id,
                name: u.name,
                email: u.email,
                adminRoleName: u.adminRole?.name ?? null,
            })),
        });
    } catch (e) {
        console.error(e);
        res.status(500).json({ error: 'Error al listar usuarios.' });
    }
});

module.exports = router;
