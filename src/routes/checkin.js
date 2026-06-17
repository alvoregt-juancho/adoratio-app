const express = require('express');
const prisma = require('../db');
const { todayStr, nowHHMM } = require('../utils/dates');
const { normalizePhone, isValidPhone } = require('../utils/phone');

const router = express.Router();

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

        const date = todayStr();
        const now = nowHHMM();
        const activeReservation = await prisma.reservation.findFirst({
            where: {
                userPhone,
                date,
                status: 'confirmed',
                checkedInAt: null,
                slot: { startTime: { lte: now }, endTime: { gt: now } },
            },
            include: { slot: true },
        });

        if (!activeReservation) {
            await logScan(physicalQR.id, null, false, 'Sin reserva activa para el horario');
            return res.status(404).json({
                error: 'No tienes una reserva activa para este horario. ¿Reservaste con este celular?',
            });
        }

        await prisma.reservation.update({
            where: { id: activeReservation.id },
            data: { checkedInAt: new Date(), checkedInViaQrId: physicalQR.id, status: 'completed' },
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
                meta: JSON.stringify({ qrCode }),
            },
        });

        return res.json({
            success: true,
            message: `¡Bienvenido/a ${activeReservation.userName}! Tu asistencia ha sido registrada.`,
            details: {
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
