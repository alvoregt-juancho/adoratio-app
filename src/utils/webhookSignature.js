const crypto = require('crypto');
const config = require('../config');

function verifyWhatsAppWebhookSignature(rawBody, signatureHeader) {
    const secret = config.whatsapp.appSecret;
    if (!secret) return true;
    if (!signatureHeader || !rawBody) return false;
    const expected =
        'sha256=' + crypto.createHmac('sha256', secret).update(rawBody).digest('hex');
    try {
        const a = Buffer.from(signatureHeader);
        const b = Buffer.from(expected);
        if (a.length !== b.length) return false;
        return crypto.timingSafeEqual(a, b);
    } catch {
        return false;
    }
}

module.exports = { verifyWhatsAppWebhookSignature };
