const { parseWaPhone } = require('./phone');
const { logInboundMessage } = require('./whatsappLog');
const { appendChatMessage } = require('./chatMessages');
const { getOrCreateSession } = require('./chatSession');
const { runOrchestrator } = require('./whatsappOrchestrator');
const { handleIncomingMessage: handleRulesBot } = require('./whatsappBot');
const { broadcastWhatsAppEvent } = require('../ws/adminWhatsAppHub');

function parseInboundMessage(message) {
    let text = '';
    let buttonId = null;
    let messageType = message.type || 'text';

    if (message.type === 'text') {
        text = message.text?.body || '';
    } else if (message.type === 'interactive') {
        messageType = 'interactive';
        const interactive = message.interactive;
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

    return { text, buttonId, messageType };
}

async function processInboundWhatsApp({ value, messages }) {
    const contactName =
        value.contacts?.find((c) => c.wa_id === messages[0]?.from)?.profile?.name || null;

    for (const message of messages) {
        const waId = message.from;
        const { text, buttonId, messageType } = parseInboundMessage(message);

        await logInboundMessage({
            waId,
            text,
            messageType,
            waMessageId: message.id,
            buttonId,
            contactName,
        });

        const phone = parseWaPhone(waId);
        const session = await getOrCreateSession(phone, { contactName });

        await appendChatMessage({
            phone: session.phone,
            role: 'user',
            direction: 'inbound',
            body: text || `[${messageType}]`,
            messageType,
            waMessageId: message.id,
            contactName,
            meta: buttonId ? { buttonId } : null,
        });

        broadcastWhatsAppEvent('message:inbound', {
            phone: session.phone,
            body: text,
            handoffActive: session.handoffActive,
        });

        if (session.handoffActive) {
            broadcastWhatsAppEvent('handoff:message', { phone: session.phone, body: text });
            continue;
        }

        const usedAi = await runOrchestrator(session.phone, text, buttonId);
        if (!usedAi) {
            await handleRulesBot(waId, text, buttonId);
        }
    }
}

module.exports = { processInboundWhatsApp };
