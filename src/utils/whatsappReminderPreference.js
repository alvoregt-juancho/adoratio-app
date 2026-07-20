/** Preferencias de recordatorio WhatsApp por reserva. */

const REMINDER_PREFS = {
    both: { key: 'both', label: 'ambos (24 h y 3 h)', types: ['24h', '3h'] },
    '24h': { key: '24h', label: 'solo 24 horas antes', types: ['24h'] },
    '3h': { key: '3h', label: 'solo 3 horas antes', types: ['3h'] },
    none: { key: 'none', label: 'sin recordatorios', types: [] },
};

function normalizeReminderPreference(value) {
    const key = String(value || 'both').toLowerCase().trim();
    if (REMINDER_PREFS[key]) return key;
    return 'both';
}

function reminderTypesAllowed(preference) {
    return REMINDER_PREFS[normalizeReminderPreference(preference)].types;
}

function shouldSendReminderType(preference, reminderType) {
    return reminderTypesAllowed(preference).includes(reminderType);
}

function preferenceLabel(preference) {
    return REMINDER_PREFS[normalizeReminderPreference(preference)].label;
}

/** Interpreta id de lista/botón o texto de quick-reply de plantilla Meta. */
function parseReminderPreferenceChoice(raw) {
    const s = String(raw || '').trim();
    if (!s) return null;

    const idMatch = s.match(/^remindpref_(?:(\d+)_)?(both|24h|3h|none)$/i);
    if (idMatch) {
        return {
            reservationId: idMatch[1] ? Number(idMatch[1]) : null,
            preference: idMatch[2].toLowerCase(),
        };
    }

    const lower = s.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '');
    if (/(^|\b)(ambos|ambas|si ambos|24 y 3|24h y 3h)/.test(lower) || lower.includes('ambos 24')) {
        return { reservationId: null, preference: 'both' };
    }
    if (/solo\s*3|solo 3 horas|unicamente 3|3 horas/.test(lower) && !/24/.test(lower)) {
        return { reservationId: null, preference: '3h' };
    }
    if (/solo\s*24|solo 24 horas|24 horas/.test(lower)) {
        return { reservationId: null, preference: '24h' };
    }
    if (/no recordar|no es necesario|sin recordatorio|ninguno|ninguna|no deseo|no quiero/.test(lower)) {
        return { reservationId: null, preference: 'none' };
    }
    return null;
}

module.exports = {
    REMINDER_PREFS,
    normalizeReminderPreference,
    reminderTypesAllowed,
    shouldSendReminderType,
    preferenceLabel,
    parseReminderPreferenceChoice,
};
