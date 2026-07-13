const express = require('express');
const prisma = require('../db');
const { normalizePhone, isValidPhone } = require('../utils/phone');
const { randomScripture } = require('../constants/eucharisticScriptures');
const { requireKioskSecret } = require('../middleware/kioskAuth');
const { rateLimit } = require('../middleware/rateLimit');

const kioskCheckInLimit = rateLimit({
    windowMs: 60 * 1000,
    max: 40,
    keyFn: (req) => `kiosk:${req.ip || 'unknown'}`,
    message: 'Demasiados intentos. Espera un momento.',
});
const {
    resolveKioskUserByPhone,
    firstNameFromUser,
    startOfToday,
    endOfToday,
} = require('../utils/kioskUser');

const router = express.Router();

// POST /api/kiosk/check-in  { "phone_number": "########" }
router.post('/check-in', kioskCheckInLimit, requireKioskSecret, async (req, res) => {
    try {
        const phone = normalizePhone(req.body?.phone_number ?? req.body?.phoneNumber);
        if (!isValidPhone(phone)) {
            return res.status(400).json({ error: 'Ingrese un número celular válido de 8 dígitos.' });
        }

        const user = await resolveKioskUserByPhone(phone);
        if (!user) {
            return res.status(404).json({
                error: 'No se pudo completar el registro. Verifica tu número o regístrate en adorahora.com.',
            });
        }

        const todayStart = startOfToday();
        const todayEnd = endOfToday();

        const result = await prisma.$transaction(async (tx) => {
            const activeSession = await tx.attendanceLog.findFirst({
                where: {
                    userId: user.id,
                    checkInAt: { gte: todayStart, lte: todayEnd },
                    checkOutAt: null,
                },
                orderBy: { checkInAt: 'desc' },
            });

            if (!activeSession) {
                await tx.attendanceLog.create({
                    data: {
                        userId: user.id,
                        checkInAt: new Date(),
                    },
                });
                return { action: 'check_in' };
            }

            await tx.attendanceLog.update({
                where: { id: activeSession.id },
                data: { checkOutAt: new Date() },
            });
            return { action: 'check_out' };
        });

        res.json({
            status: 'success',
            action: result.action,
            first_name: firstNameFromUser(user),
            scripture: randomScripture(),
        });
    } catch (e) {
        console.error(e);
        res.status(500).json({ error: 'Error al registrar asistencia.' });
    }
});

module.exports = router;
