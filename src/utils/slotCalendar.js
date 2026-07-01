const { weekdayFromDate } = require('./schedule');
const { slotAppliesOnWeekday, ALL_WEEKDAYS } = require('./slotWeekDays');
const { checkTimelineGaps, GAP_STATUS } = require('./timeline');
const { commitmentAppliesOn } = require('./commitmentMatch');
const { formatTimeRange12 } = require('./timeFormat');

const WEEKDAY_LABELS = {
    1: 'Lunes',
    2: 'Martes',
    3: 'Miércoles',
    4: 'Jueves',
    5: 'Viernes',
    6: 'Sábado',
    7: 'Domingo',
};

function countWeeklyActiveSlotOccurrences(slots) {
    let total = 0;
    for (const weekday of ALL_WEEKDAYS) {
        for (const slot of slots) {
            if (!slot.isActive) continue;
            if (!slotAppliesOnWeekday(slot, weekday)) continue;
            total += 1;
        }
    }
    return total;
}

function listWeeklyActiveSlotOccurrences(slots) {
    const items = [];
    const sorted = [...slots].sort((a, b) => a.startTime.localeCompare(b.startTime));
    for (const weekday of ALL_WEEKDAYS) {
        for (const slot of sorted) {
            if (!slot.isActive || !slotAppliesOnWeekday(slot, weekday)) continue;
            items.push({
                id: `${slot.id}-${weekday}`,
                slotId: slot.id,
                weekday,
                weekdayLabel: WEEKDAY_LABELS[weekday],
                label: slot.label,
                startTime: slot.startTime,
                endTime: slot.endTime,
                capacity: slot.capacity,
                timeLabel: formatTimeRange12(slot.startTime, slot.endTime, '–'),
            });
        }
    }
    return items;
}

function uniqueSlotTimeRows(slots) {
    const map = new Map();
    for (const slot of slots) {
        const key = `${slot.startTime}|${slot.endTime}`;
        if (!map.has(key)) {
            map.set(key, { startTime: slot.startTime, endTime: slot.endTime, key: `${slot.startTime}–${slot.endTime}` });
        }
    }
    return [...map.values()].sort((a, b) => a.startTime.localeCompare(b.startTime));
}

function buildCalendarDaySlots(allSlots, dateStr, reservations) {
    const weekday = weekdayFromDate(dateStr);
    const applicable = allSlots.filter((slot) => slotAppliesOnWeekday(slot, weekday));

    return applicable.map((slot) => {
        const isInactive = !slot.isActive;
        const commitments = isInactive
            ? []
            : reservations
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

        const gapStatus = isInactive ? null : checkTimelineGaps(commitments);
        const taken = commitments.length;

        return {
            slotId: slot.id,
            startTime: slot.startTime,
            endTime: slot.endTime,
            capacity: slot.capacity,
            isActive: slot.isActive,
            isInactive,
            taken,
            available: isInactive ? 0 : Math.max(0, slot.capacity - taken),
            needsMore: isInactive ? 0 : Math.max(0, slot.capacity - taken),
            gapAlert: !isInactive && gapStatus === GAP_STATUS.CRITICAL_GAP,
            commitments,
        };
    });
}

module.exports = {
    WEEKDAY_LABELS,
    countWeeklyActiveSlotOccurrences,
    listWeeklyActiveSlotOccurrences,
    uniqueSlotTimeRows,
    buildCalendarDaySlots,
};
