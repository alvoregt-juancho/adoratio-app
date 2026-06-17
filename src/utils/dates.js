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

function isPastDate(dateStr) {
    return dateStr < todayStr();
}

module.exports = { todayStr, nowHHMM, isPastDate };
