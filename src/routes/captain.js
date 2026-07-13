const express = require('express');
const prisma = require('../db');
const config = require('../config');
const { requirePermission, PRIV } = require('../middleware/auth');
const { hasPermission } = require('../constants/permissions');
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
    filterReservationsForCaptain,
    syncCaptainOpenSlotAlerts,
    slotMatchesCaptainScope,
    findOverlappingCaptainRange,
    findConflictingCaptainBlock,
    occurrenceMatchesCaptainScope,
} = require('../utils/captainScope');
const { parseTimeInput, formatTimeRange12 } = require('../utils/timeFormat');

const router = express.Router();

const rangeInclude = {
    user: {
        select: {
            id: true,
            name: true,
            email: true,
            adminRole: { select: { name: true, privileges: true } },
        },
    },
    createdBy: { select: { id: true, name: true } },
    updatedBy: { select: { id: true, name: true } },
};

function parseRangeBody(body) {
    const userId = Number(body.userId);
    const dayOfWeek =
        body.dayOfWeek === null || body.dayOfWeek === '' || body.dayOfWeek === undefined
            ? null
            : Number(body.dayOfWeek);
    const startRaw = String(body.startTime || '').trim();
    const endRaw = String(body.endTime || '').trim();
    const startTime = parseTimeInput(startRaw);
    const endTime = parseTimeInput(endRaw);
    const label = body.label ? String(body.label).trim() : null;

    if (!userId) return { error: 'Selecciona un usuario.' };
    if (!startRaw || !endRaw) return { error: 'Hora de inicio y fin son requeridas.' };
    if (!startTime || !endTime) {
        return { error: 'Hora inválida. Usa formato estándar, ej. 7:00 AM.' };
    }
    if (dayOfWeek != null && (dayOfWeek < 1 || dayOfWeek > 7)) {
        return { error: 'Día inválido (1=Lun … 7=Dom).' };
    }
    if (startTime === endTime) {
        return { error: 'La hora de fin debe ser distinta a la de inicio.' };
    }
    return { userId, dayOfWeek, startTime, endTime, label, isActive: true };
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
            include: rangeInclude,
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

        const user = await prisma.user.findUnique({
            where: { id: parsed.userId },
            include: { adminRole: true },
        });
        if (!user) return res.status(404).json({ error: 'Usuario no encontrado.' });
        if (!user.adminRole || !hasPermission(user.adminRole.privileges, PRIV.CAPTAIN_VIEW)) {
            return res.status(400).json({
                error: 'El usuario debe tener un perfil con permiso de capitán (CAPTAIN_VIEW).',
            });
        }

        const overlap = await findOverlappingCaptainRange(parsed);
        if (overlap) {
            return res.status(409).json({
                error: 'Ya existe una franja solapada para este capitán en el mismo día y horario.',
            });
        }

        const blockConflict = await findConflictingCaptainBlock(parsed);
        if (blockConflict) {
            return res.status(409).json({
                error: `Este bloque ya está asignado a ${blockConflict.user?.name || 'otro capitán'}.`,
            });
        }

        const range = await prisma.captainRange.create({
            data: {
                userId: parsed.userId,
                dayOfWeek: parsed.dayOfWeek,
                startTime: parsed.startTime,
                endTime: parsed.endTime,
                label: parsed.label || formatCaptainRangeLabel(parsed),
                createdById: req.user.id,
                updatedById: req.user.id,
            },
            include: rangeInclude,
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

        const user = await prisma.user.findUnique({
            where: { id: parsed.userId },
            include: { adminRole: true },
        });
        if (!user) return res.status(404).json({ error: 'Usuario no encontrado.' });
        if (!user.adminRole || !hasPermission(user.adminRole.privileges, PRIV.CAPTAIN_VIEW)) {
            return res.status(400).json({
                error: 'El usuario debe tener un perfil con permiso de capitán (CAPTAIN_VIEW).',
            });
        }

        const overlap = await findOverlappingCaptainRange(parsed, id);
        if (overlap) {
            return res.status(409).json({
                error: 'Ya existe una franja solapada para este capitán en el mismo día y horario.',
            });
        }

        const blockConflict = await findConflictingCaptainBlock(parsed, id);
        if (blockConflict) {
            return res.status(409).json({
                error: `Este bloque ya está asignado a ${blockConflict.user?.name || 'otro capitán'}.`,
            });
        }

        const range = await prisma.captainRange.update({
            where: { id },
            data: {
                userId: parsed.userId,
                dayOfWeek: parsed.dayOfWeek,
                startTime: parsed.startTime,
                endTime: parsed.endTime,
                label: parsed.label || formatCaptainRangeLabel(parsed),
                updatedById: req.user.id,
            },
            include: rangeInclude,
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
            data: { isActive: false, updatedById: req.user.id },
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
                summary: {
                    openSlots: 0,
                    gapAlerts: 0,
                    adorers: 0,
                    unreadNotifications: 0,
                    pendingSubstitutions: 0,
                },
                days: [],
                notifications: [],
                adorers: [],
            });
        }

        await syncCaptainOpenSlotAlerts(req.user.id, ranges);

        const anchor = req.query.start || todayStr();
        const view = req.query.view === 'month' ? 'month' : 'week';
        const calRange = dateRangeForView(view, anchor);

        const [allSlots, reservations, notifications, pendingSubs] = await Promise.all([
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
            prisma.substitutionRequest.count({
                where: { captainUserId: req.user.id, status: 'pending' },
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
                            status: r.status,
                            checkedInAt: r.checkedInAt,
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
                pendingSubstitutions: pendingSubs,
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
                reservationId: n.reservationId,
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
        const scoped = filterReservationsForCaptain(reservations, ranges);
        const phones = [...new Set(scoped.map((r) => r.userPhone).filter(Boolean))];
        res.json({ phones, total: phones.length });
    } catch (e) {
        console.error(e);
        res.status(500).json({ error: 'Error al obtener teléfonos.' });
    }
});

router.post('/notify-block', requirePermission(PRIV.CAPTAIN_VIEW), async (req, res) => {
    try {
        const ranges = req.captainRanges || [];
        if (!ranges.length) {
            return res.status(400).json({ error: 'No tienes bloques asignados.' });
        }

        const customMessage = req.body?.message ? String(req.body.message).trim() : '';
        const reservations = await prisma.reservation.findMany({
            where: { status: { in: ['confirmed', 'completed'] } },
            include: { slot: true },
        });
        const scoped = filterReservationsForCaptain(reservations, ranges);
        const adorers = [...new Map(
            scoped.map((r) => [r.userPhone, { phone: r.userPhone, name: r.userName }])
        ).values()].filter((a) => a.phone);

        const openAlerts = await prisma.captainNotification.findMany({
            where: {
                captainUserId: req.user.id,
                isRead: false,
                type: { in: ['open_slot', 'urgent_open'] },
            },
            take: 5,
        });

        const defaultMsg =
            openAlerts.length > 0
                ? `Hola, soy capitán de adoración. ${openAlerts[0].message}`
                : 'Hola, soy capitán de adoración. Recordatorio de guardia en nuestro bloque horario.';
        const message = customMessage || defaultMsg;

        const whatsappLinks = adorers.map((a) => ({
            phone: a.phone,
            name: a.name,
            url: `https://wa.me/${config.countryCode}${a.phone}?text=${encodeURIComponent(message)}`,
        }));

        res.json({
            message,
            phones: adorers.map((a) => a.phone),
            whatsappLinks,
            smtpAvailable: !!process.env.SMTP_HOST,
        });
    } catch (e) {
        console.error(e);
        res.status(500).json({ error: 'Error al preparar notificación.' });
    }
});

router.get('/intentions', requirePermission(PRIV.CAPTAIN_VIEW), async (req, res) => {
    try {
        const ranges = req.captainRanges || [];
        const status = req.query.status || 'active';

        const intentions = await prisma.prayerIntention.findMany({
            where: status === 'all' ? {} : { status },
            orderBy: { createdAt: 'desc' },
            take: 100,
            include: {
                assignedToReservation: {
                    include: { slot: true },
                },
            },
        });

        const scoped = intentions.filter((intention) => {
            const reservation = intention.assignedToReservation;
            if (!reservation?.slot) return false;
            if (reservation.date) {
                return occurrenceMatchesCaptainScope(
                    reservation.date,
                    reservation.slot.startTime,
                    ranges
                );
            }
            return filterReservationsForCaptain([reservation], ranges).length > 0;
        });

        res.json({
            intentions: scoped.map((i) => ({
                id: i.id,
                text: i.text,
                displayName: i.displayName,
                status: i.status,
                createdAt: i.createdAt,
                reservation: i.assignedToReservation
                    ? {
                        id: i.assignedToReservation.id,
                        userName: i.assignedToReservation.userName,
                        date: i.assignedToReservation.date,
                        slot: formatTimeRange12(
                            i.assignedToReservation.slot.startTime,
                            i.assignedToReservation.slot.endTime,
                            '–'
                        ),
                    }
                    : null,
            })),
        });
    } catch (e) {
        console.error(e);
        res.status(500).json({ error: 'Error al obtener intenciones del bloque.' });
    }
});

// ── Sustituciones formales ────────────────────────────────────────────
router.get('/substitutions', requirePermission(PRIV.CAPTAIN_VIEW), async (req, res) => {
    try {
        const status = req.query.status || 'pending';
        const where = { captainUserId: req.user.id };
        if (status !== 'all') where.status = status;

        const rows = await prisma.substitutionRequest.findMany({
            where,
            include: {
                reservation: { include: { slot: true } },
            },
            orderBy: [{ status: 'asc' }, { createdAt: 'desc' }],
            take: 100,
        });

        res.json({
            substitutions: rows.map((row) => ({
                id: row.id,
                status: row.status,
                occurrenceDate: row.occurrenceDate,
                requestedByName: row.requestedByName,
                substituteName: row.substituteName,
                substitutePhone: row.substitutePhone,
                notes: row.notes,
                reviewedAt: row.reviewedAt,
                createdAt: row.createdAt,
                reservation: row.reservation
                    ? {
                        id: row.reservation.id,
                        userName: row.reservation.userName,
                        userPhone: row.reservation.userPhone,
                        slot: formatTimeRange12(
                            row.reservation.slot.startTime,
                            row.reservation.slot.endTime,
                            '–'
                        ),
                    }
                    : null,
            })),
        });
    } catch (e) {
        console.error(e);
        res.status(500).json({ error: 'Error al listar sustituciones.' });
    }
});

router.post('/substitutions/:id/approve', requirePermission(PRIV.CAPTAIN_VIEW), async (req, res) => {
    try {
        const id = Number(req.params.id);
        const row = await prisma.substitutionRequest.findFirst({
            where: { id, captainUserId: req.user.id },
            include: { reservation: { include: { slot: true } } },
        });
        if (!row) return res.status(404).json({ error: 'Solicitud no encontrada.' });
        if (row.status !== 'pending') {
            return res.status(400).json({ error: 'Esta solicitud ya fue revisada.' });
        }

        const substituteName = req.body?.substituteName
            ? String(req.body.substituteName).trim()
            : row.substituteName;
        const substitutePhone = req.body?.substitutePhone
            ? String(req.body.substitutePhone).trim()
            : row.substitutePhone;
        const notes = req.body?.notes ? String(req.body.notes).trim() : row.notes;

        const updated = await prisma.substitutionRequest.update({
            where: { id },
            data: {
                status: 'approved',
                substituteName,
                substitutePhone,
                notes,
                reviewedAt: new Date(),
            },
            include: { reservation: { include: { slot: true } } },
        });

        await writeAudit({
            action: 'sub_approved',
            entity: 'substitution_request',
            entityId: id,
            reservationId: row.reservationId,
            targetUserId: req.user.id,
            meta: {
                occurrenceDate: row.occurrenceDate,
                substituteName,
                substitutePhone,
                requestedByName: row.requestedByName,
            },
            req,
        });

        res.json({ message: 'Sustitución aprobada.', substitution: updated });
    } catch (e) {
        console.error(e);
        res.status(500).json({ error: 'Error al aprobar sustitución.' });
    }
});

router.post('/substitutions/:id/reject', requirePermission(PRIV.CAPTAIN_VIEW), async (req, res) => {
    try {
        const id = Number(req.params.id);
        const row = await prisma.substitutionRequest.findFirst({
            where: { id, captainUserId: req.user.id },
        });
        if (!row) return res.status(404).json({ error: 'Solicitud no encontrada.' });
        if (row.status !== 'pending') {
            return res.status(400).json({ error: 'Esta solicitud ya fue revisada.' });
        }

        const notes = req.body?.notes ? String(req.body.notes).trim() : null;
        const updated = await prisma.substitutionRequest.update({
            where: { id },
            data: { status: 'rejected', notes, reviewedAt: new Date() },
        });

        await writeAudit({
            action: 'sub_rejected',
            entity: 'substitution_request',
            entityId: id,
            reservationId: row.reservationId,
            targetUserId: req.user.id,
            meta: { occurrenceDate: row.occurrenceDate, notes },
            req,
        });

        res.json({ message: 'Solicitud rechazada.', substitution: updated });
    } catch (e) {
        console.error(e);
        res.status(500).json({ error: 'Error al rechazar sustitución.' });
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
            users: users
                .filter((u) => u.adminRole && hasPermission(u.adminRole.privileges, PRIV.CAPTAIN_VIEW))
                .map((u) => ({
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
