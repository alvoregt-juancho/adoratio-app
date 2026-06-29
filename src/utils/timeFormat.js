/** Formato estándar 12 h (AM/PM) para usuarios. Almacenamiento interno: HH:MM 24 h. */

const TIME_24_RE = /^([01]?\d|2[0-3]):([0-5]\d)$/;
const TIME_12_RE = /^(\d{1,2})(?::([0-5]\d))?\s*(a\.?\s*m\.?|p\.?\s*m\.?)$/i;

function timeToMinutes(hhmm) {
    if (!hhmm) return 0;
    const [h, m] = String(hhmm).split(':').map(Number);
    return h * 60 + (m || 0);
}

function minutesToTime24(total) {
    const mins = ((total % (24 * 60)) + 24 * 60) % (24 * 60);
    const h = Math.floor(mins / 60);
    const m = mins % 60;
    return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
}

function addMinutesToTime(hhmm, minutes) {
    return minutesToTime24(timeToMinutes(hhmm) + minutes);
}

function formatTime12(hhmm) {
    if (!hhmm) return '';
    const mins = timeToMinutes(hhmm);
    const h = Math.floor(mins / 60);
    const m = mins % 60;
    const suffix = h < 12 ? 'AM' : 'PM';
    const hour12 = h % 12 || 12;
    return m ? `${hour12}:${String(m).padStart(2, '0')} ${suffix}` : `${hour12} ${suffix}`;
}

function formatTimeRange12(start, end, sep = ' – ') {
    if (!start || !end) return '';
    return `${formatTime12(start)}${sep}${formatTime12(end)}`;
}

function parseTimeInput(input) {
    const raw = String(input || '').trim().replace(/\s+/g, ' ');
    if (!raw) return null;

    const m12 = raw.match(TIME_12_RE);
    if (m12) {
        let hour = Number(m12[1]);
        const minute = m12[2] != null ? Number(m12[2]) : 0;
        const period = m12[3].replace(/\./g, '').toLowerCase();
        const isPm = period.startsWith('p');
        if (hour < 1 || hour > 12 || minute > 59) return null;
        if (hour === 12) hour = isPm ? 12 : 0;
        else if (isPm) hour += 12;
        return minutesToTime24(hour * 60 + minute);
    }

    const m24 = raw.match(TIME_24_RE);
    if (m24) {
        return `${String(Number(m24[1])).padStart(2, '0')}:${m24[2]}`;
    }

    return null;
}

function isValidTimeInput(input) {
    return parseTimeInput(input) !== null;
}

function formatTimeForInput(hhmm) {
    return formatTime12(hhmm);
}

function withSlotTimeLabels(slot) {
    if (!slot || typeof slot !== 'object') return slot;
    const out = { ...slot };
    if (out.startTime) out.startTimeLabel = formatTime12(out.startTime);
    if (out.endTime) out.endTimeLabel = formatTime12(out.endTime);
    if (out.startTime && out.endTime) out.timeLabel = formatTimeRange12(out.startTime, out.endTime);
    return out;
}

function normalizeTimeBody(body, fields = ['startTime', 'endTime']) {
    const out = { ...body };
    for (const field of fields) {
        if (out[field] === undefined || out[field] === null || out[field] === '') continue;
        const parsed = parseTimeInput(out[field]);
        if (!parsed) {
            return {
                error: `Hora inválida (${field === 'startTime' ? 'inicio' : 'fin'}). Usa formato estándar, ej. 7:00 AM.`,
            };
        }
        out[field] = parsed;
    }
    return { value: out };
}

module.exports = {
    timeToMinutes,
    minutesToTime24,
    addMinutesToTime,
    formatTime12,
    formatTimeRange12,
    formatTimeLabel: formatTime12,
    parseTimeInput,
    isValidTimeInput,
    formatTimeForInput,
    withSlotTimeLabels,
    normalizeTimeBody,
};
