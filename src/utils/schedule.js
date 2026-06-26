// Horario parroquial de adoración.
// Todos los días: 7:00–20:00, con bloques por misa según el día.

function weekdayFromDate(dateStr) {
    const [y, m, d] = dateStr.split('-').map(Number);
    const jsDay = new Date(y, m - 1, d).getDay();
    return jsDay === 0 ? 7 : jsDay;
}

function isAdorationDay(weekday) {
    return weekday >= 1 && weekday <= 7;
}

function getScheduleMessage() {
    return null;
}

function getDayNote(weekday) {
    if (weekday >= 2 && weekday <= 5) {
        return 'Sin adoración de 18:00 a 19:00 por celebración de misa.';
    }
    if (weekday === 7) {
        return 'Sin adoración de 10:00 a 13:00 y de 18:00 a 19:00 por celebración de misa.';
    }
    if (weekday === 1 || weekday === 6) {
        return 'Horario de adoración: 7:00 a.m. – 8:00 p.m.';
    }
    return null;
}

function isBlockedByMass(startTime, weekday) {
    // Martes–Viernes: misa 18:00–19:00
    if (weekday >= 2 && weekday <= 5 && startTime === '18:00') return true;
    // Domingo: misa 10:00–13:00 y 18:00–19:00
    if (weekday === 7) {
        if (startTime === '10:00' || startTime === '11:00' || startTime === '12:00') return true;
        if (startTime === '18:00') return true;
    }
    return false;
}

function isSlotAvailable(startTime, weekday) {
    if (!isAdorationDay(weekday)) return false;
    if (startTime < '07:00' || startTime >= '20:00') return false;
    return !isBlockedByMass(startTime, weekday);
}

function filterSlotsForDate(slots, dateStr) {
    const weekday = weekdayFromDate(dateStr);
    const { slotAppliesOnWeekday } = require('./slotWeekDays');
    const filtered = slots.filter(
        (s) =>
            s.isActive !== false &&
            slotAppliesOnWeekday(s, weekday) &&
            isSlotAvailable(s.startTime, weekday)
    );
    return {
        slots: filtered,
        message: filtered.length ? null : 'No hay turnos disponibles para este día.',
        note: getDayNote(weekday),
        weekday,
    };
}

module.exports = {
    weekdayFromDate,
    isAdorationDay,
    isSlotAvailable,
    getScheduleMessage,
    getDayNote,
    filterSlotsForDate,
};
