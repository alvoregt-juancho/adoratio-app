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
const { writeAudit } = require('../utils/audit');
const { normalizeReservationNames } = require('../utils/name');
const { todayStr } = require('../utils/dates');
const { getSettings } = require('../utils/settings');
const { filterSlotsForDate } = require('../utils/schedule');
const { checkTimelineGaps, hasFractionalCoverage, GAP_STATUS } = require('../utils/timeline');

const router = express.Router();

router.use(requireAuth, attachPrivileges, requireAdminAccess);
router.use(rbacRoutes);

// ── MÉTRICAS / DASHBOARD ──────────────────────────────────────────────
router.get('/metrics', requirePermission(PRIV.DASHBOARD_VIEW), async (req, res) => {
    try {
        const date = req.query.date || todayStr();
        const [totalSlots, reservations, scansToday] = await Promise.all([
            prisma.slot.count({ where: { isActive: true } }),
            prisma.reservation.findMany({
                where: { date, status: { in: ['confirmed', 'completed', 'no_show'] } },
                select: { slotId: true, status: true, checkedInAt: true },
            }),
            prisma.scanLog.count({
                where: { scannedAt: { gte: new Date(date + 'T00:00:00'), lte: new Date(date + 'T23:59:59') } },
            }),
        ]);

        const slotsWithReservation = new Set(reservations.map((r) => r.slotId));
        const checkedIn = reservations.filter((r) => r.checkedInAt).length;

        res.json({
            date,
            totalSlots,
            totalReservations: reservations.length,
            checkedIn,
            pending: reservations.length - checkedIn,
            criticalSlots: totalSlots - slotsWithReservation.size,
            scansToday,
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
router.get('/reservations', requirePermission(PRIV.RESERVATIONS_VIEW), async (req, res) => {
    try {
        const { date, slotId, status, firstName, lastName, phone, slotTime } = req.query;
        const where = {};
        if (date) where.date = date;
        if (slotId) where.slotId = Number(slotId);
        if (status) where.status = status;
        if (firstName) where.userFirstName = { contains: String(firstName) };
        if (lastName) where.userLastName = { contains: String(lastName) };
        if (phone) where.userPhone = { contains: String(phone) };

        const reservations = await prisma.reservation.findMany({
            where,
            include: { slot: true, checkedInViaQR: true },
            orderBy: [{ date: 'desc' }, { slot: { startTime: 'asc' } }, { userLastName: 'asc' }],
            take: 500,
        });

        let list = reservations.map(normalizeReservationNames);
        if (slotTime) {
            const q = String(slotTime).toLowerCase();
            list = list.filter((r) =>
                (r.slot.startTime + '–' + r.slot.endTime).toLowerCase().includes(q)
            );
        }

        res.json({ reservations: list, total: list.length });
    } catch (e) {
        console.error(e);
        res.status(500).json({ error: 'Error al obtener reservas.' });
    }
});

router.post('/reservations/:id/checkin', requirePermission(PRIV.RESERVATIONS_CHECKIN), async (req, res) => {
    try {
        const id = Number(req.params.id);
        const reservation = await prisma.reservation.findUnique({ where: { id } });
        if (!reservation) return res.status(404).json({ error: 'Reserva no encontrada.' });
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

// ── QR FÍSICOS ────────────────────────────────────────────────────────
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
        const { date, status, firstName, lastName, phone, slotTime } = req.query;
        const where = {};
        if (date) where.date = date;
        if (status) where.status = status;
        if (firstName) where.userFirstName = { contains: String(firstName) };
        if (lastName) where.userLastName = { contains: String(lastName) };
        if (phone) where.userPhone = { contains: String(phone) };

        let rows = await prisma.reservation.findMany({
            where,
            include: { slot: true },
            orderBy: [{ date: 'desc' }, { slot: { startTime: 'asc' } }],
        });
        rows = rows.map(normalizeReservationNames);
        if (slotTime) {
            const q = String(slotTime).toLowerCase();
            rows = rows.filter((r) =>
                (r.slot.startTime + '-' + r.slot.endTime).toLowerCase().includes(q)
            );
        }

        const header = 'id,fecha,turno,nombre,apellido,celular,frecuencia,duracion_min,desfase_min,estado,checkin\n';
        const body = rows
            .map((r) =>
                [
                    r.id,
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
