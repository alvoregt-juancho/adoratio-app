const prisma = require('../db');
const { getOrCreateSession } = require('./chatSession');

async function appendChatMessage({
    phone,
    role,
    direction,
    body,
    messageType = 'text',
    waMessageId = null,
    toolName = null,
    meta = null,
    operatorId = null,
    contactName = null,
}) {
    const session = await getOrCreateSession(phone, { contactName });
    if (!body) return null;
    return prisma.chatMessage.create({
        data: {
            sessionId: session.id,
            role,
            direction,
            body: String(body).slice(0, 4000),
            messageType,
            waMessageId,
            toolName,
            meta: meta != null ? (typeof meta === 'string' ? meta : JSON.stringify(meta)) : null,
            operatorId,
        },
    });
}

async function getRecentChatHistory(phone, limit = 30) {
    const session = await prisma.whatsAppSession.findUnique({ where: { phone } });
    if (!session) return [];
    return prisma.chatMessage.findMany({
        where: { sessionId: session.id },
        orderBy: { createdAt: 'desc' },
        take: limit,
    });
}

module.exports = { appendChatMessage, getRecentChatHistory };
