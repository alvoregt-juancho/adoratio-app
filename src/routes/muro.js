const express = require('express');
const prisma = require('../db');
const { normalizePhone, isValidPhone } = require('../utils/phone');

const router = express.Router();

function anonymizeName(fullName) {
    const parts = (fullName || '').trim().split(/\s+/).filter(Boolean);
    if (!parts.length) return 'Un hermano en la fe';
    if (parts.length === 1) {
        const n = parts[0];
        return n.length <= 2 ? 'Un hermano en la fe' : n.charAt(0).toUpperCase() + '.';
    }
    const initials = parts.map((p) => p.charAt(0).toUpperCase() + '.').join('');
    return initials.length <= 5 ? initials : 'Un hermano en la fe';
}

function formatIntentionDate(iso) {
    const d = new Date(iso);
    return d.toLocaleDateString('es-CR', { day: 'numeric', month: 'short', year: 'numeric' });
}

// GET /api/muro — peticiones activas visibles en el muro
router.get('/', async (req, res) => {
    try {
        const rows = await prisma.prayerIntention.findMany({
            where: { visibility: 'wall', status: 'active' },
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
                autor: r.displayName || 'Un hermano en la fe',
                fecha: formatIntentionDate(r.createdAt),
            }))
        );
    } catch (e) {
        console.error(e);
        res.status(500).json({ error: 'Error al cargar el muro de intenciones.' });
    }
});

// POST /api/muro — ofrecer intención (privada o en el muro)
router.post('/', async (req, res) => {
    try {
        const text = (req.body?.text || req.body?.intencion || '').trim();
        const visibility = req.body?.visibility === 'wall' ? 'wall' : 'private';
        const rawName = (req.body?.nombre || req.body?.displayName || '').trim();
        const userPhone = normalizePhone(req.body?.userPhone || req.body?.whatsapp);

        if (!text) {
            return res.status(400).json({ error: 'Escribe tu intención antes de ofrecerla.' });
        }
        if (text.length > 500) {
            return res.status(400).json({ error: 'La intención no puede superar 500 caracteres.' });
        }
        if (userPhone && !isValidPhone(userPhone)) {
            return res.status(400).json({ error: 'El celular debe tener exactamente 8 dígitos.' });
        }

        const displayName = visibility === 'wall' ? anonymizeName(rawName) : null;

        const intention = await prisma.prayerIntention.create({
            data: {
                text,
                displayName,
                userPhone: userPhone || null,
                visibility,
                status: 'active',
            },
        });

        await prisma.auditLog.create({
            data: {
                action: 'intention.create',
                entity: 'prayer_intention',
                entityId: intention.id,
                meta: JSON.stringify({ visibility }),
            },
        });

        res.status(201).json({
            message: visibility === 'wall'
                ? 'Intención colocada en el muro de oración.'
                : 'Intención colocada en el altar del Santísimo.',
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
