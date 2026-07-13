const prisma = require('../db');
const { normalizePhone, parseWaPhone } = require('./phone');

function normalizeLogPhone(raw) {
    const fromWa = parseWaPhone(raw);
    const local = normalizePhone(fromWa || raw);
    return local || fromWa || String(raw || '').replace(/\D/g, '').slice(-8);
}

async function logWhatsAppMessage({
    direction,
    phone,
    body,
    messageType = 'text',
    waMessageId = null,
    meta = null,
    status = null,
    contactName = null,
}) {
    const normalizedPhone = normalizeLogPhone(phone);
    if (!normalizedPhone || !body) return null;

    const data = {
        direction,
        phone: normalizedPhone,
        messageType,
        body: String(body).slice(0, 4000),
        waMessageId: waMessageId || null,
        status: status || null,
        contactName: contactName || null,
        meta: meta != null ? (typeof meta === 'string' ? meta : JSON.stringify(meta)) : null,
    };

    try {
        if (waMessageId) {
            const existing = await prisma.whatsAppMessageLog.findUnique({
                where: { waMessageId },
            });
            if (existing) {
                return prisma.whatsAppMessageLog.update({
                    where: { id: existing.id },
                    data: {
                        status: status || existing.status,
                        meta: data.meta || existing.meta,
                    },
                });
            }
        }
        return await prisma.whatsAppMessageLog.create({ data });
    } catch (e) {
        console.error('[WhatsApp log]', e.message);
        return null;
    }
}

async function logInboundMessage({ waId, text, messageType, waMessageId, buttonId, contactName }) {
    return logWhatsAppMessage({
        direction: 'inbound',
        phone: waId,
        body: text || `[${messageType || 'mensaje'}]`,
        messageType: messageType || 'text',
        waMessageId,
        status: 'received',
        contactName,
        meta: buttonId ? { buttonId } : null,
    });
}

async function logOutboundFromApiResponse(toPhone8, payload, apiResult, simulated = false) {
    let body = '';
    let messageType = payload.type || 'text';
    let meta = null;

    if (payload.type === 'text') {
        body = payload.text?.body || '';
    } else if (payload.type === 'template') {
        body = `[Plantilla: ${payload.template?.name || 'template'}]`;
        messageType = 'template';
        meta = { template: payload.template?.name, language: payload.template?.language?.code };
    } else if (payload.type === 'interactive') {
        body = payload.interactive?.body?.text || '[Mensaje interactivo]';
        messageType = 'interactive';
        meta = { interactiveType: payload.interactive?.type };
    } else {
        body = `[${messageType}]`;
    }

    const waMessageId = apiResult?.messages?.[0]?.id || null;
    const status = simulated ? 'simulated' : apiResult?.messages?.[0]?.message_status || 'sent';

    return logWhatsAppMessage({
        direction: 'outbound',
        phone: toPhone8,
        body,
        messageType,
        waMessageId,
        status,
        meta,
    });
}

async function updateWhatsAppMessageStatus(waMessageId, status, raw = null) {
    if (!waMessageId) return null;
    try {
        const existing = await prisma.whatsAppMessageLog.findUnique({ where: { waMessageId } });
        if (existing) {
            return prisma.whatsAppMessageLog.update({
                where: { id: existing.id },
                data: {
                    status,
                    meta: raw
                        ? JSON.stringify({
                              ...(existing.meta ? JSON.parse(existing.meta) : {}),
                              delivery: raw,
                          })
                        : existing.meta,
                },
            });
        }
        return logWhatsAppMessage({
            direction: 'outbound',
            phone: raw?.recipient_id || '',
            body: `[Estado: ${status}]`,
            messageType: 'status',
            waMessageId,
            status,
            meta: raw,
        });
    } catch (e) {
        console.error('[WhatsApp status]', e.message);
        return null;
    }
}

module.exports = {
    logWhatsAppMessage,
    logInboundMessage,
    logOutboundFromApiResponse,
    updateWhatsAppMessageStatus,
    normalizeLogPhone,
};
