const prisma = require('../db');

function cutoffDate(days) {
    const ms = Math.max(1, Number(days || 30)) * 24 * 60 * 60 * 1000;
    return new Date(Date.now() - ms);
}

async function purgeOldIntentions({ days = 30 } = {}) {
    const cutoff = cutoffDate(days);
    return prisma.prayerIntention.deleteMany({
        where: {
            status: { in: ['prayed', 'deleted'] },
            statusUpdatedAt: { lt: cutoff },
        },
    });
}

module.exports = { purgeOldIntentions };

