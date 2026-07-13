const prisma = require('../db');

async function getOrCreateSession(phone, { contactName = null } = {}) {
    let session = await prisma.whatsAppSession.findUnique({ where: { phone } });
    if (!session) {
        session = await prisma.whatsAppSession.create({
            data: {
                phone,
                step: 'menu',
                mode: 'rules',
                data: '{}',
                contactName,
                lastMessageAt: new Date(),
            },
        });
        return session;
    }
    const updates = { lastMessageAt: new Date() };
    if (contactName && !session.contactName) updates.contactName = contactName;
    return prisma.whatsAppSession.update({ where: { id: session.id }, data: updates });
}

async function updateSessionState(phone, patch) {
    return prisma.whatsAppSession.update({
        where: { phone },
        data: { ...patch, lastMessageAt: new Date() },
    });
}

async function startHandoff(phone, { operatorId = null, reason = 'Solicitud de operador' } = {}) {
    return updateSessionState(phone, {
        handoffActive: true,
        mode: 'handoff',
        assignedOperatorId: operatorId,
        handoffReason: reason,
    });
}

async function endHandoff(phone, { mode = 'rules' } = {}) {
    return updateSessionState(phone, {
        handoffActive: false,
        mode,
        assignedOperatorId: null,
        handoffReason: null,
    });
}

module.exports = {
    getOrCreateSession,
    updateSessionState,
    startHandoff,
    endHandoff,
};
