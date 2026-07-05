const prisma = require('../db');
const { normalizePhone, isValidPhone } = require('./phone');
const { parseWeekDays } = require('./weekDays');
const { parseSlotTimes } = require('./roster');
const { rosterMemberAlreadyExists } = require('./rosterImport');

const ROSTER_ROLES = ['captain', 'substitute'];

function normalizeWeekDaysString(raw) {
    if (raw == null || raw === '') return null;
    const days = parseWeekDays(raw);
    return days.length ? days.join(',') : null;
}

function normalizeSlotTimesString(raw) {
    if (raw == null || raw === '') return null;
    const times = parseSlotTimes(raw);
    return times.length ? times.join(',') : null;
}

function validateRosterMemberPayload(body, { role = null, requireRole = true } = {}) {
    const resolvedRole = role || (body.role ? String(body.role).trim() : '');
    if (requireRole && !ROSTER_ROLES.includes(resolvedRole)) {
        return { error: 'Rol inválido (captain o substitute).' };
    }

    const firstName = String(body.firstName || '').trim();
    const lastName = String(body.lastName || '').trim() || null;
    const phone = normalizePhone(body.phone);
    const email = body.email ? String(body.email).trim() : null;
    const weekDays = normalizeWeekDaysString(body.weekDays);
    const slotTimes = normalizeSlotTimesString(body.slotTimes);
    const internalNotes = body.internalNotes ? String(body.internalNotes).trim() : null;

    if (!firstName) {
        return { error: 'Nombre y celular son requeridos.' };
    }
    if (!isValidPhone(phone)) {
        return { error: 'El celular debe tener exactamente 8 dígitos.' };
    }

    return {
        data: {
            role: resolvedRole,
            firstName,
            lastName,
            phone,
            email,
            weekDays,
            slotTimes,
            internalNotes,
        },
    };
}

async function createRosterMember(payload) {
    const exists = await rosterMemberAlreadyExists({ phone: payload.phone, role: payload.role });
    if (exists) {
        const err = new Error(
            payload.role === 'substitute'
                ? 'Este celular ya está registrado como sustituto.'
                : 'Este celular ya está registrado en este rol.'
        );
        err.status = 409;
        throw err;
    }

    return prisma.rosterMember.create({ data: payload });
}

module.exports = {
    ROSTER_ROLES,
    validateRosterMemberPayload,
    createRosterMember,
    normalizeWeekDaysString,
    normalizeSlotTimesString,
};
