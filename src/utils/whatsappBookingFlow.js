const prisma = require('../db');
const { todayStr } = require('./dates');
const { filterSlotsForDate, weekdayFromDate, isSlotAvailable } = require('./schedule');
const { slotAppliesOnWeekday } = require('./slotWeekDays');
const { formatTimeRange12 } = require('./timeFormat');
const { getSettings } = require('./settings');
const { COMMITMENT_FREQUENCY, FREQUENCY_LABELS, getEnabledFrequencies } = require('../constants/commitment');
const { commitmentEndDateFromMonths } = require('./commitmentMatch');
const { generateCancelToken } = require('./cancelToken');

const DAY_LABELS = ['', 'Lunes', 'Martes', 'Miércoles', 'Jueves', 'Viernes', 'Sábado', 'Domingo'];

function nextDateForWeekday(weekday) {
    const start = new Date(`${todayStr()}T12:00:00`);
    for (let i = 0; i < 21; i++) {
        const d = new Date(start);
        d.setDate(start.getDate() + i);
        const dateStr = d.toISOString().slice(0, 10);
        if (weekdayFromDate(dateStr) === Number(weekday)) return dateStr;
    }
    return todayStr();
}

async function countAvailable(slotId, dateStr) {
    const slot = await prisma.slot.findUnique({ where: { id: slotId } });
    if (!slot) return 0;
    const taken = await prisma.reservation.count({
        where: { slotId, date: dateStr, status: { in: ['confirmed', 'completed'] } },
    });
    return Math.max(0, slot.capacity - taken);
}

async function getTimeSlotsForWeekday(weekday) {
    const allSlots = await prisma.slot.findMany({
        where: { isActive: true },
        orderBy: { startTime: 'asc' },
    });
    const dateStr = nextDateForWeekday(weekday);
    const { slots: eligible } = filterSlotsForDate(allSlots, dateStr);
    const byStart = new Map();

    for (const slot of eligible) {
        if (!slotAppliesOnWeekday(slot, weekday) || !isSlotAvailable(slot.startTime, weekday)) continue;
        const available = await countAvailable(slot.id, dateStr);
        if (available <= 0) continue;
        const key = slot.startTime;
        if (!byStart.has(key)) {
            byStart.set(key, {
                slotId: slot.id,
                startTime: slot.startTime,
                endTime: slot.endTime,
                available,
                label: formatTimeRange12(slot.startTime, slot.endTime),
            });
        }
    }

    return {
        dateStr,
        options: [...byStart.values()],
    };
}

async function getAvailableWeekdays() {
    const result = [];
    for (let wd = 1; wd <= 7; wd++) {
        const { options } = await getTimeSlotsForWeekday(wd);
        if (options.length) result.push(wd);
    }
    return result;
}

async function buildWeekdayPrompt() {
    const days = await getAvailableWeekdays();
    if (!days.length) return null;
    const lines = days.map((wd, i) => `${i + 1}. ${DAY_LABELS[wd]}`);
    return {
        days,
        text: `*Paso 1 — Día de la semana*\n\n¿Qué día deseas adorar? Responde con el *número*:\n\n${lines.join('\n')}\n\n_Escribe *menu* para cancelar._`,
    };
}

async function buildTimePrompt(weekday) {
    const { dateStr, options } = await getTimeSlotsForWeekday(weekday);
    if (!options.length) return null;
    const lines = options.map((o, i) => `${i + 1}. ${o.label} (${o.available} cupo${o.available === 1 ? '' : 's'})`);
    return {
        dateStr,
        options,
        text:
            `*Paso 2 — Hora del día* (${DAY_LABELS[weekday]})\n\n` +
            `Elige el horario (número):\n\n${lines.join('\n')}\n\n_Escribe *menu* para cancelar._`,
    };
}

async function buildFrequencyPrompt() {
    const settings = await getSettings();
    const enabled = getEnabledFrequencies(settings);
    const choices = [];
    if (enabled.includes(COMMITMENT_FREQUENCY.WEEKLY)) {
        choices.push({ index: choices.length + 1, value: COMMITMENT_FREQUENCY.WEEKLY, label: FREQUENCY_LABELS.WEEKLY });
    }
    if (enabled.includes(COMMITMENT_FREQUENCY.BIWEEKLY)) {
        choices.push({ index: choices.length + 1, value: COMMITMENT_FREQUENCY.BIWEEKLY, label: FREQUENCY_LABELS.BIWEEKLY });
    }
    if (enabled.includes(COMMITMENT_FREQUENCY.DAILY)) {
        choices.push({ index: choices.length + 1, value: COMMITMENT_FREQUENCY.DAILY, label: FREQUENCY_LABELS.DAILY });
    }
    if (!choices.length) {
        choices.push({ index: 1, value: COMMITMENT_FREQUENCY.WEEKLY, label: FREQUENCY_LABELS.WEEKLY });
    }
    const lines = choices.map((c) => `${c.index}. ${c.label}`);
    return {
        choices,
        text: `*Paso 3 — Frecuencia*\n\n${lines.join('\n')}\n\n_Escribe *menu* para cancelar._`,
    };
}

function buildBiweeklyPrompt() {
    return {
        choices: [
            { index: 1, value: '1,3', label: 'Semanas 1 y 3 del mes' },
            { index: 2, value: '2,4', label: 'Semanas 2 y 4 del mes' },
        ],
        text:
            `*Frecuencia quincenal*\n\n` +
            `1. Semanas 1 y 3 del mes\n` +
            `2. Semanas 2 y 4 del mes\n\n` +
            `_Escribe *menu* para cancelar._`,
    };
}

async function buildDurationPrompt() {
    const settings = await getSettings();
    const choices = [{ index: 1, durationMinutes: 60, startTimeOffset: 0, label: '1 hora' }];
    if (settings.allowThirtyMinuteDurations) {
        choices.push({ index: choices.length + 1, durationMinutes: 30, startTimeOffset: 0, label: '30 minutos' });
        if (settings.allowOffsetStartTimes) {
            choices.push({
                index: choices.length + 1,
                durationMinutes: 30,
                startTimeOffset: 30,
                label: '30 minutos (inicio a :30)',
            });
        }
    }
    if (choices.length === 1) {
        return { choices, text: null, auto: choices[0] };
    }
    const lines = choices.map((c) => `${c.index}. ${c.label}`);
    return {
        choices,
        text: `*Paso 4 — Duración*\n\n${lines.join('\n')}\n\n_Escribe *menu* para cancelar._`,
        auto: null,
    };
}

async function createReservationFromWhatsApp(phone, data) {
    const {
        slotId,
        dateStr,
        firstName,
        lastName,
        frequency = COMMITMENT_FREQUENCY.WEEKLY,
        durationMinutes = 60,
        startTimeOffset = 0,
        weekDays = null,
        biweeklyWeeks = null,
        commitmentMonths = 3,
        weekday,
    } = data;

    const commitmentEndDate = commitmentEndDateFromMonths(dateStr, commitmentMonths);
    const slot = await prisma.slot.findFirst({ where: { id: Number(slotId), isActive: true } });
    if (!slot) throw new Error('Turno no disponible.');

    const dup = await prisma.reservation.findFirst({
        where: { slotId: slot.id, userPhone: phone, date: dateStr, status: { in: ['confirmed', 'completed'] } },
    });
    if (dup) throw new Error('Ya tienes una reserva para este turno.');

    const taken = await prisma.reservation.count({
        where: { slotId: slot.id, date: dateStr, status: { in: ['confirmed', 'completed'] } },
    });
    if (taken >= slot.capacity) throw new Error('Este turno ya está completo.');

    const fullName = [firstName, lastName].filter(Boolean).join(' ').trim();
    let resolvedWeekDays = weekDays;
    if (frequency === COMMITMENT_FREQUENCY.WEEKLY && weekday) {
        resolvedWeekDays = String(weekday);
    }
    if (frequency === COMMITMENT_FREQUENCY.DAILY && weekday) {
        resolvedWeekDays = String(weekday);
    }

    const reservation = await prisma.reservation.create({
        data: {
            slotId: slot.id,
            userPhone: phone,
            userFirstName: firstName,
            userLastName: lastName || '',
            userName: fullName,
            date: dateStr,
            frequency,
            weekDays: resolvedWeekDays,
            biweeklyWeeks: biweeklyWeeks || null,
            durationMinutes,
            startTimeOffset,
            commitmentEndDate,
            status: 'confirmed',
            cancelToken: generateCancelToken(),
        },
        include: { slot: true },
    });

    await prisma.auditLog.create({
        data: {
            action: 'reservation.create',
            entity: 'reservation',
            entityId: reservation.id,
            reservationId: reservation.id,
            meta: JSON.stringify({ via: 'whatsapp', date: dateStr, frequency, durationMinutes, startTimeOffset }),
        },
    });

    return reservation;
}

module.exports = {
    DAY_LABELS,
    nextDateForWeekday,
    getAvailableWeekdays,
    buildWeekdayPrompt,
    buildTimePrompt,
    buildFrequencyPrompt,
    buildBiweeklyPrompt,
    buildDurationPrompt,
    createReservationFromWhatsApp,
};
