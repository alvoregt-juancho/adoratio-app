const { commitmentAppliesOn } = require('./commitmentMatch');
const { todayStr } = require('./dates');
const { addMinutesToTime } = require('./timeFormat');

/** Fechas YYYY-MM-DD en las que aplica el compromiso en los próximos N días. */
function getUpcomingOccurrenceDates(reservation, daysAhead = 7, fromDate = todayStr()) {
    const dates = [];
    const start = new Date(`${fromDate}T12:00:00`);
    for (let i = 0; i <= daysAhead; i++) {
        const d = new Date(start);
        d.setDate(start.getDate() + i);
        const dateStr = d.toISOString().slice(0, 10);
        if (commitmentAppliesOn(reservation, dateStr)) {
            dates.push(dateStr);
        }
    }
    return dates;
}

/** Date de inicio real del turno (con offset de 30 min si aplica). */
function getOccurrenceDateTime(dateStr, slotStartTime, startTimeOffset = 0) {
    const time = addMinutesToTime(slotStartTime, startTimeOffset);
    return new Date(`${dateStr}T${time}:00`);
}

/** Horas hasta la ocurrencia desde ahora. */
function hoursUntilOccurrence(dateStr, slotStartTime, startTimeOffset = 0) {
    const occurrence = getOccurrenceDateTime(dateStr, slotStartTime, startTimeOffset);
    return (occurrence - new Date()) / (1000 * 60 * 60);
}

module.exports = {
    getUpcomingOccurrenceDates,
    getOccurrenceDateTime,
    hoursUntilOccurrence,
};
