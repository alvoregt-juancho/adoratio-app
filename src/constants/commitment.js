/**
 * Frecuencias de compromiso de guardia.
 * SQLite no soporta enums en Prisma; valores documentados aquí.
 */
const COMMITMENT_FREQUENCY = {
    ONCE: 'ONCE',
    DAILY: 'DAILY',
    WEEKLY: 'WEEKLY',
    BIWEEKLY: 'BIWEEKLY',
    MONTHLY: 'MONTHLY',
};

const FREQUENCY_VALUES = Object.values(COMMITMENT_FREQUENCY);

const FREQUENCY_LABELS = {
    ONCE: 'Una sola vez',
    DAILY: 'Diario',
    WEEKLY: 'Semanal',
    BIWEEKLY: 'Quincenal',
    MONTHLY: 'Mensual',
};

/** Mapa de campo Settings → frecuencia habilitada */
const FREQUENCY_SETTING_KEYS = {
    ONCE: 'freqOnceEnabled',
    DAILY: 'freqDailyEnabled',
    WEEKLY: 'freqWeeklyEnabled',
    BIWEEKLY: 'freqBiweeklyEnabled',
    MONTHLY: 'freqMonthlyEnabled',
};

function isValidFrequency(value) {
    return FREQUENCY_VALUES.includes(value);
}

function getEnabledFrequencies(settings) {
    if (!settings) return ['WEEKLY', 'BIWEEKLY', 'DAILY'];
    return FREQUENCY_VALUES.filter((f) => settings[FREQUENCY_SETTING_KEYS[f]]);
}

module.exports = {
    COMMITMENT_FREQUENCY,
    FREQUENCY_VALUES,
    FREQUENCY_LABELS,
    FREQUENCY_SETTING_KEYS,
    isValidFrequency,
    getEnabledFrequencies,
};
