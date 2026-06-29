const { FREQUENCY_LABELS } = require('../constants/commitment');
const { participationWeekdays } = require('./commitmentMatch');
const { parseWeekDays } = require('./weekDays');

const WEEKDAY_FULL = ['', 'lunes', 'martes', 'miércoles', 'jueves', 'viernes', 'sábado', 'domingo'];
const ROSTER_WEEKDAY_ORDER = [7, 1, 2, 3, 4, 5, 6];

function parseSlotTimes(raw) {
    if (raw == null || raw === '') return [];
    return String(raw)
        .split(',')
        .map((s) => s.trim())
        .filter((t) => /^\d{2}:\d{2}$/.test(t));
}

function formatSlotTimes(raw) {
    const times = parseSlotTimes(raw);
    if (!times.length) return 'Todos';
    return times.map(formatRosterTime).join(', ');
}

function formatWeekDaysFilter(raw) {
    const days = parseWeekDays(raw);
    if (!days.length) return 'Todos';
    return days.map((d) => WEEKDAY_FULL[d]).join(', ');
}

const { formatTime12 } = require('./timeFormat');

function formatRosterTime(hhmm) {
    return formatTime12(hhmm);
}

function addMinutesToTime(hhmm, minutes) {
    const [h, m] = hhmm.split(':').map(Number);
    const total = h * 60 + m + minutes;
    const nh = Math.floor(total / 60) % 24;
    const nm = total % 60;
    return `${String(nh).padStart(2, '0')}:${String(nm).padStart(2, '0')}`;
}

function effectiveSlotTime(reservation) {
    const base = reservation.slot?.startTime || '00:00';
    const offset = reservation.startTimeOffset ?? 0;
    return offset ? addMinutesToTime(base, offset) : base;
}

function durationLabel(minutes) {
    if (minutes === 30) return '30 minutos';
    if (minutes === 60) return '1 hora';
    return `${minutes} minutos`;
}

function rosterMemberMatchesFilter(member, weekdayFilter, slotTimeFilter) {
    const days = parseWeekDays(member.weekDays);
    const times = parseSlotTimes(member.slotTimes);

    if (weekdayFilter) {
        const wd = Number(weekdayFilter);
        if (days.length > 0 && !days.includes(wd)) return false;
    }

    if (slotTimeFilter) {
        if (times.length > 0 && !times.includes(slotTimeFilter)) return false;
    }

    return true;
}

function commitmentRowMatchesFilter(row, weekdayFilter, slotTimeFilter) {
    if (weekdayFilter && row.weekday !== Number(weekdayFilter)) return false;
    if (slotTimeFilter && row.slotTime !== slotTimeFilter) return false;
    return true;
}

function reservationToCommitmentRows(reservation) {
    const weekdays = participationWeekdays(reservation);
    if (!reservation.slot || !weekdays.length) return [];

    const slotTime = effectiveSlotTime(reservation);
    const frequency = reservation.frequency || 'WEEKLY';

    return weekdays.map((wd) => ({
        id: `${reservation.id}-${wd}`,
        reservationId: reservation.id,
        weekday: wd,
        turno: `${WEEKDAY_FULL[wd]} ${formatRosterTime(slotTime)}`,
        slotTime,
        durationMinutes: reservation.durationMinutes ?? 60,
        durationLabel: durationLabel(reservation.durationMinutes ?? 60),
        frequency,
        frequencyLabel: FREQUENCY_LABELS[frequency] || frequency,
        firstName: reservation.userFirstName || '',
        lastName: reservation.userLastName || '',
        phone: reservation.userPhone,
        email: null,
        internalNotes: '',
    }));
}

function rosterMemberToRow(member) {
    return {
        id: member.id,
        role: member.role,
        firstName: member.firstName,
        lastName: member.lastName,
        phone: member.phone,
        email: member.email || '',
        internalNotes: member.internalNotes || '',
        weekDays: member.weekDays,
        slotTimes: member.slotTimes,
        daysLabel: formatWeekDaysFilter(member.weekDays),
        timesLabel: formatSlotTimes(member.slotTimes),
        isActive: member.isActive,
    };
}

function sortRosterRows(rows) {
    return [...rows].sort((a, b) => {
        const oa = a.weekday != null ? ROSTER_WEEKDAY_ORDER.indexOf(a.weekday) : 99;
        const ob = b.weekday != null ? ROSTER_WEEKDAY_ORDER.indexOf(b.weekday) : 99;
        if (oa !== ob) return oa - ob;
        const ta = a.slotTime || '';
        const tb = b.slotTime || '';
        if (ta !== tb) return ta.localeCompare(tb);
        const la = (a.lastName || a.firstName || '').toLowerCase();
        const lb = (b.lastName || b.firstName || '').toLowerCase();
        return la.localeCompare(lb);
    });
}

function sortMembersByName(rows) {
    return [...rows].sort((a, b) => {
        const la = (a.lastName || a.firstName || '').toLowerCase();
        const lb = (b.lastName || b.firstName || '').toLowerCase();
        if (la !== lb) return la.localeCompare(lb);
        return (a.firstName || '').toLowerCase().localeCompare((b.firstName || '').toLowerCase());
    });
}

module.exports = {
    WEEKDAY_FULL,
    ROSTER_WEEKDAY_ORDER,
    parseSlotTimes,
    formatSlotTimes,
    formatWeekDaysFilter,
    formatRosterTime,
    effectiveSlotTime,
    rosterMemberMatchesFilter,
    commitmentRowMatchesFilter,
    reservationToCommitmentRows,
    rosterMemberToRow,
    sortRosterRows,
    sortMembersByName,
};
