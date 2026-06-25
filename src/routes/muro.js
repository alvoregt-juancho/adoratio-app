const express = require('express');
const prisma = require('../db');
const { normalizePhone, isValidPhone } = require('../utils/phone');

const router = express.Router();

function formatIntentionDate(iso) {
    const d = new Date(iso);
    return d.toLocaleDateString('es-CR', { day: 'numeric', month: 'short', year: 'numeric' });
}

/** personal = nombre visible en el muro; anonymous = sin nombre público */
function parsePrivacyMode(body) {
    const mode = body?.privacy ?? body?.visibility;
    if (mode === 'personal' || mode === 'private') return 'personal';
    return 'anonymous';
}

function muroAuthorLabel(displayName) {
    return displayName || 'Un hermano en la fe';
}

// GET /api/muro — peticiones activas en el muro
router.get('/', async (req, res) => {
    try {
        const rows = await prisma.prayerIntention.findMany({
            where: {
                status: 'active',
                assignedToReservationId: null,
            },
            orderBy: { createdAt: 'desc' },
            take: 100,
            select: {
                id: true,
                text: true,
                displayName: true,
                createdAt: true,
            },
        });
        res.json(
            rows.map((r) => ({
                id: r.id,
                intencion: r.text,
                autor: muroAuthorLabel(r.displayName),
                fecha: formatIntentionDate(r.createdAt),
            }))
        );
    } catch (e) {
        console.error(e);
        res.status(500).json({ error: 'Error al cargar el muro de intenciones.' });
    }
});

// POST /api/muro — publicar intención (siempre en el muro)
router.post('/', async (req, res) => {
    try {
        const text = (req.body?.text || req.body?.intencion || '').trim();
        const privacy = parsePrivacyMode(req.body);
        const rawName = (req.body?.nombre || req.body?.displayName || '').trim();
        const userPhone = normalizePhone(req.body?.userPhone || req.body?.whatsapp);

        if (!text) {
            return res.status(400).json({ error: 'Escribe tu intención antes de publicarla.' });
        }
        if (text.length > 500) {
            return res.status(400).json({ error: 'La intención no puede superar 500 caracteres.' });
        }
        if (userPhone && !isValidPhone(userPhone)) {
            return res.status(400).json({ error: 'El celular debe tener exactamente 8 dígitos.' });
        }
        if (privacy === 'personal' && !rawName) {
            return res.status(400).json({ error: 'Escribe tu nombre para una intención personal.' });
        }

        const displayName = privacy === 'personal' ? rawName : null;

        const intention = await prisma.prayerIntention.create({
            data: {
                text,
                displayName,
                userPhone: userPhone || null,
                visibility: 'wall',
                status: 'active',
            },
        });

        await prisma.auditLog.create({
            data: {
                action: 'intention.create',
                entity: 'prayer_intention',
                entityId: intention.id,
                meta: JSON.stringify({ privacy }),
            },
        });

        res.status(201).json({
            message: privacy === 'personal'
                ? 'Intención publicada en el muro con tu nombre.'
                : 'Intención publicada en el muro de forma anónima.',
            intention: {
                id: intention.id,
                displayName: intention.displayName,
            },
        });
    } catch (e) {
        console.error(e);
        res.status(500).json({ error: 'Error al guardar la intención.' });
    }
});

module.exports = router;
