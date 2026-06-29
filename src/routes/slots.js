const express = require('express');
const prisma = require('../db');
const { todayStr } = require('../utils/dates');
const { filterSlotsForDate } = require('../utils/schedule');
const { getSettings } = require('../utils/settings');
const { getEnabledFrequencies } = require('../constants/commitment');
const { formatTimeRange12, withSlotTimeLabels } = require('../utils/timeFormat');
const { checkTimelineGaps, hasFractionalCoverage, GAP_STATUS } = require('../utils/timeline');

const router = express.Router();

// GET /api/slots?date=YYYY-MM-DD
router.get('/', async (req, res) => {
    try {
        const date = req.query.date || todayStr();
        const allSlots = await prisma.slot.findMany({
            where: { isActive: true },
            orderBy: { startTime: 'asc' },
        });

        const { slots: eligible, message, note, weekday } = filterSlotsForDate(allSlots, date);

        const reservations = await prisma.reservation.groupBy({
            by: ['slotId'],
            where: { date, status: { in: ['confirmed', 'completed'] } },
            _count: { _all: true },
        });
        const countBySlot = Object.fromEntries(
            reservations.map((r) => [r.slotId, r._count._all])
        );

        const reservationDetails = await prisma.reservation.findMany({
            where: { date, status: { in: ['confirmed', 'completed'] } },
            select: { slotId: true, startTimeOffset: true, durationMinutes: true },
        });
        const commitmentsBySlot = {};
        for (const r of reservationDetails) {
            if (!commitmentsBySlot[r.slotId]) commitmentsBySlot[r.slotId] = [];
            commitmentsBySlot[r.slotId].push(r);
        }

        const settings = await getSettings();

        const result = eligible.map((s) => {
            const taken = countBySlot[s.id] || 0;
            const commitments = commitmentsBySlot[s.id] || [];
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
