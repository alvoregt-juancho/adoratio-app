/**
 * Semanas del mes para guardia quincenal.
 * "1,3" = semanas 1 y 3 · "2,4" = semanas 2 y 4
 */

const BIWEEKLY_WEEK_OPTIONS = {
    '1,3': { label: 'Semana 1 y 3', weeks: [1, 3] },
    '2,4': { label: 'Semana 2 y 4', weeks: [2, 4] },
};

const VALID_BIWEEKLY_VALUES = Object.keys(BIWEEKLY_WEEK_OPTIONS);

function isValidBiweeklyWeeks(raw) {
    if (raw == null || raw === '') return false;
    return VALID_BIWEEKLY_VALUES.includes(String(raw).trim());
}

function formatBiweeklyWeeks(raw) {
    const key = String(raw || '').trim();
    return BIWEEKLY_WEEK_OPTIONS[key]?.label || key;
}

module.exports = {
    BIWEEKLY_WEEK_OPTIONS,
    VALID_BIWEEKLY_VALUES,
    isValidBiweeklyWeeks,
    formatBiweeklyWeeks,
};
