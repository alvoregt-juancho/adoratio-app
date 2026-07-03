const express = require('express');
const prisma = require('../db');
const { todayStr, isPastDate } = require('../utils/dates');
const { normalizePhone, isValidPhone } = require('../utils/phone');
const { parseParticipantNames } = require('../utils/name');
const { isAdorationDay, isSlotAvailable, weekdayFromDate, getScheduleMessage } = require('../utils/schedule');
const { getSettings } = require('../utils/settings');
const { isValidFrequency, COMMITMENT_FREQUENCY, getEnabledFrequencies } = require('../constants/commitment');
const { parseWeekDays, isValidWeekDays } = require('../utils/weekDays');
const { isValidBiweeklyWeeks } = require('../utils/biweeklyWeeks');
const { commitmentEndDateFromMonths, COMMITMENT_TERM_MONTHS } = require('../utils/commitmentMatch');
const { formatIntentionPayload, releaseWallIntentionAssignment, assignWallIntentionToReservation, markAssignedIntentionPrayed } = require('../utils/intentions');
const { notifyCaptainsSubstituteNeeded } = require('../utils/captainScope');

const router = express.Router();

// POST /api/reservations  { slotId, userFirstName, userLastName, userPhone, date?, frequency?, weekDays?, biweeklyWeeks?, durationMinutes?, startTimeOffset? }
router.post('/', async (req, res) => {
    try {
        const { slotId } = req.body || {};
        const { first, last, full } = parseParticipantNames(req.body);
        const userPhone = normalizePhone(req.body?.userPhone);
        const date = req.body?.date || todayStr();
        const frequency = req.body?.frequency || COMMITMENT_FREQUENCY.WEEKLY;
        const weekDaysRaw = req.body?.weekDays;
        const biweeklyWeeksRaw = req.body?.biweeklyWeeks;
        const durationMinutes = Number(req.body?.durationMinutes ?? 60);
        const startTimeOffset = Number(req.body?.startTimeOffset ?? 0);
        const commitmentMonths = Number(req.body?.commitmentMonths);

        if (!slotId || !first || !userPhone) {
            return res.status(400).json({ error: 'Turno, nombre y celular son requeridos.' });
        }
        if (!isValidPhone(userPhone)) {
            return res.status(400).json({ error: 'El celular debe tener exactamente 8 dígitos.' });
        }
        if (isPastDate(date)) {
            return res.status(400).json({ error: 'No puedes reservar en una fecha pasada.' });
        }
        if (!isValidFrequency(frequency)) {
            return res.status(400).json({ error: 'Frecuencia de guardia inválida.' });
        }
        if (![30, 60].includes(durationMinutes)) {
            return res.status(400).json({ error: 'Duración inválida (30 o 60 minutos).' });
        }
        if (![0, 30].includes(startTimeOffset)) {
            return res.status(400).json({ error: 'Desfase de inicio inválido (0 o 30 minutos).' });
        }
        if (durationMinutes === 60 && startTimeOffset === 30) {
            return res.status(400).json({ error: 'Las guardias de 1 hora solo pueden iniciar en :00.' });
        }
        if (!COMMITMENT_TERM_MONTHS.includes(commitmentMonths)) {
            return res.status(400).json({ error: 'Selecciona el tiempo de compromiso (1, 3, 6 o 12 meses).' });
        }
        const commitmentEndDate = commitmentEndDateFromMonths(date, commitmentMonths);

        const settings = await getSettings();
        const enabledFreqs = getEnabledFrequencies(settings);
        if (!enabledFreqs.includes(frequency)) {
            return res.status(400).json({ error: 'Esta frecuencia no está habilitada.' });
        }
        if (startTimeOffset === 30 && !settings.allowOffsetStartTimes) {
            return res.status(400).json({ error: 'Inicio a media hora no está habilitado.' });
        }
        if (durationMinutes === 30 && !settings.allowThirtyMinuteDurations) {
            return res.status(400).json({ error: 'Guardias de 30 minutos no están habilitadas.' });
        }

        let weekDays = null;
        if (frequency === COMMITMENT_FREQUENCY.DAILY) {
            if (!isValidWeekDays(weekDaysRaw)) {
                return res.status(400).json({ error: 'Selecciona al menos un día de la semana.' });
            }
            weekDays = parseWeekDays(weekDaysRaw).join(',');
        } else if (frequency === COMMITMENT_FREQUENCY.WEEKLY) {
            weekDays = String(weekdayFromDate(date));
        }

        let biweeklyWeeks = null;
        if (frequency === COMMITMENT_FREQUENCY.BIWEEKLY) {
            if (!isValidBiweeklyWeeks(biweeklyWeeksRaw)) {
                return res.status(400).json({ error: 'Selecciona las semanas de tu guardia quincenal.' });
            }
            biweeklyWeeks = String(biweeklyWeeksRaw).trim();
        }

        const slot = await prisma.slot.findFirst({ where: { id: Number(slotId), isActive: true } });
        if (!slot) {
            return res.status(404).json({ error: 'El turno no existe o no está disponible.' });
        }

        const weekday = weekdayFromDate(date);
        if (!isAdorationDay(weekday)) {
            return res.status(400).json({ error: getScheduleMessage(weekday) || 'Este día no tiene adoración.' });
        }
        if (!isSlotAvailable(slot.startTime, weekday)) {
            return res.status(400).json({ error: 'Este horario no está disponible por celebración de misa.' });
        }

        const dup = await prisma.reservation.findFirst({
            where: { slotId: slot.id, userPhone, date, status: { in: ['confirmed', 'completed'] } },
        });
        if (dup) {
            return res.status(409).json({ error: 'Ya tienes una reserva para este turno.' });
        }

        const taken = await prisma.reservation.count({
            where: { slotId: slot.id, date, status: { in: ['confirmed', 'completed'] } },
        });
        if (taken >= slot.capacity) {
            return res.status(409).json({ error: 'Este turno ya está completo.' });
        }

        const prayForWall = req.body?.prayForWall === true || req.body?.prayForWall === 'true';

        const reservation = await prisma.reservation.create({
            data: {
                slotId: slot.id,
                userPhone,
                userFirstName: first,
                userLastName: last,
                userName: full,
                date,
                frequency,
                weekDays,
                biweeklyWeeks,
                durationMinutes,
                startTimeOffset,
                commitmentEndDate,
                status: 'confirmed',
            },
            include: { slot: true },
        });

        await prisma.auditLog.create({
            data: {
                action: 'reservation.create',
                entity: 'reservation',
                entityId: reservation.id,
                reservationId: reservation.id,
                meta: JSON.stringify({ slotId: slot.id, date, frequency, weekDays, biweeklyWeeks, durationMinutes, startTimeOffset }),
            },
        });

        let assignedIntention = null;
        if (prayForWall) {
            assignedIntention = await assignWallIntentionToReservation(reservation.id);
        }

        return res.status(201).json({
            message: assignedIntention
                ? 'Reserva confirmada. Se te asignó una petición del muro para interceder.'
                : prayForWall
                    ? 'Reserva confirmada. No había peticiones disponibles en el muro por ahora.'
                    : 'Reserva confirmada.',
            reservation: {
                id: reservation.id,
                date: reservation.date,
                status: reservation.status,
                slot: { startTime: slot.startTime, endTime: slot.endTime },
                assignedIntention: formatIntentionPayload(assignedIntention),
            },
        });
    } catch (e) {
        console.error(e);
        return res.status(500).json({ error: 'Error al crear la reserva.' });
    }
});

// GET /api/reservations/my?phone=...
router.get('/my', async (req, res) => {
    try {
        const phone = normalizePhone(req.query.phone);
        if (!phone) return res.status(400).json({ error: 'Celular requerido.' });
        const list = await prisma.reservation.findMany({
            where: { userPhone: phone },
            include: {
                slot: true,
                assignedPrayerIntention: true,
            },
            orderBy: [{ date: 'desc' }, { createdAt: 'desc' }],
        });
        res.json({
            reservations: list.map((r) => ({
                id: r.id,
                date: r.date,
                status: r.status,
                frequency: r.frequency,
                weekDays: r.weekDays,
                biweeklyWeeks: r.biweeklyWeeks,
                durationMinutes: r.durationMinutes,
                startTimeOffset: r.startTimeOffset,
                checkedInAt: r.checkedInAt,
                slot: r.slot,
                assignedIntention: formatIntentionPayload(r.assignedPrayerIntention),
            })),
        });
    } catch (e) {
        console.error(e);
        res.status(500).json({ error: 'Error al obtener reservas.' });
    }
});

// DELETE /api/reservations/:id  (autoriza por celular del titular)
router.delete('/:id', async (req, res) => {
    try {
        const id = Number(req.params.id);
        const phone = normalizePhone(req.body?.phone || req.query.phone);
        const reservation = await prisma.reservation.findUnique({ where: { id } });
        if (!reservation) return res.status(404).json({ error: 'Reserva no encontrada.' });
        if (!phone || reservation.userPhone !== phone) {
            return res.status(403).json({ error: 'No autorizado para cancelar esta reserva.' });
        }
        if (reservation.status === 'cancelled') {
            return res.status(409).json({ error: 'La reserva ya estaba cancelada.' });
        }
        if (reservation.status === 'completed' || reservation.checkedInAt) {
            return res.status(409).json({ error: 'No se puede cancelar una asistencia ya registrada.' });
        }
        const fullReservation = await prisma.reservation.findUnique({
            where: { id },
            include: { slot: true },
        });
        await prisma.reservation.update({
            where: { id },
            data: { status: 'cancelled', cancelledAt: new Date() },
        });
        await releaseWallIntentionAssignment(id);
        await notifyCaptainsSubstituteNeeded(fullReservation);
        await prisma.auditLog.create({
            data: { action: 'reservation.cancel', entity: 'reservation', entityId: id, reservationId: id },
        });
        res.json({ message: 'Reserva cancelada.' });
    } catch (e) {
        console.error(e);
        res.status(500).json({ error: 'Error al cancelar la reserva.' });
    }
});

// POST /api/reservations/:id/intention/prayed — adorador marca intención asignada como orada
router.post('/:id/intention/prayed', async (req, res) => {
    try {
        const id = Number(req.params.id);
        const phone = normalizePhone(req.body?.phone);
        const reservation = await prisma.reservation.findUnique({
            where: { id },
            include: { assignedPrayerIntention: true },
        });
        if (!reservation) return res.status(404).json({ error: 'Reserva no encontrada.' });
        if (!phone || reservation.userPhone !== phone) {
            return res.status(403).json({ error: 'No autorizado.' });
        }
        const intention = reservation.assignedPrayerIntention;
        if (!intention) return res.status(404).json({ error: 'No tienes una intención asignada en esta guardia.' });
        if (intention.status === 'prayed') {
            return res.status(409).json({ error: 'Esta intención ya fue marcada como orada.' });
        }
        await markAssignedIntentionPrayed(id);
        res.json({ message: 'Intención marcada como orada.' });
    } catch (e) {
        console.error(e);
        res.status(500).json({ error: 'Error al marcar la intención.' });
    }
});

module.exports = router;
