const { todayStr } = require('./dates');
const { filterSlotsForDate } = require('./schedule');
const {
    addDays,
    commitmentAppliesOn,
    weekdayFullLabel,
} = require('./commitmentMatch');
const { checkTimelineGaps, GAP_STATUS } = require('./timeline');
const { formatTimeRange12, withSlotTimeLabels } = require('./timeFormat');

const PRIORITY_TIERS = [0, 1, 2];

const TIER_LABELS = {
    0: 'Sin adoradores',
    1: 'Solo 1 adorador',
    2: 'Solo 2 adoradores',
};

/**
 * Ocupación de cada franja activa en los próximos `days` días
 * (usa commitmentAppliesOn para compromisos semanales/diarios).
 */
function buildWeekSlotOccupancy({
    slots,
    reservations,
    startDate = todayStr(),
    days = 7,
}) {
    const items = [];
    for (let i = 0; i < days; i += 1) {
        const date = addDays(startDate, i);
        const { slots: eligible } = filterSlotsForDate(slots, date);
        for (const slot of eligible) {
            const commitments = reservations.filter(
                (r) => r.slotId === slot.id && commitmentAppliesOn(r, date),
            );
            const reserved = commitments.length;
            const gapStatus = checkTimelineGaps(commitments);
            items.push(withSlotTimeLabels({
                date,
                weekdayLabel: weekdayFullLabel(date),
                slotId: slot.id,
                id: slot.id,
                startTime: slot.startTime,
                endTime: slot.endTime,
                label: slot.label,
                capacity: slot.capacity,
                reserved,
                available: Math.max(0, slot.capacity - reserved),
                gapAlert: gapStatus === GAP_STATUS.CRITICAL_GAP,
                critical: reserved === 0 || gapStatus === GAP_STATUS.CRITICAL_GAP,
                priorityTier: reserved <= 2 ? reserved : null,
                commitments: commitments.map((r) => ({
                    id: r.id,
                    userName: r.userName,
                    userFirstName: r.userFirstName,
                    userLastName: r.userLastName,
                    startTimeOffset: r.startTimeOffset,
                    durationMinutes: r.durationMinutes,
                    frequency: r.frequency,
                    status: r.status,
                })),
                timeLabel: formatTimeRange12(slot.startTime, slot.endTime, ' – '),
            }));
        }
    }
    return items;
}

/**
 * Cascada de prioridad semanal:
 * 1) franjas con 0 adoradores
 * 2) si no hay, con 1
 * 3) si no hay, con 2
 */
function selectPrioritySlots(items, { max = 12 } = {}) {
    for (const tier of PRIORITY_TIERS) {
        const matched = items
            .filter((s) => s.reserved === tier)
            .sort((a, b) => {
                const byDate = String(a.date).localeCompare(String(b.date));
                if (byDate !== 0) return byDate;
                return String(a.startTime).localeCompare(String(b.startTime));
            });
        if (matched.length) {
            return {
                tier,
                tierLabel: TIER_LABELS[tier],
                slots: matched.slice(0, max),
                totalInTier: matched.length,
            };
        }
    }
    return {
        tier: null,
        tierLabel: null,
        slots: [],
        totalInTier: 0,
    };
}

function buildPriorityWeek({
    slots,
    reservations,
    startDate = todayStr(),
    days = 7,
    max = 12,
}) {
    const occupancy = buildWeekSlotOccupancy({
        slots,
        reservations,
        startDate,
        days,
    });
    const priority = selectPrioritySlots(occupancy, { max });
    return {
        startDate,
        days,
        ...priority,
    };
}

module.exports = {
    PRIORITY_TIERS,
    TIER_LABELS,
    buildWeekSlotOccupancy,
    selectPrioritySlots,
    buildPriorityWeek,
};
