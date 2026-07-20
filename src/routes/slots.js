const express = require('express');
const prisma = require('../db');
const { todayStr } = require('../utils/dates');
const { filterSlotsForDate } = require('../utils/schedule');
const { getSettings } = require('../utils/settings');
const { getEnabledFrequencies } = require('../constants/commitment');
const { withSlotTimeLabels } = require('../utils/timeFormat');
const { checkTimelineGaps, hasFractionalCoverage, GAP_STATUS } = require('../utils/timeline');
const { commitmentAppliesOn } = require('../utils/commitmentMatch');
const { buildPriorityWeek } = require('../utils/prioritySlots');

const router = express.Router();

async function loadActiveSlotsAndReservations() {
    const [slots, reservations] = await Promise.all([
        prisma.slot.findMany({
            where: { isActive: true },
            orderBy: { startTime: 'asc' },
        }),
        prisma.reservation.findMany({
            where: { status: { in: ['confirmed', 'completed'] } },
            select: {
                id: true,
                slotId: true,
                date: true,
                status: true,
                frequency: true,
                weekDays: true,
                biweeklyWeeks: true,
                commitmentEndDate: true,
                startTimeOffset: true,
                durationMinutes: true,
                userName: true,
                userFirstName: true,
                userLastName: true,
            },
        }),
    ]);
    return { slots, reservations };
}

// GET /api/slots/priority?days=7 — turnos prioritarios de la semana (0 → 1 → 2 adoradores)
router.get('/priority', async (req, res) => {
    try {
        const days = Math.min(14, Math.max(1, Number(req.query.days) || 7));
        const startDate = req.query.date || todayStr();
        const max = Math.min(30, Math.max(1, Number(req.query.max) || 12));
        const { slots, reservations } = await loadActiveSlotsAndReservations();
        const priority = buildPriorityWeek({
            slots,
            reservations,
            startDate,
            days,
            max,
        });
        res.json(priority);
    } catch (e) {
        console.error(e);
        res.status(500).json({ error: 'Error al obtener turnos prioritarios.' });
    }
});

// GET /api/slots?date=YYYY-MM-DD
router.get('/', async (req, res) => {
    try {
        const date = req.query.date || todayStr();
        const { slots: allSlots, reservations: allReservations } = await loadActiveSlotsAndReservations();

        const { slots: eligible, message, note, weekday } = filterSlotsForDate(allSlots, date);

        const settings = await getSettings();

        const result = eligible.map((s) => {
            const commitments = allReservations.filter(
                (r) => r.slotId === s.id && commitmentAppliesOn(r, date),
            );
            const taken = commitments.length;
            const gapStatus = checkTimelineGaps(commitments);
            return withSlotTimeLabels({
                id: s.id,
                startTime: s.startTime,
                endTime: s.endTime,
                label: s.label,
                capacity: s.capacity,
                reserved: taken,
                available: Math.max(0, s.capacity - taken),
                critical: taken === 0 || gapStatus === GAP_STATUS.CRITICAL_GAP,
                gapAlert: gapStatus === GAP_STATUS.CRITICAL_GAP,
                fractional: hasFractionalCoverage(commitments),
            });
        });

        res.json({
            date,
            weekday,
            slots: result,
            message,
            note,
            settings: {
                frequencies: getEnabledFrequencies(settings),
                allowOffsetStartTimes: settings.allowOffsetStartTimes,
                allowThirtyMinuteDurations: settings.allowThirtyMinuteDurations,
            },
        });
    } catch (e) {
        console.error(e);
        res.status(500).json({ error: 'Error al obtener horarios.' });
    }
});

module.exports = router;
