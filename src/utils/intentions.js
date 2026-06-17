const prisma = require('../db');
const { normalizePhone, isValidPhone } = require('./phone');

function anonymizeName(fullName) {
    const parts = (fullName || '').trim().split(/\s+/).filter(Boolean);
    if (!parts.length) return 'Un hermano en la fe';
    if (parts.length === 1) {
        const n = parts[0];
        return n.length <= 2 ? 'Un hermano en la fe' : n.charAt(0).toUpperCase() + '.';
    }
    const initials = parts.map((p) => p.charAt(0).toUpperCase() + '.').join('');
    return initials.length <= 5 ? initials : 'Un hermano en la fe';
}

async function createWallIntention({ text, userPhone, userName, reservationId }) {
    const trimmed = (text || '').trim();
    if (!trimmed) return null;
    if (trimmed.length > 500) {
        throw new Error('INTENTION_TOO_LONG');
    }
    const phone = normalizePhone(userPhone);
    if (phone && !isValidPhone(phone)) {
        throw new Error('INVALID_PHONE');
    }

    return prisma.prayerIntention.create({
        data: {
            text: trimmed,
            displayName: anonymizeName(userName),
            userPhone: phone || null,
            visibility: 'wall',
            status: 'active',
            reservationId: reservationId || null,
        },
    });
}

module.exports = { anonymizeName, createWallIntention };
