const express = require('express');
const config = require('../config');
const { updateWhatsAppMessageStatus } = require('../utils/whatsappLog');
const { verifyWhatsAppWebhookSignature } = require('../utils/webhookSignature');
const { enqueueInbound } = require('../jobs/whatsappInboundQueue');

const router = express.Router();

// GET — verificación del webhook (Meta Cloud API)
router.get('/webhook', (req, res) => {
    const mode = req.query['hub.mode'];
    const token = req.query['hub.verify_token'];
    const challenge = req.query['hub.challenge'];

    if (mode === 'subscribe' && token === config.whatsapp.verifyToken) {
        return res.status(200).send(challenge);
    }
    return res.sendStatus(403);
});

// POST — mensajes entrantes y actualizaciones de estado
router.post('/webhook', async (req, res) => {
    const signature = req.get('X-Hub-Signature-256');
    if (!verifyWhatsAppWebhookSignature(req.rawBody, signature)) {
        return res.sendStatus(403);
    }

    res.sendStatus(200);

    try {
        const body = req.body;
        const entry = body?.entry?.[0];
        const changes = entry?.changes?.[0];
        const value = changes?.value;

        if (value?.statuses?.length) {
            for (const st of value.statuses) {
                await updateWhatsAppMessageStatus(st.id, st.status, st);
            }
        }

        if (!value?.messages?.length) return;

        enqueueInbound({ value, messages: value.messages });
    } catch (e) {
        console.error('[WhatsApp webhook]', e);
    }
});

module.exports = router;
