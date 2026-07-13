#!/usr/bin/env node
/** Limpia API key inválida y sesiones atascadas en producción. */
const prisma = require('../src/db');
const { validateDeepSeekApiKey } = require('../src/utils/ai/deepseekClient');
const { invalidateWhatsAppBotConfigCache } = require('../src/utils/whatsappBotConfig');

async function main() {
    const cfg = await prisma.whatsAppBotConfig.findUnique({ where: { id: 1 } });
    if (!cfg) {
        console.log('No bot config');
        return;
    }

    const key = cfg.deepseekApiKey || '';
    const valid = validateDeepSeekApiKey(key);
    if (!valid.ok) {
        await prisma.whatsAppBotConfig.update({
            where: { id: 1 },
            data: { deepseekApiKey: null },
        });
        invalidateWhatsAppBotConfigCache();
        console.log('Cleared invalid deepseek_api_key:', valid.error);
    } else {
        console.log('API key format OK');
    }

    const stuck = await prisma.whatsAppSession.findMany({
        where: { step: { in: ['book_name', 'book_slot', 'book_confirm'] } },
    });
    for (const s of stuck) {
        await prisma.whatsAppSession.update({
            where: { id: s.id },
            data: { step: 'menu', mode: 'rules', data: '{}' },
        });
        console.log('Reset session', s.phone, 'from', s.step, 'to menu');
    }
}

main()
    .catch((e) => {
        console.error(e);
        process.exit(1);
    })
    .finally(() => prisma.$disconnect());
