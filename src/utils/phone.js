const config = require('../config');

const PHONE_DIGITS = 8;

function normalizePhone(raw) {
    return (raw || '').replace(/\D/g, '');
}

function isValidPhone(phone) {
    return new RegExp(`^\\d{${PHONE_DIGITS}}$`).test(phone);
}

/** Convierte wa_id de Meta (50212345678) a 8 dígitos locales. */
function parseWaPhone(waId) {
    const digits = String(waId || '').replace(/\D/g, '');
    const cc = config.whatsapp?.countryCode || config.countryCode || '502';
    if (digits.startsWith(cc) && digits.length === cc.length + 8) {
        return digits.slice(cc.length);
    }
    if (digits.length === 8) return digits;
    return digits.slice(-8);
}

module.exports = { PHONE_DIGITS, normalizePhone, isValidPhone, parseWaPhone };
