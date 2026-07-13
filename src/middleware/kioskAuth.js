const config = require('../config');

/** Si KIOSK_API_SECRET está definido, exige cabecera X-Kiosk-Secret en check-in de capilla. */
function requireKioskSecret(req, res, next) {
    const secret = config.kioskApiSecret;
    if (!secret) return next();
    const provided = req.get('X-Kiosk-Secret') || req.body?.kioskSecret;
    if (provided !== secret) {
        return res.status(403).json({ error: 'Acceso no autorizado al registro de capilla.' });
    }
    next();
}

module.exports = { requireKioskSecret };
