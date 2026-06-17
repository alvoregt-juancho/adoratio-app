const express = require('express');
const { getSettings } = require('../utils/settings');
const { getEnabledFrequencies } = require('../constants/commitment');

const router = express.Router();

// GET /api/settings — opciones públicas para el front-end de reservas
router.get('/', async (req, res) => {
    try {
        const settings = await getSettings();
        res.json({
            frequencies: getEnabledFrequencies(settings),
            allowOffsetStartTimes: settings.allowOffsetStartTimes,
            allowThirtyMinuteDurations: settings.allowThirtyMinuteDurations,
        });
    } catch (e) {
        console.error(e);
        res.status(500).json({ error: 'Error al obtener configuración.' });
    }
});

module.exports = router;
