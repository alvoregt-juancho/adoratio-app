const express = require('express');
const PDFDocument = require('pdfkit');
const prisma = require('../db');
const {
    requireAuth,
    attachPrivileges,
    requireAdminAccess,
    requirePermission,
    PRIV,
} = require('../middleware/auth');
const rbacRoutes = require('./rbac');
const qrUtil = require('../utils/qr');
const {
    ensureChapelQr,
    replaceChapelQr,
    formatChapelQrPayload,
} = require('../utils/chapelQr');
const { writeAudit } = require('../utils/audit');
const { normalizeReservationNames, parseParticipantNames } = require('../utils/name');
const { normalizePhone, isValidPhone } = require('../utils/phone');
const { releaseWallIntentionAssignment } = require('../utils/intentions');
const { todayStr } = require('../utils/dates');
const { getSettings } = require('../utils/settings');
const { filterSlotsForDate, weekdayFromDate } = require('../utils/schedule');
const { checkTimelineGaps, hasFractionalCoverage, GAP_STATUS } = require('../utils/timeline');
const {
    commitmentAppliesOn,
    participationWeekdays,
    dateRangeForView,
    weekdayShortLabel,
    resolveReservationScope,
    expandReservationsInRange,
} = require('../utils/commitmentMatch');
const { FREQUENCY_LABELS } = require('../constants/commitment');
const { formatWeekDays } = require('../utils/weekDays');
const {
    rosterMemberMatchesFilter,
    commitmentRowMatchesFilter,
    reservationToCommitmentRows,
    rosterMemberToRow,
    sortRosterRows,
    sortMembersByName,
} = require('../utils/roster');
const { attachCaptainContext, requireCaptainScopeForReservation } = require('../middleware/captainContext');
const {
    filterReservationsForCaptain,
    filterCalendarDaysForCaptain,
    notifyCaptainsSubstituteNeeded,
} = require('../utils/captainScope');
const captainRoutes = require('./captain');

const router = express.Router();

router.use(requireAuth, attachPrivileges, requireAdminAccess, attachCaptainContext);
router.use(rbacRoutes);
router.use('/captain', captainRoutes);

// ── MÉTRICAS / DASHBOARD ──────────────────────────────────────────────
function formatReservationBrief(r) {
    const name = [r.userFirstName, r.userLastName].filter(Boolean).join(' ').trim() || r.userName;
    return {
        id: r.id,
        name,
        phone: r.userPhone,
        slot: `${r.slot.startTime}–${r.slot.endTime}`,
        status: r.status,
        checkedInAt: r.checkedInAt,
    };
}

router.get('/metrics', requirePermission(PRIV.DASHBOARD_VIEW), async (req, res) => {
    try {
        const date = req.query.date || todayStr();
        const dayStart = new Date(`${date}T00:00:00`);
        const dayEnd = new Date(`${date}T23:59:59.999`);

        const [activeSlots, reservations, scansToday] = await Promise.all([
            prisma.slot.findMany({
                where: { isActive: true },
                orderBy: { startTime: 'asc' },
            }),
            prisma.reservation.findMany({
                where: { date, status: { in: ['confirmed', 'completed', 'no_show'] } },
                include: { slot: true },
                orderBy: { slot: { startTime: 'asc' } },
            }),
            prisma.scanLog.findMany({
                where: { scannedAt: { gte: dayStart, lte: dayEnd } },
                include: {
                    reservation: {
                        select: {
                            userName: true,
                            userFirstName: true,
                            userLastName: true,
                            userPhone: true,
                        },
                    },
                },
                orderBy: { scannedAt: 'desc' },
                take: 50,
            }),
        ]);

        const slotsWithReservation = new Set(reservations.map((r) => r.slotId));
        const checkedInRows = reservations.filter((r) => r.checkedInAt);
        const pendingRows = reservations.filter((r) => !r.checkedInAt && r.status === 'confirmed');
        const criticalSlotRows = activeSlots.filter((s) => !slotsWithReservation.has(s.id));

        res.json({
            date,
            totalSlots: activeSlots.length,
            totalReservations: reservations.length,
            checkedIn: checkedInRows.length,
            pending: pendingRows.length,
            criticalSlots: criticalSlotRows.length,
            scansToday: scansToday.length,
            details: {
                activeSlots: activeSlots.map((s) => ({
                    id: s.id,
                    label: s.label,
                    startTime: s.startTime,
                    endTime: s.endTime,
                    capacity: s.capacity,
                })),
                reservationsToday: reservations.map(formatReservationBrief),
                checkedIn: checkedInRows.map(formatReservationBrief),
                pending: pendingRows.map(formatReservationBrief),
                criticalSlots: criticalSlotRows.map((s) => ({
                    id: s.id,
                    label: s.label,
                    startTime: s.startTime,
                    endTime: s.endTime,
                    capacity: s.capacity,
                })),
                scansToday: scansToday.map((s) => {
                    const r = s.reservation;
                    const name = r
                        ? ([r.userFirstName, r.userLastName].filter(Boolean).join(' ').trim() || r.userName)
                        : null;
                    return {
                        id: s.id,
                        scannedAt: s.scannedAt,
                        success: s.success,
                        errorMessage: s.errorMessage,
                        adorerName: name,
                        phone: r?.userPhone ?? null,
                    };
                }),
            },
        });
    } catch (e) {
        console.error(e);
        res.status(500).json({ error: 'Error al obtener métricas.' });
    }
});

// Actividad reciente para el centro de mando
router.get('/activity', requirePermission(PRIV.DASHBOARD_VIEW), async (req, res) => {
    try {
        const limit = Math.min(parseInt(req.query.limit, 10) || 12, 30);
        const [audits, recentReservations] = await Promise.all([
            prisma.auditLog.findMany({
                include: { user: { select: { name: true } } },
                orderBy: { createdAt: 'desc' },
                take: limit,
            }),
            prisma.reservation.findMany({
                where: { date: todayStr() },
                include: { slot: true },
                orderBy: { createdAt: 'desc' },
                take: 8,
            }),
        ]);
        res.json({
            audits: audits.map((a) => ({
                id: a.id,
                action: a.action,
                entity: a.entity,
                actorName: a.user?.name ?? 'Sistema',
                createdAt: a.createdAt,
                meta: a.meta ? JSON.parse(a.meta) : null,
            })),
            recentReservations: recentReservations.map((r) => ({
                id: r.id,
                userFirstName: r.userFirstName,
                userLastName: r.userLastName,
                userName: r.userName,
                slot: r.slot.startTime + '–' + r.slot.endTime,
                status: r.status,
                createdAt: r.createdAt,
            })),
        });
    } catch (e) {
        console.error(e);
        res.status(500).json({ error: 'Error al obtener actividad.' });
    }
});

// ── TURNOS (SLOTS) CRUD ───────────────────────────────────────────────
router.get('/slots', requirePermission(PRIV.SLOTS_VIEW), async (req, res) => {
    const slots = await prisma.slot.findMany({ orderBy: { startTime: 'asc' } });
    res.json({ slots });
});

router.post('/slots', requirePermission(PRIV.SLOTS_CREATE), async (req, res) => {
    try {
        const { startTime, endTime, capacity, label } = req.body || {};
        if (!startTime || !endTime) {
            return res.status(400).json({ error: 'Hora de inicio y fin requeridas.' });
        }
        const slot = await prisma.slot.create({
            data: { startTime, endTime, capacity: Number(capacity) || 4, label: label || null },
        });
        await writeAudit({
            action: 'slot.create',
            entity: 'slot',
            entityId: slot.id,
            meta: { startTime, endTime, capacity: slot.capacity },
            req,
        });
        res.status(201).json({ slot });
    } catch (e) {
        console.error(e);
        res.status(500).json({ error: 'Error al crear el turno.' });
    }
});

router.put('/slots/:id', requirePermission(PRIV.SLOTS_EDIT), async (req, res) => {
    try {
        const id = Number(req.params.id);
        const { startTime, endTime, capacity, label, isActive } = req.body || {};
        const timeRe = /^\d{2}:\d{2}$/;
        if (startTime !== undefined && !timeRe.test(startTime)) {
            return res.status(400).json({ error: 'Hora de inicio inválida (HH:MM).' });
        }
        if (endTime !== undefined && !timeRe.test(endTime)) {
            return res.status(400).json({ error: 'Hora de fin inválida (HH:MM).' });
        }
        const slot = await prisma.slot.update({
            where: { id },
            data: {
                ...(startTime !== undefined && { startTime }),
                ...(endTime !== undefined && { endTime }),
                ...(capacity !== undefined && { capacity: Number(capacity) }),
                ...(label !== undefined && { label }),
                ...(isActive !== undefined && { isActive: Boolean(isActive) }),
            },
        });
        await writeAudit({
            action: 'slot.update',
            entity: 'slot',
            entityId: id,
            meta: { startTime: slot.startTime, endTime: slot.endTime, isActive: slot.isActive },
            req,
        });
        res.json({ slot });
    } catch (e) {
        console.error(e);
        if (e.code === 'P2025') return res.status(404).json({ error: 'Turno no encontrado.' });
        res.status(500).json({ error: 'Error al actualizar el turno.' });
    }
});

router.delete('/slots/:id', requirePermission(PRIV.SLOTS_DELETE), async (req, res) => {
    try {
        const id = Number(req.params.id);
        const existing = await prisma.slot.findUnique({ where: { id } });
        if (!existing) return res.status(404).json({ error: 'Turno no encontrado.' });

        const linked = await prisma.reservation.count({ where: { slotId: id } });
        if (linked > 0) {
            return res.status(409).json({
                error: 'No se puede eliminar: hay reservas asociadas. Desactívalo en su lugar.',
            });
        }

        await prisma.slot.delete({ where: { id } });
        await writeAudit({
            action: 'slot.delete',
            entity: 'slot',
            entityId: id,
            meta: { startTime: existing.startTime, endTime: existing.endTime },
            req,
        });
        res.json({ message: 'Turno eliminado permanentemente.' });
    } catch (e) {
        console.error(e);
        res.status(500).json({ error: 'Error al eliminar el turno.' });
    }
});

// ── RESERVAS ──────────────────────────────────────────────────────────
function buildReservationQueryFilters(query) {
    const where = {};
    if (query.slotId) where.slotId = Number(query.slotId);
    if (query.status) where.status = query.status;
    if (query.firstName) where.userFirstName = { contains: String(query.firstName) };
    if (query.lastName) where.userLastName = { contains: String(query.lastName) };
    if (query.phone) where.userPhone = { contains: String(query.phone) };
    return where;
}

function filterBySlotTime(list, slotTime) {
    if (!slotTime) return list;
    const q = String(slotTime).toLowerCase();
    return list.filter((r) =>
        (r.slot.startTime + '–' + r.slot.endTime).toLowerCase().includes(q)
    );
}

async function fetchReservationsForAdmin(query, req) {
    const scope = resolveReservationScope(query, todayStr());
    const baseWhere = buildReservationQueryFilters(query);

    if (scope.expand) {
        const where = {
            ...baseWhere,
            status: baseWhere.status
                ? baseWhere.status
                : { in: ['confirmed', 'completed', 'no_show'] },
        };
        const reservations = await prisma.reservation.findMany({
            where,
            include: { slot: true, checkedInViaQR: true },
        });
        let list = expandReservationsInRange(
            reservations.map(normalizeReservationNames),
            scope.start,
            scope.end,
        );
        list = filterBySlotTime(list, query.slotTime);
        if (req?.isScopedCaptain) {
            list = filterReservationsForCaptain(list, req.captainRanges);
        }
        return { reservations: list, total: list.length, scope };
    }

    const where = { ...baseWhere };
    if (query.date) where.date = query.date;

    const reservations = await prisma.reservation.findMany({
        where,
        include: { slot: true, checkedInViaQR: true },
        orderBy: [{ date: 'desc' }, { slot: { startTime: 'asc' } }, { userLastName: 'asc' }],
        take: 500,
    });

    let list = reservations.map(normalizeReservationNames);
    list = filterBySlotTime(list, query.slotTime);
    if (req?.isScopedCaptain) {
        list = filterReservationsForCaptain(list, req.captainRanges);
    }
    return { reservations: list, total: list.length, scope: null };
}

router.get('/reservations', requirePermission(PRIV.RESERVATIONS_VIEW), async (req, res) => {
    try {
        const result = await fetchReservationsForAdmin(req.query, req);
        res.json(result);
    } catch (e) {
        console.error(e);
        res.status(500).json({ error: 'Error al obtener reservas.' });
    }
});

router.post('/reservations/:id/checkin', requirePermission(PRIV.RESERVATIONS_CHECKIN), async (req, res) => {
    try {
        const id = Number(req.params.id);
        const reservation = await prisma.reservation.findUnique({ where: { id }, include: { slot: true } });
        if (!reservation) return res.status(404).json({ error: 'Reserva no encontrada.' });
        const scopeErr = requireCaptainScopeForReservation(reservation, req);
        if (scopeErr) return res.status(403).json({ error: scopeErr });
        const updated = await prisma.reservation.update({
            where: { id },
            data: { checkedInAt: new Date(), status: 'completed' },
        });
        await writeAudit({
            action: 'checkin.manual',
            entity: 'reservation',
            entityId: id,
            reservationId: id,
            req,
        });
        res.json({ message: 'Asistencia marcada manualmente.', reservation: updated });
    } catch (e) {
        console.error(e);
        res.status(500).json({ error: 'Error al marcar asistencia.' });
    }
});

router.get('/reservations/:id', requirePermission(PRIV.RESERVATIONS_VIEW), async (req, res) => {
    try {
        const id = Number(req.params.id);
        const reservation = await prisma.reservation.findUnique({
            where: { id },
            include: { slot: true },
        });
        if (!reservation) return res.status(404).json({ error: 'Reserva no encontrada.' });
        res.json({ reservation: normalizeReservationNames(reservation) });
    } catch (e) {
        console.error(e);
        res.status(500).json({ error: 'Error al obtener la reserva.' });
    }
});

router.put('/reservations/:id', requirePermission(PRIV.RESERVATIONS_CHECKIN), async (req, res) => {
    try {
        const id = Number(req.params.id);
        const existing = await prisma.reservation.findUnique({ where: { id }, include: { slot: true } });
        if (!existing) return res.status(404).json({ error: 'Reserva no encontrada.' });
        const scopeErr = requireCaptainScopeForReservation(existing, req);
        if (scopeErr) return res.status(403).json({ error: scopeErr });

        const { first, last, full } = parseParticipantNames(req.body);
        const userPhone = req.body?.userPhone !== undefined ? normalizePhone(req.body.userPhone) : existing.userPhone;
        const status = req.body?.status;
        const slotId = req.body?.slotId !== undefined ? Number(req.body.slotId) : existing.slotId;

        if (req.body?.userPhone !== undefined && !isValidPhone(userPhone)) {
            return res.status(400).json({ error: 'El celular debe tener exactamente 8 dígitos.' });
        }
        if (!first) {
            return res.status(400).json({ error: 'El nombre es requerido.' });
        }
        const allowedStatus = ['confirmed', 'completed', 'cancelled', 'no_show'];
        if (status !== undefined && !allowedStatus.includes(status)) {
            return res.status(400).json({ error: 'Estado inválido.' });
        }
        if (req.body?.slotId !== undefined) {
            const slot = await prisma.slot.findUnique({ where: { id: slotId } });
            if (!slot || !slot.isActive) {
                return res.status(400).json({ error: 'Turno no válido.' });
            }
        }

        const data = {
            userFirstName: first,
            userLastName: last,
            userName: full,
            userPhone,
            slotId,
        };
        if (status !== undefined) data.status = status;

        const updated = await prisma.reservation.update({ where: { id }, data, include: { slot: true } });
        await writeAudit({
            action: 'reservation.update',
            entity: 'reservation',
            entityId: id,
            reservationId: id,
            meta: { userName: updated.userName, status: updated.status },
            req,
        });
        res.json({ message: 'Reserva actualizada.', reservation: normalizeReservationNames(updated) });
    } catch (e) {
        console.error(e);
        res.status(500).json({ error: 'Error al actualizar la reserva.' });
    }
});

router.delete('/reservations/:id', requirePermission(PRIV.RESERVATIONS_CHECKIN), async (req, res) => {
    try {
        const id = Number(req.params.id);
        const existing = await prisma.reservation.findUnique({ where: { id }, include: { slot: true } });
        if (!existing) return res.status(404).json({ error: 'Reserva no encontrada.' });
        const scopeErr = requireCaptainScopeForReservation(existing, req);
        if (scopeErr) return res.status(403).json({ error: scopeErr });

        await releaseWallIntentionAssignment(id);
        const updated = await prisma.reservation.update({
            where: { id },
            data: { status: 'cancelled', cancelledAt: new Date() },
        });
        await notifyCaptainsSubstituteNeeded({ ...existing, status: 'cancelled' });
        await writeAudit({
            action: 'reservation.cancel',
            entity: 'reservation',
            entityId: id,
            reservationId: id,
            meta: { userName: existing.userName },
            req,
        });
        res.json({ message: 'Reserva eliminada (cancelada).', reservation: updated });
    } catch (e) {
        console.error(e);
        res.status(500).json({ error: 'Error al eliminar la reserva.' });
    }
});

// ── MURO DE INTENCIONES ───────────────────────────────────────────────
router.get('/intentions', requirePermission(PRIV.RESERVATIONS_VIEW), async (req, res) => {
    try {
        const status = req.query.status || 'active';
        const where = { visibility: 'wall' };
        if (status !== 'all') where.status = status;

        const intentions = await prisma.prayerIntention.findMany({
            where,
            orderBy: { createdAt: 'desc' },
            take: 200,
            include: {
                reservation: {
                    select: {
                        id: true,
                        userName: true,
                        userPhone: true,
                        date: true,
                        slot: { select: { startTime: true, endTime: true } },
                    },
                },
            },
        });

        res.json({
            intentions: intentions.map((i) => ({
                id: i.id,
                text: i.text,
                displayName: i.displayName,
                userPhone: i.userPhone || i.reservation?.userPhone || null,
                status: i.status,
                createdAt: i.createdAt,
                reservation: i.reservation
                    ? {
                        id: i.reservation.id,
                        userName: i.reservation.userName,
                        date: i.reservation.date,
                        slot: i.reservation.slot.startTime + '–' + i.reservation.slot.endTime,
                    }
                    : null,
            })),
        });
    } catch (e) {
        console.error(e);
        res.status(500).json({ error: 'Error al obtener intenciones.' });
    }
});

router.post('/intentions/:id/prayed', requirePermission(PRIV.RESERVATIONS_CHECKIN), async (req, res) => {
    try {
        const id = Number(req.params.id);
        const existing = await prisma.prayerIntention.findUnique({ where: { id } });
        if (!existing) return res.status(404).json({ error: 'Intención no encontrada.' });

        const updated = await prisma.prayerIntention.update({
            where: { id },
            data: { status: 'prayed' },
        });

        await writeAudit({
            action: 'intention.prayed',
            entity: 'prayer_intention',
            entityId: id,
            meta: { text: existing.text.slice(0, 80) },
            req,
        });

        res.json({ message: 'Intención marcada como orada.', intention: updated });
    } catch (e) {
        console.error(e);
        res.status(500).json({ error: 'Error al actualizar la intención.' });
    }
});

router.put('/intentions/:id', requirePermission(PRIV.RESERVATIONS_CHECKIN), async (req, res) => {
    try {
        const id = Number(req.params.id);
        const existing = await prisma.prayerIntention.findUnique({ where: { id } });
        if (!existing) return res.status(404).json({ error: 'Intención no encontrada.' });

        const { text, displayName, userPhone, status } = req.body || {};
        const data = {};

        if (text !== undefined) {
            const trimmed = String(text).trim();
            if (!trimmed) return res.status(400).json({ error: 'La intención no puede estar vacía.' });
            data.text = trimmed;
        }
        if (displayName !== undefined) {
            data.displayName = String(displayName).trim() || null;
        }
        if (userPhone !== undefined) {
            const phone = userPhone ? normalizePhone(userPhone) : null;
            if (phone && !isValidPhone(phone)) {
                return res.status(400).json({ error: 'El celular debe tener exactamente 8 dígitos.' });
            }
            data.userPhone = phone;
        }
        if (status !== undefined) {
            if (!['active', 'prayed'].includes(status)) {
                return res.status(400).json({ error: 'Estado inválido.' });
            }
            data.status = status;
        }

        const updated = await prisma.prayerIntention.update({ where: { id }, data });
        await writeAudit({
            action: 'intention.update',
            entity: 'prayer_intention',
            entityId: id,
            meta: { text: updated.text.slice(0, 80), status: updated.status },
            req,
        });
        res.json({ message: 'Intención actualizada.', intention: updated });
    } catch (e) {
        console.error(e);
        res.status(500).json({ error: 'Error al actualizar la intención.' });
    }
});

router.delete('/intentions/:id', requirePermission(PRIV.RESERVATIONS_CHECKIN), async (req, res) => {
    try {
        const id = Number(req.params.id);
        const existing = await prisma.prayerIntention.findUnique({ where: { id } });
        if (!existing) return res.status(404).json({ error: 'Intención no encontrada.' });

        if (existing.assignedToReservationId) {
            await prisma.prayerIntention.update({
                where: { id },
                data: { assignedToReservationId: null },
            });
        }

        await prisma.prayerIntention.delete({ where: { id } });
        await writeAudit({
            action: 'intention.delete',
            entity: 'prayer_intention',
            entityId: id,
            meta: { text: existing.text.slice(0, 80) },
            req,
        });
        res.json({ message: 'Intención eliminada.' });
    } catch (e) {
        console.error(e);
        res.status(500).json({ error: 'Error al eliminar la intención.' });
    }
});

// ── QR FÍSICOS ────────────────────────────────────────────────────────
router.get('/qrs/chapel', requirePermission(PRIV.QRS_VIEW), async (req, res) => {
    try {
        const qr = await ensureChapelQr(req.user?.id ?? null);
        const image = await qrUtil.toDataURL(qr.qrCode);
        res.json({
            chapel: formatChapelQrPayload(qr, qrUtil),
            image,
        });
    } catch (e) {
        console.error(e);
        res.status(500).json({ error: 'Error al obtener el QR de la capilla.' });
    }
});

router.post('/qrs/chapel/replace', requirePermission(PRIV.QRS_CREATE), async (req, res) => {
    try {
        const qr = await replaceChapelQr(req.user.id);
        const image = await qrUtil.toDataURL(qr.qrCode);
        await writeAudit({
            action: 'qr.chapel.replace',
            entity: 'physical_qr',
            entityId: qr.id,
            meta: { qrCode: qr.qrCode },
            req,
        });
        res.status(201).json({
            message: 'Nuevo QR de capilla generado. Imprime y coloca en la entrada; el anterior quedó desactivado.',
            chapel: formatChapelQrPayload(qr, qrUtil),
            image,
        });
    } catch (e) {
        console.error(e);
        res.status(500).json({ error: 'Error al generar el QR de la capilla.' });
    }
});

router.get('/qrs/chapel/png', requirePermission(PRIV.QRS_VIEW), async (req, res) => {
    try {
        const qr = await ensureChapelQr(req.user?.id ?? null);
        const buffer = await qrUtil.toBuffer(qr.qrCode);
        res.setHeader('Content-Type', 'image/png');
        res.setHeader('Content-Disposition', 'attachment; filename="qr-capilla.png"');
        res.send(buffer);
    } catch (e) {
        console.error(e);
        res.status(500).json({ error: 'Error al generar PNG.' });
    }
});

router.get('/qrs', requirePermission(PRIV.QRS_VIEW), async (req, res) => {
    try {
        const qrs = await prisma.physicalQR.findMany({
            orderBy: { createdAt: 'desc' },
            include: { _count: { select: { scans: true } } },
        });
        res.json({
            qrs: qrs.map((q) => ({
                id: q.id,
                qrCode: q.qrCode,
                displayName: q.displayName,
                location: q.location,
                isActive: q.isActive,
                isChapelTotem: q.isChapelTotem,
                lastUsedAt: q.lastUsedAt,
                uses: q._count.scans,
                scanUrl: qrUtil.buildScanUrl(q.qrCode),
            })),
        });
    } catch (e) {
        console.error(e);
        res.status(500).json({ error: 'Error al obtener QR.' });
    }
});

router.post('/qrs', requirePermission(PRIV.QRS_CREATE), async (req, res) => {
    try {
        const { displayName, location } = req.body || {};
        if (!displayName) return res.status(400).json({ error: 'El nombre del QR es requerido.' });
        const qrCode = qrUtil.generateQrCodeId();
        const qr = await prisma.physicalQR.create({
            data: { qrCode, displayName, location: location || null, generatedBy: req.user.id },
        });
        await writeAudit({
            action: 'qr.create',
            entity: 'physical_qr',
            entityId: qr.id,
            meta: { displayName, qrCode },
            req,
        });
        const dataUrl = await qrUtil.toDataURL(qrCode);
        res.status(201).json({
            qr: { id: qr.id, qrCode: qr.qrCode, displayName: qr.displayName, location: qr.location },
            image: dataUrl,
            scanUrl: qrUtil.buildScanUrl(qrCode),
        });
    } catch (e) {
        console.error(e);
        res.status(500).json({ error: 'Error al generar el QR.' });
    }
});

router.put('/qrs/:id', requirePermission(PRIV.QRS_EDIT), async (req, res) => {
    try {
        const id = Number(req.params.id);
        const { displayName, location, isActive } = req.body || {};
        const qr = await prisma.physicalQR.update({
            where: { id },
            data: {
                ...(displayName !== undefined && { displayName }),
                ...(location !== undefined && { location }),
                ...(isActive !== undefined && { isActive: Boolean(isActive) }),
            },
        });
        await writeAudit({
            action: 'qr.update',
            entity: 'physical_qr',
            entityId: id,
            meta: { displayName: qr.displayName, isActive: qr.isActive },
            req,
        });
        res.json({ qr });
    } catch (e) {
        console.error(e);
        res.status(500).json({ error: 'Error al actualizar el QR.' });
    }
});

router.delete('/qrs/:id', requirePermission(PRIV.QRS_DELETE), async (req, res) => {
    try {
        const id = Number(req.params.id);
        await prisma.physicalQR.update({ where: { id }, data: { isActive: false } });
        await writeAudit({ action: 'qr.deactivate', entity: 'physical_qr', entityId: id, req });
        res.json({ message: 'QR desactivado.' });
    } catch (e) {
        console.error(e);
        res.status(500).json({ error: 'Error al eliminar el QR.' });
    }
});

router.get('/qrs/:id/stats', requirePermission(PRIV.QRS_VIEW), async (req, res) => {
    try {
        const id = Number(req.params.id);
        const qr = await prisma.physicalQR.findUnique({ where: { id } });
        if (!qr) return res.status(404).json({ error: 'QR no encontrado.' });
        const [total, success, failed] = await Promise.all([
            prisma.scanLog.count({ where: { physicalQrId: id } }),
            prisma.scanLog.count({ where: { physicalQrId: id, success: true } }),
            prisma.scanLog.count({ where: { physicalQrId: id, success: false } }),
        ]);
        const recent = await prisma.scanLog.findMany({
            where: { physicalQrId: id },
            orderBy: { scannedAt: 'desc' },
            take: 20,
        });
        res.json({ qr: { id: qr.id, qrCode: qr.qrCode, displayName: qr.displayName }, total, success, failed, lastUsedAt: qr.lastUsedAt, recent });
    } catch (e) {
        console.error(e);
        res.status(500).json({ error: 'Error al obtener estadísticas.' });
    }
});

router.get('/qrs/:id/png', requirePermission(PRIV.QRS_VIEW), async (req, res) => {
    try {
        const id = Number(req.params.id);
        const qr = await prisma.physicalQR.findUnique({ where: { id } });
        if (!qr) return res.status(404).json({ error: 'QR no encontrado.' });
        const buffer = await qrUtil.toBuffer(qr.qrCode);
        res.setHeader('Content-Type', 'image/png');
        res.setHeader('Content-Disposition', `attachment; filename="${qr.qrCode}.png"`);
        res.send(buffer);
    } catch (e) {
        console.error(e);
        res.status(500).json({ error: 'Error al generar PNG.' });
    }
});

router.get('/qrs/print-batch', requirePermission(PRIV.QRS_CREATE), async (req, res) => {
    try {
        const count = Math.min(Math.max(parseInt(req.query.count, 10) || 10, 1), 60);
        const items = [];
        for (let i = 0; i < count; i++) {
            const qrCode = qrUtil.generateQrCodeId();
            const buffer = await qrUtil.toBuffer(qrCode);
            const saved = await prisma.physicalQR.create({
                data: {
                    qrCode,
                    displayName: `QR lote ${new Date().toLocaleDateString('es-MX')} #${i + 1}`,
                    generatedBy: req.user.id,
                },
            });
            items.push({ qrCode, buffer, id: saved.id });
        }
        await writeAudit({
            action: 'qr.batch',
            entity: 'physical_qr',
            meta: { count: items.length },
            req,
        });

        const doc = new PDFDocument({ size: 'A4', margin: 30 });
        res.setHeader('Content-Type', 'application/pdf');
        res.setHeader('Content-Disposition', 'attachment; filename="qrs-para-imprimir.pdf"');
        doc.pipe(res);

        let x = 40;
        let y = 50;
        let col = 0;
        let row = 0;
        for (const item of items) {
            doc.image(item.buffer, x, y, { width: 130, height: 130 });
            doc.fontSize(10).fillColor('#000').text(item.qrCode, x, y + 134, { width: 130, align: 'center' });
            doc.fontSize(8).fillColor('#666').text(`ID: ${item.id}`, x, y + 148, { width: 130, align: 'center' });

            x += 170;
            col++;
            if (col >= 3) {
                col = 0;
                x = 40;
                y += 185;
                row++;
                if (row >= 4) {
                    doc.addPage();
                    x = 40;
                    y = 50;
                    row = 0;
                }
            }
        }
        doc.end();
    } catch (e) {
        console.error(e);
        if (!res.headersSent) res.status(500).json({ error: 'Error al generar el lote de QR.' });
    }
});

// ── CONFIGURACIÓN GLOBAL ──────────────────────────────────────────────
router.get('/settings', requirePermission(PRIV.SLOTS_VIEW), async (req, res) => {
    try {
        const settings = await getSettings();
        res.json({ settings });
    } catch (e) {
        console.error(e);
        res.status(500).json({ error: 'Error al obtener configuración.' });
    }
});

router.put('/settings', requirePermission(PRIV.SLOTS_EDIT), async (req, res) => {
    try {
        const body = req.body || {};
        const boolFields = [
            'freqOnceEnabled',
            'freqDailyEnabled',
            'freqWeeklyEnabled',
            'freqBiweeklyEnabled',
            'freqMonthlyEnabled',
            'allowOffsetStartTimes',
            'allowThirtyMinuteDurations',
        ];
        const data = {};
        for (const key of boolFields) {
            if (body[key] !== undefined) data[key] = Boolean(body[key]);
        }
        const settings = await prisma.settings.upsert({
            where: { id: 1 },
            update: data,
            create: { id: 1, ...data },
        });
        await writeAudit({
            action: 'settings.update',
            entity: 'settings',
            entityId: 1,
            meta: data,
            req,
        });
        res.json({ settings });
    } catch (e) {
        console.error(e);
        res.status(500).json({ error: 'Error al guardar configuración.' });
    }
});

// ── CALENDARIO DE GUARDIAS (vista semana / mes) ───────────────────────
router.get('/calendar', requirePermission(PRIV.SLOTS_VIEW), async (req, res) => {
    try {
        const view = req.query.view === 'month' ? 'month' : 'week';
        const anchor = req.query.start || req.query.date || todayStr();
        const range = dateRangeForView(view, anchor);

        const [allSlots, reservations] = await Promise.all([
            prisma.slot.findMany({ where: { isActive: true }, orderBy: { startTime: 'asc' } }),
            prisma.reservation.findMany({
                where: { status: { in: ['confirmed', 'completed'] } },
                include: { slot: true },
            }),
        ]);

        const days = range.dates.map((dateStr) => {
            const weekday = weekdayFromDate(dateStr);
            const { slots: eligible } = filterSlotsForDate(allSlots, dateStr);

            const slotBlocks = eligible.map((slot) => {
                const commitments = reservations
                    .filter((r) => r.slotId === slot.id && commitmentAppliesOn(r, dateStr))
                    .map((r) => ({
                        id: r.id,
                        userFirstName: r.userFirstName,
                        userLastName: r.userLastName,
                        userName: r.userName,
                        userPhone: r.userPhone,
                        frequency: r.frequency,
                        startTimeOffset: r.startTimeOffset,
                        durationMinutes: r.durationMinutes,
                    }));

                const gapStatus = checkTimelineGaps(commitments);
                const taken = commitments.length;

                return {
                    slotId: slot.id,
                    startTime: slot.startTime,
                    endTime: slot.endTime,
                    capacity: slot.capacity,
                    taken,
                    available: Math.max(0, slot.capacity - taken),
                    needsMore: Math.max(0, slot.capacity - taken),
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

        let daysOut = days;
        if (req.isScopedCaptain) {
            daysOut = filterCalendarDaysForCaptain(days, req.captainRanges);
        }

        res.json({
            view,
            label: range.label,
            start: range.start,
            end: range.end,
            days: daysOut,
            scopedCaptain: !!req.isScopedCaptain,
        });
    } catch (e) {
        console.error(e);
        res.status(500).json({ error: 'Error al obtener el calendario.' });
    }
});

// ── DIRECTORIO DE ADORADORES ──────────────────────────────────────────
router.get('/adoradores', requirePermission(PRIV.SLOTS_VIEW), async (req, res) => {
    try {
        const reservations = await prisma.reservation.findMany({
            where: { status: { in: ['confirmed', 'completed'] } },
            include: { slot: true },
            orderBy: [{ userLastName: 'asc' }, { userFirstName: 'asc' }],
        });

        const byPhone = new Map();

        for (const r of reservations) {
            const phone = r.userPhone;
            if (!phone) continue;

            let entry = byPhone.get(phone);
            if (!entry) {
                entry = {
                    phone,
                    firstName: r.userFirstName || '',
                    lastName: r.userLastName || '',
                    userName: r.userName,
                    weekdays: new Set(),
                    slots: new Set(),
                    frequencies: new Set(),
                    reservationIds: new Set(),
                };
                byPhone.set(phone, entry);
            }

            entry.reservationIds.add(r.id);

            if (r.userFirstName && !entry.firstName) entry.firstName = r.userFirstName;
            if (r.userLastName && !entry.lastName) entry.lastName = r.userLastName;

            participationWeekdays(r).forEach((wd) => entry.weekdays.add(wd));
            if (r.slot) {
                entry.slots.add(`${r.slot.startTime}–${r.slot.endTime}`);
            }
            if (r.frequency) entry.frequencies.add(r.frequency);
        }

        const adoradores = [...byPhone.values()]
            .map((a) => ({
                phone: a.phone,
                firstName: a.firstName,
                lastName: a.lastName,
                userName: a.userName,
                weekdays: [...a.weekdays].sort((x, y) => x - y),
                weekdaysLabel: formatWeekDays([...a.weekdays].join(',')),
                slots: [...a.slots].sort(),
                frequencies: [...a.frequencies].map((f) => FREQUENCY_LABELS[f] || f),
                reservationIds: [...a.reservationIds].sort((x, y) => x - y),
            }))
            .sort((a, b) => {
                const la = (a.lastName || a.firstName || '').toLowerCase();
                const lb = (b.lastName || b.firstName || '').toLowerCase();
                if (la !== lb) return la.localeCompare(lb);
                return (a.firstName || '').toLowerCase().localeCompare((b.firstName || '').toLowerCase());
            });

        res.json({ adoradores, total: adoradores.length });
    } catch (e) {
        console.error(e);
        res.status(500).json({ error: 'Error al obtener el directorio.' });
    }
});

// ── LISTA / ROSTER (compromisos, capitanes, sustitutos) ─────────────
const ROSTER_ROLES = ['captain', 'substitute'];

router.get('/roster', requirePermission(PRIV.SLOTS_VIEW), async (req, res) => {
    try {
        const weekdayFilter = req.query.weekday ? String(req.query.weekday) : '';
        const slotTimeFilter = req.query.slotTime ? String(req.query.slotTime) : '';

        const [reservations, members, slots] = await Promise.all([
            prisma.reservation.findMany({
                where: { status: { in: ['confirmed', 'completed'] } },
                include: { slot: true },
            }),
            prisma.rosterMember.findMany({
                where: { isActive: true },
                orderBy: [{ lastName: 'asc' }, { firstName: 'asc' }],
            }),
            prisma.slot.findMany({
                where: { isActive: true },
                orderBy: { startTime: 'asc' },
                select: { startTime: true },
            }),
        ]);

        const slotTimes = [...new Set(slots.map((s) => s.startTime))];

        let commitments = [];
        for (const r of reservations) {
            commitments.push(...reservationToCommitmentRows(r));
        }
        commitments = sortRosterRows(
            commitments.filter((row) => commitmentRowMatchesFilter(row, weekdayFilter, slotTimeFilter))
        );
        if (req.isScopedCaptain) {
            commitments = commitments.filter((row) => {
                const { slotMatchesCaptainScope } = require('../utils/captainScope');
                return slotMatchesCaptainScope(row.weekday, row.slotTime, req.captainRanges);
            });
        }

        const captains = sortMembersByName(
            members
                .filter((m) => m.role === 'captain')
                .map(rosterMemberToRow)
                .filter((m) => rosterMemberMatchesFilter(m, weekdayFilter, slotTimeFilter))
        );

        const substitutes = sortMembersByName(
            members
                .filter((m) => m.role === 'substitute')
                .map(rosterMemberToRow)
                .filter((m) => rosterMemberMatchesFilter(m, weekdayFilter, slotTimeFilter))
        );

        res.json({
            filters: { weekday: weekdayFilter || null, slotTime: slotTimeFilter || null },
            slotTimes,
            commitments,
            captains,
            substitutes,
            counts: {
                commitments: commitments.length,
                captains: captains.length,
                substitutes: substitutes.length,
            },
        });
    } catch (e) {
        console.error(e);
        res.status(500).json({ error: 'Error al obtener la lista.' });
    }
});

router.get('/roster/export.csv', requirePermission(PRIV.RESERVATIONS_EXPORT), async (req, res) => {
    try {
        const section = req.query.section || 'commitments';
        const weekdayFilter = req.query.weekday ? String(req.query.weekday) : '';
        const slotTimeFilter = req.query.slotTime ? String(req.query.slotTime) : '';

        let header = '';
        let rows = [];

        if (section === 'commitments') {
            const reservations = await prisma.reservation.findMany({
                where: { status: { in: ['confirmed', 'completed'] } },
                include: { slot: true },
            });
            let commitments = [];
            for (const r of reservations) {
                commitments.push(...reservationToCommitmentRows(r));
            }
            commitments = sortRosterRows(
                commitments.filter((row) => commitmentRowMatchesFilter(row, weekdayFilter, slotTimeFilter))
            );
            header = 'turno,duracion,frecuencia,nombre,apellido,celular,notas\n';
            rows = commitments.map((c) =>
                [
                    `"${c.turno.replace(/"/g, '""')}"`,
                    `"${c.durationLabel.replace(/"/g, '""')}"`,
                    `"${c.frequencyLabel.replace(/"/g, '""')}"`,
                    `"${(c.firstName || '').replace(/"/g, '""')}"`,
                    `"${(c.lastName || '').replace(/"/g, '""')}"`,
                    c.phone,
                    '""',
                ].join(',')
            );
        } else if (section === 'captains' || section === 'substitutes') {
            const members = await prisma.rosterMember.findMany({
                where: { isActive: true, role: section === 'captains' ? 'captain' : 'substitute' },
            });
            const list = sortMembersByName(
                members
                    .map(rosterMemberToRow)
                    .filter((m) => rosterMemberMatchesFilter(m, weekdayFilter, slotTimeFilter))
            );
            header = 'nombre,apellido,celular,correo,dias,horas,notas\n';
            rows = list.map((m) =>
                [
                    `"${(m.firstName || '').replace(/"/g, '""')}"`,
                    `"${(m.lastName || '').replace(/"/g, '""')}"`,
                    m.phone,
                    `"${(m.email || '').replace(/"/g, '""')}"`,
                    `"${(m.daysLabel || '').replace(/"/g, '""')}"`,
                    `"${(m.timesLabel || '').replace(/"/g, '""')}"`,
                    `"${(m.internalNotes || '').replace(/"/g, '""')}"`,
                ].join(',')
            );
        } else {
            return res.status(400).json({ error: 'Sección de exportación inválida.' });
        }

        res.setHeader('Content-Type', 'text/csv; charset=utf-8');
        res.setHeader('Content-Disposition', `attachment; filename="lista-${section}.csv"`);
        res.send(header + rows.join('\n'));
    } catch (e) {
        console.error(e);
        res.status(500).json({ error: 'Error al exportar la lista.' });
    }
});

router.post('/roster-members', requirePermission(PRIV.SLOTS_EDIT), async (req, res) => {
    try {
        const body = req.body || {};
        const role = String(body.role || '').trim();
        const firstName = String(body.firstName || '').trim();
        const lastName = String(body.lastName || '').trim();
        const phone = normalizePhone(body.phone);
        const email = body.email ? String(body.email).trim() : null;
        const internalNotes = body.internalNotes ? String(body.internalNotes).trim() : null;
        const weekDays = body.weekDays ? String(body.weekDays).trim() : null;
        const slotTimes = body.slotTimes ? String(body.slotTimes).trim() : null;

        if (!ROSTER_ROLES.includes(role)) {
            return res.status(400).json({ error: 'Rol inválido (captain o substitute).' });
        }
        if (!firstName || !phone) {
            return res.status(400).json({ error: 'Nombre y celular son requeridos.' });
        }
        if (!isValidPhone(phone)) {
            return res.status(400).json({ error: 'El celular debe tener exactamente 8 dígitos.' });
        }

        const member = await prisma.rosterMember.create({
            data: {
                role,
                firstName,
                lastName,
                phone,
                email,
                internalNotes,
                weekDays: weekDays || null,
                slotTimes: slotTimes || null,
            },
        });

        await writeAudit({
            action: 'roster.create',
            entity: 'roster_member',
            entityId: member.id,
            meta: { role, firstName, lastName },
            req,
        });

        res.status(201).json({ member: rosterMemberToRow(member) });
    } catch (e) {
        console.error(e);
        res.status(500).json({ error: 'Error al crear el registro.' });
    }
});

router.put('/roster-members/:id', requirePermission(PRIV.SLOTS_EDIT), async (req, res) => {
    try {
        const id = Number(req.params.id);
        const body = req.body || {};
        const data = {};

        if (body.firstName !== undefined) data.firstName = String(body.firstName).trim();
        if (body.lastName !== undefined) data.lastName = String(body.lastName).trim();
        if (body.phone !== undefined) {
            const phone = normalizePhone(body.phone);
            if (!isValidPhone(phone)) {
                return res.status(400).json({ error: 'El celular debe tener exactamente 8 dígitos.' });
            }
            data.phone = phone;
        }
        if (body.email !== undefined) data.email = body.email ? String(body.email).trim() : null;
        if (body.internalNotes !== undefined) {
            data.internalNotes = body.internalNotes ? String(body.internalNotes).trim() : null;
        }
        if (body.weekDays !== undefined) data.weekDays = body.weekDays ? String(body.weekDays).trim() : null;
        if (body.slotTimes !== undefined) data.slotTimes = body.slotTimes ? String(body.slotTimes).trim() : null;
        if (body.isActive !== undefined) data.isActive = Boolean(body.isActive);

        const member = await prisma.rosterMember.update({ where: { id }, data });

        await writeAudit({
            action: 'roster.update',
            entity: 'roster_member',
            entityId: id,
            meta: { role: member.role },
            req,
        });

        res.json({ member: rosterMemberToRow(member) });
    } catch (e) {
        console.error(e);
        if (e.code === 'P2025') return res.status(404).json({ error: 'Registro no encontrado.' });
        res.status(500).json({ error: 'Error al actualizar el registro.' });
    }
});

router.delete('/roster-members/:id', requirePermission(PRIV.SLOTS_EDIT), async (req, res) => {
    try {
        const id = Number(req.params.id);
        const existing = await prisma.rosterMember.findUnique({ where: { id } });
        if (!existing) return res.status(404).json({ error: 'Registro no encontrado.' });

        await prisma.rosterMember.update({ where: { id }, data: { isActive: false } });

        await writeAudit({
            action: 'roster.deactivate',
            entity: 'roster_member',
            entityId: id,
            meta: { role: existing.role },
            req,
        });

        res.json({ message: 'Registro desactivado.' });
    } catch (e) {
        console.error(e);
        res.status(500).json({ error: 'Error al eliminar el registro.' });
    }
});

// ── TIMELINE (detección de huecos de 30 min) ──────────────────────────
router.get('/timeline', requirePermission(PRIV.DASHBOARD_VIEW), async (req, res) => {
    try {
        const date = req.query.date || todayStr();
        const allSlots = await prisma.slot.findMany({
            where: { isActive: true },
            orderBy: { startTime: 'asc' },
        });
        const { slots: eligible } = filterSlotsForDate(allSlots, date);

        const reservations = await prisma.reservation.findMany({
            where: { date, status: { in: ['confirmed', 'completed'] } },
            include: { slot: true },
            orderBy: { createdAt: 'asc' },
        });

        const bySlot = {};
        for (const r of reservations) {
            if (!bySlot[r.slotId]) bySlot[r.slotId] = [];
            bySlot[r.slotId].push(r);
        }

        const blocks = eligible.map((slot) => {
            const commitments = (bySlot[slot.id] || []).map((r) => ({
                id: r.id,
                userName: r.userName,
                userFirstName: r.userFirstName,
                userLastName: r.userLastName,
                startTimeOffset: r.startTimeOffset,
                durationMinutes: r.durationMinutes,
                frequency: r.frequency,
                status: r.status,
            }));
            const gapStatus = checkTimelineGaps(commitments);
            const fractional = hasFractionalCoverage(commitments);
            return {
                slotId: slot.id,
                startTime: slot.startTime,
                endTime: slot.endTime,
                commitments,
                gapStatus,
                gapAlert: gapStatus === GAP_STATUS.CRITICAL_GAP,
                fractional,
            };
        });

        res.json({ date, blocks });
    } catch (e) {
        console.error(e);
        res.status(500).json({ error: 'Error al obtener timeline.' });
    }
});

// ── REPORTES ──────────────────────────────────────────────────────────
router.get('/reports/reservations.csv', requirePermission(PRIV.RESERVATIONS_EXPORT), async (req, res) => {
    try {
        const result = await fetchReservationsForAdmin(req.query);
        const rows = result.reservations;

        const header = 'id,fecha,turno,nombre,apellido,celular,frecuencia,duracion_min,desfase_min,estado,checkin\n';
        const body = rows
            .map((r) =>
                [
                    r.reservationId || r.id,
                    r.date,
                    `${r.slot.startTime}-${r.slot.endTime}`,
                    `"${(r.userFirstName || '').replace(/"/g, '""')}"`,
                    `"${(r.userLastName || '').replace(/"/g, '""')}"`,
                    r.userPhone,
                    r.frequency || 'WEEKLY',
                    r.durationMinutes ?? 60,
                    r.startTimeOffset ?? 0,
                    r.status,
                    r.checkedInAt ? new Date(r.checkedInAt).toISOString() : '',
                ].join(',')
            )
            .join('\n');
        res.setHeader('Content-Type', 'text/csv; charset=utf-8');
        res.setHeader('Content-Disposition', 'attachment; filename="reservas.csv"');
        res.send(header + body);
    } catch (e) {
        console.error(e);
        res.status(500).json({ error: 'Error al generar el reporte.' });
    }
});

module.exports = router;
