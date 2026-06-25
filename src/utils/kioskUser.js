const prisma = require('../db');
const { splitFullName } = require('./name');

function kioskEmailForPhone(phone) {
    return `adorador+${phone}@adorahora.local`;
}

/** Resuelve o crea un usuario feligrés por número de celular (8 dígitos). */
async function resolveKioskUserByPhone(phone) {
    let user = await prisma.user.findUnique({ where: { phoneNumber: phone } });
    if (user) return user;

    const reservation = await prisma.reservation.findFirst({
        where: {
            userPhone: phone,
            status: { in: ['confirmed', 'completed'] },
        },
        orderBy: { createdAt: 'desc' },
    });
    if (!reservation) return null;

    const first = reservation.userFirstName || splitFullName(reservation.userName).first;
    const last = reservation.userLastName || splitFullName(reservation.userName).last;
    const name = [first, last].filter(Boolean).join(' ') || reservation.userName || 'Adorador';

    user = await prisma.user.upsert({
        where: { phoneNumber: phone },
        update: { name },
        create: {
            name,
            email: kioskEmailForPhone(phone),
            role: 'feligres',
            phoneNumber: phone,
            emailVerified: true,
        },
    });

    return user;
}

function firstNameFromUser(user) {
    const { first } = splitFullName(user.name);
    return first || user.name || 'Hermano';
}

function startOfToday() {
    const d = new Date();
    d.setHours(0, 0, 0, 0);
    return d;
}

function endOfToday() {
    const d = new Date();
    d.setHours(23, 59, 59, 999);
    return d;
}

module.exports = {
    resolveKioskUserByPhone,
    firstNameFromUser,
    startOfToday,
    endOfToday,
    kioskEmailForPhone,
};
