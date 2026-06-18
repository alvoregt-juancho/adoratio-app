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

function formatIntentionPayload(intention) {
    if (!intention) return null;
    return {
        id: intention.id,
        text: intention.text,
        displayName: intention.displayName || 'Un hermano en la fe',
        createdAt: intention.createdAt,
    };
}

async function assignWallIntentionToReservation(reservationId) {
    return prisma.$transaction(async (tx) => {
        const available = await tx.prayerIntention.findFirst({
            where: {
                visibility: 'wall',
                status: 'active',
                assignedToReservationId: null,
            },
            orderBy: { createdAt: 'asc' },
        });
        if (!available) return null;

        return tx.prayerIntention.update({
            where: { id: available.id },
            data: { assignedToReservationId: reservationId },
        });
    });
}

async function releaseWallIntentionAssignment(reservationId) {
    await prisma.prayerIntention.updateMany({
        where: { assignedToReservationId: reservationId },
        data: { assignedToReservationId: null },
    });
}

module.exports = {
    anonymizeName,
    formatIntentionPayload,
    assignWallIntentionToReservation,
    releaseWallIntentionAssignment,
};
