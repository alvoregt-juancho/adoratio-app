const config = require('../config');
const { normalizePhone } = require('./phone');
const { logOutboundFromApiResponse } = require('./whatsappLog');
const { parseWaPhone } = require('./phone');

function formatPhoneForWa(phone8) {
    const p = normalizePhone(phone8);
    return `${config.whatsapp.countryCode}${p}`;
}

async function callWhatsAppApi(payload) {
    const { phoneNumberId, accessToken, apiVersion } = config.whatsapp;
    const url = `https://graph.facebook.com/${apiVersion}/${phoneNumberId}/messages`;

    if (!config.whatsappEnabled) {
        console.log('[WhatsApp simulado]', JSON.stringify(payload, null, 2));
        const simulated = { simulated: true, messages: [{ message_status: 'simulated' }] };
        const toPhone = payload.to?.replace(/\D/g, '').slice(-8);
        if (toPhone) {
            await logOutboundFromApiResponse(toPhone, payload, simulated, true).catch(() => {});
        }
        return simulated;
    }

    const res = await fetch(url, {
        method: 'POST',
        headers: {
            Authorization: `Bearer ${accessToken}`,
            'Content-Type': 'application/json',
        },
        body: JSON.stringify({ messaging_product: 'whatsapp', ...payload }),
    });

    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
        console.error('[WhatsApp API error]', res.status, data);
        throw new Error(data?.error?.message || `WhatsApp API ${res.status}`);
    }

    const toPhone = payload.to?.replace(/\D/g, '').slice(-8);
    if (toPhone) {
        await logOutboundFromApiResponse(toPhone, payload, data, false).catch(() => {});
    }
    return data;
}

async function sendText(toPhone8, text) {
    return callWhatsAppApi({
        to: formatPhoneForWa(toPhone8),
        type: 'text',
        text: { body: text },
    });
}

async function sendButtons(toPhone8, bodyText, buttons) {
    return callWhatsAppApi({
        to: formatPhoneForWa(toPhone8),
        type: 'interactive',
        interactive: {
            type: 'button',
            body: { text: bodyText },
            action: {
                buttons: buttons.slice(0, 3).map((b) => ({
                    type: 'reply',
                    reply: { id: b.id, title: b.title.slice(0, 20) },
                })),
            },
        },
    });
}

async function sendList(toPhone8, bodyText, buttonLabel, sections) {
    return callWhatsAppApi({
        to: formatPhoneForWa(toPhone8),
        type: 'interactive',
        interactive: {
            type: 'list',
            body: { text: bodyText },
            action: { button: buttonLabel.slice(0, 20), sections },
        },
    });
}

module.exports = {
    formatPhoneForWa,
    parseWaPhone,
    callWhatsAppApi,
    sendText,
    sendButtons,
    sendList,
};
