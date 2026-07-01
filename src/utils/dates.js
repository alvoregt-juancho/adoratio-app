// Helpers de fecha/hora en formato local simple (sin librerías externas).

function todayStr(d = new Date()) {
    const y = d.getFullYear();
    const m = String(d.getMonth() + 1).padStart(2, '0');
    const day = String(d.getDate()).padStart(2, '0');
    return `${y}-${m}-${day}`;
}

function nowHHMM(d = new Date()) {
    const h = String(d.getHours()).padStart(2, '0');
    const m = String(d.getMinutes()).padStart(2, '0');
    return `${h}:${m}`;
}

const { weekdayFromDate } = require('./schedule');

function isPastDate(dateStr) {
    return dateStr < todayStr();
}

function dateForWeekday(targetWeekday, fromDate = new Date()) {
    const today = new Date(fromDate);
    today.setHours(0, 0, 0, 0);
    const current = weekdayFromDate(todayStr(today));
    let diff = Number(targetWeekday) - current;
    if (diff < 0) diff += 7;
    const result = new Date(today);
    result.setDate(today.getDate() + diff);
    return todayStr(result);
}

module.exports = { todayStr, nowHHMM, isPastDate, dateForWeekday };
