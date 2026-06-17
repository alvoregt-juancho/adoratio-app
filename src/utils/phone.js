const PHONE_DIGITS = 8;

function normalizePhone(raw) {
    return (raw || '').replace(/\D/g, '');
}

function isValidPhone(phone) {
    return new RegExp(`^\\d{${PHONE_DIGITS}}$`).test(phone);
}

module.exports = { PHONE_DIGITS, normalizePhone, isValidPhone };
