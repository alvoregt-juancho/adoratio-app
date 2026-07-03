const { COMMITMENT_FREQUENCY } = require('../constants/commitment');
const { weekdayFromDate } = require('./schedule');
const { parseWeekDays } = require('./weekDays');
const { BIWEEKLY_WEEK_OPTIONS } = require('./biweeklyWeeks');

/** Semana del mes (1–4): días 1–7 → 1, 8–14 → 2, etc. */
function weekOfMonth(dateStr) {
    const day = Number(dateStr.split('-')[2]);
    return Math.min(4, Math.ceil(day / 7));
}

function commitmentAppliesOn(reservation, dateStr) {
    if (!reservation || reservation.status === 'cancelled') return false;
    if (dateStr < reservation.date) return false;
    if (reservation.commitmentEndDate && dateStr > reservation.commitmentEndDate) return false;

    const frequency = reservation.frequency || COMMITMENT_FREQUENCY.WEEKLY;
    const anchorWeekday = weekdayFromDate(reservation.date);
    const targetWeekday = weekdayFromDate(dateStr);

    switch (frequency) {
        case COMMITMENT_FREQUENCY.ONCE:
            return dateStr === reservation.date;

        case COMMITMENT_FREQUENCY.WEEKLY: {
            const days = parseWeekDays(reservation.weekDays);
            if (days.length === 1) return targetWeekday === days[0];
            return targetWeekday === anchorWeekday;
        }

        case COMMITMENT_FREQUENCY.DAILY: {
            const days = parseWeekDays(reservation.weekDays);
            return days.length > 0 && days.includes(targetWeekday);
        }

        case COMMITMENT_FREQUENCY.BIWEEKLY: {
            if (targetWeekday !== anchorWeekday) return false;
            const key = String(reservation.biweeklyWeeks || '').trim();
            const allowed = BIWEEKLY_WEEK_OPTIONS[key]?.weeks;
            if (!allowed) return false;
            return allowed.includes(weekOfMonth(dateStr));
        }

        case COMMITMENT_FREQUENCY.MONTHLY: {
            const anchorDay = Number(reservation.date.split('-')[2]);
            const targetDay = Number(dateStr.split('-')[2]);
            return anchorDay === targetDay;
        }

        default:
            return dateStr === reservation.date;
    }
}

/** Días de la semana (1=Lun … 7=Dom) en que participa este compromiso. */
function participationWeekdays(reservation) {
    if (!reservation || reservation.status === 'cancelled') return [];

    const frequency = reservation.frequency || COMMITMENT_FREQUENCY.WEEKLY;

    if (frequency === COMMITMENT_FREQUENCY.DAILY) {
        return parseWeekDays(reservation.weekDays);
    }

    if (
        frequency === COMMITMENT_FREQUENCY.WEEKLY ||
        frequency === COMMITMENT_FREQUENCY.BIWEEKLY ||
        frequency === COMMITMENT_FREQUENCY.MONTHLY ||
        frequency === COMMITMENT_FREQUENCY.ONCE
    ) {
        const explicit = parseWeekDays(reservation.weekDays);
        if (explicit.length === 1) return explicit;
        return [weekdayFromDate(reservation.date)];
    }

    return [];
}

function parseDateParts(dateStr) {
    const [y, m, d] = dateStr.split('-').map(Number);
    return { y, m, d, date: new Date(y, m - 1, d) };
}

function formatDateStr(y, m, d) {
    return `${y}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
}

/** Domingo de la semana que contiene dateStr. */
function startOfWeekSunday(dateStr) {
    const { y, m, d, date } = parseDateParts(dateStr);
    const jsDay = date.getDay();
    const diff = jsDay;
    const start = new Date(y, m - 1, d - diff);
    return formatDateStr(start.getFullYear(), start.getMonth() + 1, start.getDate());
}

function addDays(dateStr, n) {
    const { y, m, d } = parseDateParts(dateStr);
    const next = new Date(y, m - 1, d + n);
    return formatDateStr(next.getFullYear(), next.getMonth() + 1, next.getDate());
}

/** Suma meses calendario a una fecha YYYY-MM-DD. */
function addMonths(dateStr, months) {
    const { y, m, d } = parseDateParts(dateStr);
    const end = new Date(y, m - 1 + Number(months), d);
    return formatDateStr(end.getFullYear(), end.getMonth() + 1, end.getDate());
}

const COMMITMENT_TERM_MONTHS = [1, 3, 6, 12];

function commitmentEndDateFromMonths(startDate, months) {
    if (!COMMITMENT_TERM_MONTHS.includes(Number(months))) return null;
    return addMonths(startDate, Number(months));
}

function daysInMonth(y, m) {
    return new Date(y, m, 0).getDate();
}

/** Genera fechas YYYY-MM-DD para un rango semanal o mensual. */
function dateRangeForView(view, anchorDate) {
    const anchor = anchorDate || formatDateStr(
        new Date().getFullYear(),
        new Date().getMonth() + 1,
        new Date().getDate(),
    );

    if (view === 'month') {
        const { y, m } = parseDateParts(anchor);
        const total = daysInMonth(y, m);
        const dates = [];
        for (let d = 1; d <= total; d++) {
            dates.push(formatDateStr(y, m, d));
        }
        return {
            dates,
            label: new Date(y, m - 1, 1).toLocaleDateString('es-CR', { month: 'long', year: 'numeric' }),
            start: formatDateStr(y, m, 1),
            end: formatDateStr(y, m, total),
        };
    }

    const start = startOfWeekSunday(anchor);
    const dates = [];
    for (let i = 0; i < 7; i++) {
        dates.push(addDays(start, i));
    }
    const startLabel = new Date(dates[0] + 'T12:00:00').toLocaleDateString('es-CR', { day: 'numeric', month: 'short' });
    const endLabel = new Date(dates[6] + 'T12:00:00').toLocaleDateString('es-CR', { day: 'numeric', month: 'short' });
    return {
        dates,
        label: `${startLabel} – ${endLabel}`,
        start: dates[0],
        end: dates[6],
    };
}

const WEEKDAY_SHORT = ['', 'lun', 'mar', 'mié', 'jue', 'vie', 'sáb', 'dom'];
const WEEKDAY_FULL = ['', 'Lunes', 'Martes', 'Miércoles', 'Jueves', 'Viernes', 'Sábado', 'Domingo'];

function weekdayShortLabel(dateStr) {
    const wd = weekdayFromDate(dateStr);
    const day = dateStr.split('-')[2];
    return `${WEEKDAY_SHORT[wd]} ${Number(day)}`;
}

function weekdayFullLabel(dateStr) {
    return WEEKDAY_FULL[weekdayFromDate(dateStr)] || '';
}

function commitmentDaysLabel(reservation) {
    return participationWeekdays(reservation).map((d) => WEEKDAY_FULL[d]).join(', ');
}

/** Todas las fechas YYYY-MM-DD entre start y end (inclusive). */
function eachDateInRange(start, end) {
    const dates = [];
    let cur = start;
    while (cur <= end) {
        dates.push(cur);
        cur = addDays(cur, 1);
    }
    return dates;
}

function resolveReservationScope(query, defaultDate) {
    const anchor = query.start || query.date || defaultDate;
    if (query.view === 'week' || query.view === 'month') {
        const range = dateRangeForView(query.view, anchor);
        return { expand: true, start: range.start, end: range.end, label: range.label, view: query.view };
    }
    if (query.start && query.end) {
        return { expand: true, start: query.start, end: query.end, label: `${query.start} – ${query.end}` };
    }
    if (query.start) {
        return { expand: true, start: query.start, end: query.start, label: query.start };
    }
    if (query.date) {
        return { expand: true, start: query.date, end: query.date, label: query.date };
    }
    return { expand: false };
}

function expandReservationsInRange(reservations, start, end) {
    const dates = eachDateInRange(start, end);
    const rows = [];
    for (const r of reservations) {
        for (const d of dates) {
            if (!commitmentAppliesOn(r, d)) continue;
            rows.push({
                ...r,
                date: d,
                occurrenceDate: d,
                reservationId: r.id,
            });
        }
    }
    return rows.sort((a, b) => {
        if (a.date !== b.date) return a.date.localeCompare(b.date);
        const ta = a.slot?.startTime || '';
        const tb = b.slot?.startTime || '';
        if (ta !== tb) return ta.localeCompare(tb);
        return (a.userLastName || '').localeCompare(b.userLastName || '');
    });
}

module.exports = {
    commitmentAppliesOn,
    participationWeekdays,
    weekOfMonth,
    startOfWeekSunday,
    addDays,
    addMonths,
    commitmentEndDateFromMonths,
    COMMITMENT_TERM_MONTHS,
    dateRangeForView,
    weekdayShortLabel,
    weekdayFullLabel,
    commitmentDaysLabel,
    formatDateStr,
    eachDateInRange,
    resolveReservationScope,
    expandReservationsInRange,
};
