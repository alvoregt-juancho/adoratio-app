const crypto = require('crypto');

function generateCancelToken() {
    return crypto.randomBytes(24).toString('hex');
}

function tokensMatch(stored, provided) {
    if (!stored || !provided) return false;
    try {
        const a = Buffer.from(String(stored));
        const b = Buffer.from(String(provided));
        if (a.length !== b.length) return false;
        return crypto.timingSafeEqual(a, b);
    } catch {
        return false;
    }
}

module.exports = { generateCancelToken, tokensMatch };
