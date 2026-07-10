const express = require('express');
const config = require('../config');
const { handleIncomingMessage } = require('../utils/whatsappBot');
const { logInboundMessage, updateWhatsAppMessageStatus } = require('../utils/whatsappLog');

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

        const contactName =
            value.contacts?.find((c) => c.wa_id === value.messages[0]?.from)?.profile?.name || null;

        for (const message of value.messages) {
            const waId = message.from;
            let text = '';
            let buttonId = null;
            let messageType = message.type || 'text';

            if (message.type === 'text') {
                text = message.text?.body || '';
            } else if (message.type === 'interactive') {
                const interactive = message.interactive;
                messageType = 'interactive';
                if (interactive?.type === 'button_reply') {
                    buttonId = interactive.button_reply?.id;
                    text = interactive.button_reply?.title || '';
                } else if (interactive?.type === 'list_reply') {
                    buttonId = interactive.list_reply?.id;
                    text = interactive.list_reply?.title || '';
                }
            } else if (message.type === 'button') {
                messageType = 'button';
                text = message.button?.text || message.button?.payload || '';
            } else {
                text = `[${message.type}]`;
            }

            await logInboundMessage({
                waId,
                text,
                messageType,
                waMessageId: message.id,
                buttonId,
                contactName,
            });

            await handleIncomingMessage(waId, text, buttonId);
        }
    } catch (e) {
        console.error('[WhatsApp webhook]', e);
    }
});

module.exports = router;
