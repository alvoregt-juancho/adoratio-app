/**
 * Días de la semana para compromisos diarios (1 = Lunes … 7 = Domingo).
 */

function parseWeekDays(raw) {
    if (raw == null || raw === '') return [];
    const parts = Array.isArray(raw) ? raw : String(raw).split(',');
    const days = parts
        .map((p) => Number(String(p).trim()))
        .filter((d) => Number.isInteger(d) && d >= 1 && d <= 7);
    return [...new Set(days)].sort((a, b) => a - b);
}

function formatWeekDays(raw) {
    const labels = ['', 'Lun', 'Mar', 'Mié', 'Jue', 'Vie', 'Sáb', 'Dom'];
    return parseWeekDays(raw).map((d) => labels[d]).join(', ');
}

function isValidWeekDays(raw) {
    const days = parseWeekDays(raw);
    return days.length >= 1 && days.length <= 7;
}

module.exports = {
    parseWeekDays,
    formatWeekDays,
    isValidWeekDays,
};
