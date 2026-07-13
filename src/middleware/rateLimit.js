const buckets = new Map();

function pruneBucket(bucket, windowMs, now) {
    while (bucket.length && now - bucket[0] > windowMs) {
        bucket.shift();
    }
}

/**
 * Rate limit en memoria (por clave derivada del request).
 * @param {{ windowMs: number, max: number, keyFn: (req) => string, message?: string }} opts
 */
function rateLimit({ windowMs, max, keyFn, message = 'Demasiadas solicitudes. Intenta de nuevo en unos minutos.' }) {
    return (req, res, next) => {
        const key = keyFn(req) || req.ip || 'unknown';
        const now = Date.now();
        let bucket = buckets.get(key);
        if (!bucket) {
            bucket = [];
            buckets.set(key, bucket);
        }
        pruneBucket(bucket, windowMs, now);
        if (bucket.length >= max) {
            return res.status(429).json({ error: message });
        }
        bucket.push(now);
        next();
    };
}

function clientIp(req) {
    return req.ip || req.socket?.remoteAddress || 'unknown';
}

const reservationLookupLimit = rateLimit({
    windowMs: 15 * 60 * 1000,
    max: 30,
    keyFn: (req) => `res-my:${clientIp(req)}:${req.query.phone || ''}`,
});

const reservationCancelLimit = rateLimit({
    windowMs: 15 * 60 * 1000,
    max: 15,
    keyFn: (req) => `res-del:${clientIp(req)}:${req.params.id}`,
});

const muroPostLimit = rateLimit({
    windowMs: 60 * 60 * 1000,
    max: 8,
    keyFn: (req) => `muro:${clientIp(req)}`,
    message: 'Has publicado varias intenciones. Espera un momento antes de publicar otra.',
});

module.exports = {
    rateLimit,
    reservationLookupLimit,
    reservationCancelLimit,
    muroPostLimit,
};
