const prisma = require('../db');

const DEFAULT_SETTINGS = {
    id: 1,
    freqOnceEnabled: true,
    freqDailyEnabled: true,
    freqWeeklyEnabled: true,
    freqBiweeklyEnabled: true,
    freqMonthlyEnabled: true,
    allowOffsetStartTimes: false,
    allowThirtyMinuteDurations: false,
};

async function getSettings() {
    let settings = await prisma.settings.findUnique({ where: { id: 1 } });
    if (!settings) {
        settings = await prisma.settings.create({ data: DEFAULT_SETTINGS });
    }
    return settings;
}

module.exports = { getSettings, DEFAULT_SETTINGS };
