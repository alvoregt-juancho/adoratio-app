#!/usr/bin/env node
/**
 * Verify Cristiano — fases 0–5 WhatsApp/IA
 * Ejecutar: node scripts/verify-whatsapp-phases.js
 */
const fs = require('fs');
const path = require('path');

const root = path.join(__dirname, '..');
let failed = 0;

function ok(label) {
    console.log(`  ✓ ${label}`);
}

function fail(label, detail) {
    failed += 1;
    console.log(`  ✗ ${label}${detail ? ` — ${detail}` : ''}`);
}

function fileExists(rel) {
    return fs.existsSync(path.join(root, rel));
}

function read(rel) {
    return fs.readFileSync(path.join(root, rel), 'utf8');
}

console.log('\n=== Verify Cristiano — Fases WhatsApp/IA ===\n');

// Fase 0
console.log('Fase 0 — Modelos y config IA');
const schema = read('prisma/schema.prisma');
if (schema.includes('model ChatMessage') && schema.includes('handoffActive') && schema.includes('deepseekApiKey')) {
    ok('Schema: ChatMessage, handoff, deepseekApiKey');
} else fail('Schema incompleto');
if (fileExists('src/utils/whatsappBotConfig.js') && read('src/utils/whatsappBotConfig.js').includes('aiEnabled')) {
    ok('Bot config con campos IA');
} else fail('Bot config IA');
if (read('src/constants/permissions.js').includes('WHATSAPP_OPERATE')) {
    ok('Permiso WHATSAPP_OPERATE');
} else fail('Permiso WHATSAPP_OPERATE');

// Fase 1
console.log('\nFase 1 — Webhook async + historial');
if (fileExists('src/jobs/whatsappInboundQueue.js') && fileExists('src/utils/whatsappInboundProcessor.js')) {
    ok('Cola async inbound');
} else fail('Cola async');
if (fileExists('src/utils/chatMessages.js') && fileExists('src/utils/chatSession.js')) {
    ok('chatMessages + chatSession');
} else fail('Módulos de chat');
if (read('src/routes/whatsapp.js').includes('enqueueInbound')) {
    ok('Webhook responde 200 y encola');
} else fail('Webhook async');

// Fase 2
console.log('\nFase 2 — Orquestador + tools (sin DeepSeek obligatorio)');
if (fileExists('src/utils/whatsappOrchestrator.js') && fileExists('src/utils/whatsappTools.js')) {
    ok('Orquestador y tools');
} else fail('Orquestador/tools');

// Fase 3
console.log('\nFase 3 — Perfil e inscripción web');
const tools = read('src/utils/whatsappTools.js');
if (tools.includes('get_profile') && tools.includes('invite_web_registration')) {
    ok('Tools perfil + web');
} else fail('Tools fase 3');

// Fase 4
console.log('\nFase 4 — Handoff operador');
const adminRoutes = read('src/routes/whatsappAdmin.js');
if (adminRoutes.includes('/sessions') && adminRoutes.includes('/reply') && adminRoutes.includes('/handoff')) {
    ok('API handoff operador');
} else fail('API handoff');
if (read('public/admin.html').includes('waHandoffCard')) {
    ok('UI panel handoff');
} else fail('UI handoff');

// Fase 5
console.log('\nFase 5 — Tiempo real + métricas');
if (fileExists('src/ws/adminWhatsAppHub.js') && adminRoutes.includes('/events')) {
    ok('SSE hub + endpoint events');
} else fail('SSE/métricas');
if (adminRoutes.includes('handoffActive') && adminRoutes.includes('chatMessagesToday')) {
    ok('Métricas extendidas en /stats');
} else fail('Métricas');

// DeepSeek preparado (fase final)
console.log('\nDeepSeek — listo para conectar');
if (fileExists('src/utils/ai/deepseekClient.js') && read('public/admin.html').includes('waDeepseekKey')) {
    ok('Cliente DeepSeek + campo secreto en admin');
} else fail('DeepSeek wiring');

console.log('\n' + (failed ? `RESULTADO: ${failed} fallo(s)` : 'RESULTADO: Todas las fases verificadas OK') + '\n');
process.exit(failed ? 1 : 0);
