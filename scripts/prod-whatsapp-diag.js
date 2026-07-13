#!/usr/bin/env node
const prisma = require('../src/db');

async function main() {
    const c = await prisma.whatsAppBotConfig.findUnique({ where: { id: 1 } });
    const k = c?.deepseekApiKey || '';
    console.log('config', {
        aiEnabled: c?.aiEnabled,
        botEnabled: c?.enabled,
        keyLen: k.length,
        keyPrefix: k.slice(0, 7),
        keySuffix: k.slice(-8),
        looksLikeSk: k.startsWith('sk-'),
        hasZip: /\.zip$/i.test(k) || k.includes('.zip'),
    });

    const msgs = await prisma.whatsAppMessageLog.findMany({
        orderBy: { createdAt: 'desc' },
        take: 12,
        select: { direction: true, phone: true, body: true, createdAt: true, status: true },
    });
    console.log('recent_msgs', msgs);

    const chat = await prisma.chatMessage.findMany({
        orderBy: { createdAt: 'desc' },
        take: 8,
        select: { role: true, direction: true, body: true, createdAt: true },
    });
    console.log('recent_chat', chat);

    const sessions = await prisma.whatsAppSession.findMany({
        orderBy: { lastMessageAt: 'desc' },
        take: 5,
    });
    console.log(
        'sessions',
        sessions.map((s) => ({
            phone: s.phone,
            mode: s.mode,
            handoff: s.handoffActive,
            step: s.step,
            lastMessageAt: s.lastMessageAt,
        }))
    );
}

main()
    .catch((e) => {
        console.error(e);
        process.exit(1);
    })
    .finally(() => prisma.$disconnect());
