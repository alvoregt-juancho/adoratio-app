const prisma = require('../db');
const { todayStr, isPastDate, dateForWeekday } = require('./dates');
const { normalizePhone, isValidPhone } = require('./phone');
const { parseParticipantNames, buildFullName } = require('./name');
const { getSettings } = require('./settings');
const { isAdorationDay, isSlotAvailable, weekdayFromDate } = require('./schedule');
const { isValidFrequency, COMMITMENT_FREQUENCY, getEnabledFrequencies } = require('../constants/commitment');
const { parseWeekDays, isValidWeekDays } = require('./weekDays');
const { isValidBiweeklyWeeks } = require('./biweeklyWeeks');
const { commitmentEndDateFromMonths, COMMITMENT_TERM_MONTHS } = require('./commitmentMatch');

async function findSlotForCommitment({ slotTime, weekday, durationMinutes, startTimeOffset = 0 }) {
    const slots = await prisma.slot.findMany({ where: { isActive: true } });
    for (const slot of slots) {
        const base = slot.startTime;
        const effective = startTimeOffset ? addMinutes(base, startTimeOffset) : base;
        if (effective !== slotTime) continue;
        if (slot.weekDays) {
            const days = parseWeekDays(slot.weekDays);
            if (days.length && !days.includes(weekday)) continue;
        }
        const slotDuration = minutesBetween(base, slot.endTime);
        if (durationMinutes > slotDuration) continue;
        return slot;
    }
    return null;
}

function addMinutes(hhmm, minutes) {
    const [h, m] = hhmm.split(':').map(Number);
    const total = h * 60 + m + minutes;
    const nh = Math.floor(total / 60) % 24;
    const nm = total % 60;
    return `${String(nh).padStart(2, '0')}:${String(nm).padStart(2, '0')}`;
}

function minutesBetween(start, end) {
    const [sh, sm] = start.split(':').map(Number);
    const [eh, em] = end.split(':').map(Number);
    return eh * 60 + em - (sh * 60 + sm);
}

async function createAdminReservation(body, { req } = {}) {
    const slotId = body?.slotId != null ? Number(body.slotId) : null;
    const { first, last, full } = parseParticipantNames(body);
    const userPhone = normalizePhone(body?.userPhone);
    const anchorWeekday = body?.weekday != null ? Number(body.weekday) : weekdayFromDate(body?.date || todayStr());
    const date = body?.date || dateForWeekday(anchorWeekday);
    const frequency = body?.frequency || COMMITMENT_FREQUENCY.WEEKLY;
    const weekDaysRaw = body?.weekDays;
    const biweeklyWeeksRaw = body?.biweeklyWeeks;
    const durationMinutes = Number(body?.durationMinutes ?? 60);
    const startTimeOffset = Number(body?.startTimeOffset ?? 0);
    const commitmentMonths = Number(body?.commitmentMonths ?? 12);

    if ((!slotId && !body?.slotTime) || !first || !userPhone) {
        const err = new Error('Turno, nombre y celular son requeridos.');
        err.status = 400;
        throw err;
    }
    if (!isValidPhone(userPhone)) {
        const err = new Error('El celular debe tener exactamente 8 dígitos.');
        err.status = 400;
        throw err;
    }
    if (isPastDate(date)) {
        const err = new Error('La fecha de inicio no puede ser pasada.');
        err.status = 400;
        throw err;
    }
    if (!isValidFrequency(frequency)) {
        const err = new Error('Frecuencia de guardia inválida.');
        err.status = 400;
        throw err;
    }
    if (![30, 60].includes(durationMinutes)) {
        const err = new Error('Duración inválida (30 o 60 minutos).');
        err.status = 400;
        throw err;
    }
    if (![0, 30].includes(startTimeOffset)) {
        const err = new Error('Desfase de inicio inválido (0 o 30 minutos).');
        err.status = 400;
        throw err;
    }
    if (!COMMITMENT_TERM_MONTHS.includes(commitmentMonths)) {
        const err = new Error('Tiempo de compromiso inválido.');
        err.status = 400;
        throw err;
    }

    const settings = await getSettings();
    const enabledFreqs = getEnabledFrequencies(settings);
    if (!enabledFreqs.includes(frequency)) {
        const err = new Error('Esta frecuencia no está habilitada en configuración.');
        err.status = 400;
        throw err;
    }

    let weekDays = null;
    if (frequency === COMMITMENT_FREQUENCY.DAILY) {
        const raw = weekDaysRaw || String(anchorWeekday);
        if (!isValidWeekDays(raw)) {
            const err = new Error('Selecciona al menos un día de la semana.');
            err.status = 400;
            throw err;
        }
        weekDays = parseWeekDays(raw).join(',');
    } else if (frequency === COMMITMENT_FREQUENCY.WEEKLY) {
        weekDays = String(anchorWeekday);
    }

    let biweeklyWeeks = null;
    if (frequency === COMMITMENT_FREQUENCY.BIWEEKLY) {
        if (!isValidBiweeklyWeeks(biweeklyWeeksRaw || '1,3')) {
            const err = new Error('Semanas quincenales inválidas.');
            err.status = 400;
            throw err;
        }
        biweeklyWeeks = String(biweeklyWeeksRaw || '1,3').trim();
    }

    let slot = null;
    if (slotId) {
        slot = await prisma.slot.findFirst({ where: { id: slotId, isActive: true } });
    } else {
        slot = await findSlotForCommitment({
            slotTime: body.slotTime,
            weekday: anchorWeekday,
            durationMinutes,
            startTimeOffset,
        });
    }
    if (!slot) {
        const err = new Error('No hay un turno activo que coincida con el día y la hora indicados.');
        err.status = 400;
        throw err;
    }

    if (!isAdorationDay(anchorWeekday)) {
        const err = new Error('El día seleccionado no tiene adoración.');
        err.status = 400;
        throw err;
    }
    if (!isSlotAvailable(slot.startTime, anchorWeekday)) {
        const err = new Error('Este horario no está disponible por celebración de misa.');
        err.status = 400;
        throw err;
    }

    const commitmentEndDate = commitmentEndDateFromMonths(date, commitmentMonths);

    const reservation = await prisma.reservation.create({
        data: {
            slotId: slot.id,
            userPhone,
            userFirstName: first,
            userLastName: last,
            userName: full || buildFullName(first, last),
            date,
            frequency,
            weekDays,
            biweeklyWeeks,
            durationMinutes,
            startTimeOffset,
            commitmentEndDate,
            status: 'confirmed',
        },
        include: { slot: true },
    });

    return reservation;
}

module.exports = {
    findSlotForCommitment,
    createAdminReservation,
};
