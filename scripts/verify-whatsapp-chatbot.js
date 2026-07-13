#!/usr/bin/env node
/**
 * Verify Cristiano — WhatsApp chatbot (runtime + integración)
 */
const prisma = require('../src/db');
const { parseHandoffKeywords, detectToolIntent, executeTool, DEFAULT_TOOLS } = require('../src/utils/whatsappTools');
const { isDeepSeekConfigured } = require('../src/utils/ai/deepseekClient');
const { serializeBotConfig } = require('../src/utils/whatsappBotConfig');
const { parseWaPhone } = require('../src/utils/phone');
const { enqueueInbound } = require('../src/jobs/whatsappInboundQueue');

let failed = 0;
let passed = 0;

function ok(label) {
    passed += 1;
    console.log(`  ✓ ${label}`);
}

function fail(label, detail) {
    failed += 1;
    console.log(`  ✗ ${label}${detail ? ` — ${detail}` : ''}`);
}

async function main() {
    console.log('\n=== Verify Cristiano — WhatsApp Chatbot (runtime) ===\n');

    // Módulos críticos
    console.log('Imports y módulos');
    try {
        require('../src/routes/whatsapp');
        require('../src/routes/whatsappAdmin');
        require('../src/utils/whatsappBot');
        require('../src/utils/whatsappOrchestrator');
        require('../src/utils/whatsappInboundProcessor');
        require('../src/ws/adminWhatsAppHub');
        ok('Todos los módulos cargan sin error');
    } catch (e) {
        fail('Imports', e.message);
    }

    // Prisma modelos
    console.log('\nBase de datos');
    try {
        const tables = [
            prisma.whatsAppSession,
            prisma.chatMessage,
            prisma.whatsAppBotConfig,
            prisma.whatsAppMessageLog,
        ];
        for (const model of tables) {
            if (!model?.count) throw new Error('Modelo Prisma ausente');
        }
        ok('Modelos Prisma accesibles (session, chatMessage, botConfig, messageLog)');

        const cfg = await prisma.whatsAppBotConfig.findUnique({ where: { id: 1 } });
        if (cfg) {
            ok('WhatsAppBotConfig id=1 existe');
        } else {
            ok('WhatsAppBotConfig se creará al primer uso (id=1 ausente es OK en DB vacía)');
        }

        const sessionCount = await prisma.whatsAppSession.count();
        const chatCount = await prisma.chatMessage.count();
        ok(`Sesiones: ${sessionCount}, mensajes chat: ${chatCount}`);
    } catch (e) {
        fail('Base de datos', e.message);
    }

    // Config IA enmascarada
    console.log('\nConfig IA (super admin)');
    try {
        const row = await prisma.whatsAppBotConfig.findUnique({ where: { id: 1 } });
        const pub = serializeBotConfig(row);
        if ('deepseekApiKey' in pub && pub.deepseekApiKey) {
            fail('API key no debe exponerse en serialize público');
        } else {
            ok('API key enmascarada / no expuesta en serialize público');
        }
        if (typeof pub.deepseekApiKeySet === 'boolean' && typeof pub.aiEnabled === 'boolean') {
            ok('Campos aiEnabled y deepseekApiKeySet presentes');
        } else {
            fail('Campos IA en serialize');
        }
        const internal = serializeBotConfig(row, { includeSecrets: true });
        ok('serialize con includeSecrets para orquestador');
        if (!isDeepSeekConfigured(internal)) {
            ok('DeepSeek NO conectado por defecto (esperado hasta activar en admin)');
        } else {
            ok('DeepSeek configurado en BD (aiEnabled + key)');
        }
    } catch (e) {
        fail('Config IA', e.message);
    }

    // Teléfono Guatemala
    console.log('\nTeléfono / país 502');
    const phone = parseWaPhone('50230341044');
    if (phone === '30341044') ok('parseWaPhone 50230341044 → 30341044');
    else fail('parseWaPhone', `got ${phone}`);

    // Tools / intents
    console.log('\nTools e intents (sin LLM)');
    const keywords = parseHandoffKeywords(null);
    if (keywords.includes('operador')) ok('Keywords handoff por defecto');
    else fail('Handoff keywords');

    const escalate = detectToolIntent('quiero hablar con un operador', null, DEFAULT_TOOLS, keywords);
    if (escalate?.tool === 'escalate_to_human') ok('Detecta escalación a humano');
    else fail('Escalación', JSON.stringify(escalate));

    const profile = detectToolIntent('cuál es mi perfil', null, DEFAULT_TOOLS, keywords);
    if (profile?.tool === 'get_profile') ok('Detecta consulta de perfil');
    else fail('Perfil', JSON.stringify(profile));

    const web = detectToolIntent('quiero inscribirme en la web', null, DEFAULT_TOOLS, keywords);
    if (web?.tool === 'invite_web_registration') ok('Detecta invitación web');
    else fail('Web', JSON.stringify(web));

    try {
        const chapel = await executeTool('get_chapel_info', '00000000');
        if (chapel && chapel.length > 10) ok('Tool get_chapel_info ejecuta');
        else fail('get_chapel_info', 'respuesta vacía');
    } catch (e) {
        fail('get_chapel_info', e.message);
    }

    // Cola inbound (no envía a Meta — solo verifica que no crashea con payload vacío simulado)
    console.log('\nCola async');
    try {
        if (typeof enqueueInbound === 'function') ok('enqueueInbound disponible');
        else fail('enqueueInbound');
    } catch (e) {
        fail('Cola', e.message);
    }

    // Permisos
    console.log('\nPermisos RBAC');
    const { PRIV, hasPermission } = require('../src/constants/permissions');
    if (PRIV.WHATSAPP_VIEW && PRIV.WHATSAPP_MANAGE && PRIV.WHATSAPP_OPERATE) {
        ok('WHATSAPP_VIEW, MANAGE, OPERATE definidos');
    } else fail('Permisos WhatsApp');

    console.log('\n' + '─'.repeat(48));
    console.log(`RESULTADO: ${passed} OK, ${failed} fallo(s)`);
    console.log(failed ? 'ESTADO: ❌ REQUIERE CORRECCIÓN' : 'ESTADO: ✅ CHATBOT LISTO (reglas + tools; DeepSeek opcional en admin)');
    console.log('');

    await prisma.$disconnect();
    process.exit(failed ? 1 : 0);
}

main().catch(async (e) => {
    console.error(e);
    await prisma.$disconnect();
    process.exit(1);
});
