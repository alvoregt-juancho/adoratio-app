const express = require('express');
const prisma = require('../db');
const { todayStr, nowHHMM } = require('../utils/dates');
const { normalizePhone, isValidPhone } = require('../utils/phone');
const {
    isRecurringFrequency,
    findCheckinReservation,
    startOfDay,
    endOfDay,
} = require('../utils/checkinMatch');
const { getChapelQr } = require('../utils/chapelQr');
const qrUtil = require('../utils/qr');

const router = express.Router();

// GET /api/check-in/chapel — QR único de la capilla (para imprimir / enlazar)
router.get('/chapel', async (req, res) => {
    try {
        const qr = await getChapelQr();
        if (!qr) {
            return res.status(404).json({ error: 'No hay QR de capilla configurado.' });
        }
        res.json({
            qrCode: qr.qrCode,
            displayName: qr.displayName,
            scanUrl: qrUtil.buildScanUrl(qr.qrCode),
        });
    } catch (e) {
        console.error(e);
        res.status(500).json({ error: 'Error al obtener el QR de la capilla.' });
    }
});

// POST /api/check-in/scan  { qrCode, userPhone }
router.post('/scan', async (req, res) => {
    const { qrCode } = req.body || {};
    const userPhone = normalizePhone(req.body?.userPhone);
    const ip = req.ip;
    const userAgent = req.headers['user-agent'];

    async function logScan(physicalQrId, reservationId, success, errorMessage) {
        try {
            await prisma.scanLog.create({
                data: { physicalQrId, reservationId, ipAddress: ip, userAgent, success, errorMessage },
            });
        } catch (e) {
            console.error('No se pudo registrar scanLog:', e.message);
        }
    }

    try {
        if (!qrCode || !userPhone) {
            return res.status(400).json({ error: 'Falta el código QR o el celular.' });
        }
        if (!isValidPhone(userPhone)) {
            return res.status(400).json({ error: 'El celular debe tener exactamente 8 dígitos.' });
        }

        const physicalQR = await prisma.physicalQR.findFirst({
            where: { qrCode, isActive: true },
        });
        if (!physicalQR) {
            return res.status(404).json({
                error: 'QR no válido o desactivado. Consulta en la entrada de la capilla.',
            });
        }

        if (!physicalQR.isChapelTotem) {
            return res.status(400).json({
                error: 'Este QR no es el tótem de ingreso de la capilla. Usa el QR impreso en la entrada.',
            });
        }

        const date = todayStr();
        const now = nowHHMM();

        const reservations = await prisma.reservation.findMany({
            where: {
                userPhone,
                status: 'confirmed',
            },
            include: { slot: true },
        });

        const activeReservation = findCheckinReservation(reservations, date, now);

        if (!activeReservation) {
            await logScan(physicalQR.id, null, false, 'Sin guardia activa para este horario');
            return res.status(404).json({
                error: 'No tienes una guardia activa para este horario. ¿Te registraste con este celular?',
            });
        }

        const alreadyToday = await prisma.scanLog.findFirst({
            where: {
                reservationId: activeReservation.id,
                success: true,
                scannedAt: { gte: startOfDay(date), lte: endOfDay(date) },
            },
        });
        if (alreadyToday) {
            await logScan(physicalQR.id, activeReservation.id, false, 'Asistencia ya registrada hoy');
            return res.status(409).json({
                error: 'Tu asistencia de hoy ya fue registrada. ¡Gracias por tu custodia!',
            });
        }

        const recurring = isRecurringFrequency(activeReservation.frequency);
        await prisma.reservation.update({
            where: { id: activeReservation.id },
            data: {
                checkedInAt: new Date(),
                checkedInViaQrId: physicalQR.id,
                ...(recurring ? {} : { status: 'completed' }),
            },
        });

        await logScan(physicalQR.id, activeReservation.id, true, null);
        await prisma.physicalQR.update({
            where: { id: physicalQR.id },
            data: { lastUsedAt: new Date() },
        });
        await prisma.auditLog.create({
            data: {
                action: 'checkin.scan',
                entity: 'reservation',
                entityId: activeReservation.id,
                reservationId: activeReservation.id,
                meta: JSON.stringify({ qrCode, date }),
            },
        });

        return res.json({
            success: true,
            message: `¡Bienvenido/a ${activeReservation.userName}! Tu asistencia ha sido registrada.`,
            details: {
                date,
                slot: `${activeReservation.slot.startTime} - ${activeReservation.slot.endTime}`,
                checkedInAt: new Date().toLocaleTimeString('es-MX'),
            },
        });
    } catch (e) {
        console.error(e);
        return res.status(500).json({ error: 'Error al registrar la asistencia.' });
    }
});

module.exports = router;
