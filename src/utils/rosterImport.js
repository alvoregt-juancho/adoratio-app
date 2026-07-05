const prisma = require('../db');
const { findSlotForCommitment } = require('./adminReservation');

async function commitmentAlreadyExists(parsed) {
    const slot = await findSlotForCommitment({
        slotTime: parsed.slotTime,
        weekday: parsed.weekday,
        durationMinutes: parsed.durationMinutes,
        startTimeOffset: parsed.startTimeOffset || 0,
    });
    if (!slot) return false;

    const existing = await prisma.reservation.findFirst({
        where: {
            userPhone: parsed.phone,
            slotId: slot.id,
            frequency: parsed.frequency,
            weekDays: parsed.weekDays,
            status: { in: ['confirmed', 'completed'] },
        },
    });
    return Boolean(existing);
}

async function rosterMemberAlreadyExists({ phone, role }) {
    const existing = await prisma.rosterMember.findFirst({
        where: {
            phone,
            role,
            isActive: true,
        },
    });
    return Boolean(existing);
}

module.exports = {
    commitmentAlreadyExists,
    rosterMemberAlreadyExists,
};
