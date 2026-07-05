const express = require('express');
const prisma = require('../db');
const { formatRosterTime, ROSTER_WEEKDAY_ORDER, rosterMemberToRow } = require('../utils/roster');
const { validateRosterMemberPayload, createRosterMember } = require('../utils/rosterMemberCreate');

const router = express.Router();

const WEEKDAY_LABELS = {
    1: 'Lunes',
    2: 'Martes',
    3: 'Miércoles',
    4: 'Jueves',
    5: 'Viernes',
    6: 'Sábado',
    7: 'Domingo',
};

// GET /api/roster/signup-meta — horarios y días para el formulario público
router.get('/signup-meta', async (req, res) => {
    try {
        const slots = await prisma.slot.findMany({
            where: { isActive: true },
            select: { startTime: true },
            orderBy: { startTime: 'asc' },
        });
        const uniqueTimes = [...new Set(slots.map((s) => s.startTime))].sort();

        res.json({
            slotTimes: uniqueTimes.map((value) => ({
                value,
                label: formatRosterTime(value),
            })),
            weekdays: ROSTER_WEEKDAY_ORDER.map((value) => ({
                value,
                label: WEEKDAY_LABELS[value],
            })),
        });
    } catch (e) {
        console.error(e);
        res.status(500).json({ error: 'No se pudo cargar la información del formulario.' });
    }
});

// POST /api/roster/substitutes — registro público de voluntarios sustitutos
router.post('/substitutes', async (req, res) => {
    try {
        const body = req.body || {};
        const validated = validateRosterMemberPayload(body, { role: 'substitute', requireRole: false });
        if (validated.error) {
            return res.status(400).json({ error: validated.error });
        }

        const publicNote = body.notes ? String(body.notes).trim() : '';
        const internalNotes = publicNote
            ? `Registro público: ${publicNote}`
            : 'Registro público en adorahora.com';

        const member = await createRosterMember({
            ...validated.data,
            internalNotes,
        });

        res.status(201).json({
            message: `Gracias ${member.firstName}, quedaste registrado como sustituto.`,
            member: rosterMemberToRow(member),
        });
    } catch (e) {
        console.error(e);
        if (e.status === 409) {
            return res.status(409).json({ error: e.message });
        }
        res.status(500).json({ error: 'No se pudo completar el registro. Intenta de nuevo.' });
    }
});

module.exports = router;
