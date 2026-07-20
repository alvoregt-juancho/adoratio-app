#!/usr/bin/env node
/**
 * Verify Cristiano — Bandeja WhatsApp (UX + API + runtime)
 * Ejecutar: node scripts/verify-whatsapp-inbox.js
 */
const fs = require('fs');
const path = require('path');

const root = path.join(__dirname, '..');
let passed = 0;
let failed = 0;

function ok(label) {
    passed += 1;
    console.log(`  ✓ ${label}`);
}

function fail(label, detail) {
    failed += 1;
    console.log(`  ✗ ${label}${detail ? ` — ${detail}` : ''}`);
}

function read(rel) {
    return fs.readFileSync(path.join(root, rel), 'utf8');
}

function expect(cond, label, detail) {
    if (cond) ok(label);
    else fail(label, detail);
}

const TEST_PHONE = '99998877';

async function main() {
    console.log('\n=== Verify Cristiano — Bandeja WhatsApp UX ===\n');

    // ─── 1. Archivos y helpers ───────────────────────────────────────────
    console.log('1. Módulos y helpers');
    expect(fs.existsSync(path.join(root, 'src/utils/whatsappInboxMeta.js')), 'whatsappInboxMeta.js existe');

    let meta;
    try {
        meta = require('../src/utils/whatsappInboxMeta');
        ok('whatsappInboxMeta carga');
    } catch (e) {
        fail('whatsappInboxMeta carga', e.message);
        meta = null;
    }

    if (meta) {
        expect(meta.funnelFromSession({ step: 'menu' }).key === 'menu', 'Funnel menú');
        expect(meta.funnelFromSession({ step: 'book_confirm' }).key === 'confirm', 'Funnel confirmando');
        expect(meta.funnelFromSession({ step: 'book_weekday' }).key === 'booking', 'Funnel reservando');
        expect(meta.funnelFromSession({ handoffActive: true }).key === 'handoff', 'Funnel handoff');
        expect(meta.channelFromSession({ mode: 'ai' }).key === 'ai', 'Canal IA');
        expect(meta.channelFromSession({ mode: 'rules' }).key === 'rules', 'Canal Bot');
        expect(meta.channelFromSession({ handoffActive: true }).key === 'human', 'Canal Humano');
        expect(meta.initialsFromSession({ contactName: 'Juan Pérez' }) === 'JP', 'Iniciales nombre completo');
        expect(meta.initialsFromSession({ contactName: 'María' }) === 'MA', 'Iniciales un nombre');
        expect(meta.initialsFromSession({ phone: '50241035415' }) === '15', 'Iniciales desde teléfono');
        const prev = meta.truncatePreview('a'.repeat(80), 60);
        expect(prev.length === 60 && prev.endsWith('…'), 'Preview truncado a 60');
        expect(
            !JSON.stringify(meta.FUNNEL_BY_STEP).includes('Pedido') &&
                !JSON.stringify(meta.FUNNEL_BY_STEP).includes('Carrito'),
            'Embudo de adoración (no e-commerce)'
        );
    }

    // ─── 2. API admin ────────────────────────────────────────────────────
    console.log('\n2. API WhatsApp admin');
    const api = read('src/routes/whatsappAdmin.js');
    [
        ['require whatsappInboxMeta', "require('../utils/whatsappInboxMeta')"],
        ['enrichSessionRow', 'enrichSessionRow'],
        ['serializeSession con funnel/channel', 'funnelLabel'],
        ['GET /sessions con mode+q+offset', 'req.query.mode'],
        ['paginación limit/offset', 'req.query.offset'],
        ['preview último mensaje', 'lastMessagePreview'],
        ['unreadCount', 'unreadCount'],
        ['GET messages enriquecido', "/sessions/:phone/messages"],
        ['GET client panel', "/sessions/:phone/client"],
        ['métricas avgResponseSeconds', 'avgResponseSeconds'],
        ['conversion label', 'conversionLabel'],
        ['historial assignments', 'assignments'],
        ['POST clear', "/sessions/:phone/clear"],
        ['POST handoff', "/sessions/:phone/handoff"],
        ['POST release', "/sessions/:phone/release"],
        ['POST reply (solo handoff)', 'no está en handoff'],
        ['SSE events', "router.get('/events'"],
    ].forEach(([label, needle]) => {
        expect(api.includes(needle), label);
    });

    // ─── 3. HTML layout ──────────────────────────────────────────────────
    console.log('\n3. HTML bandeja');
    const html = read('public/admin.html');
    [
        ['waInboxCard', 'waInboxCard'],
        ['toolbar búsqueda', 'waInboxSearch'],
        ['filtro Todas/IA/Bot/Humano', 'waInboxModeFilter'],
        ['lista sesiones', 'waInboxList'],
        ['paginación Anterior/Siguiente', 'waInboxPrev'],
        ['empty state', 'Selecciona una conversación'],
        ['header chat avatar', 'waInboxHeaderAvatar'],
        ['badge canal', 'waInboxHeaderChannel'],
        ['Tomar', 'waInboxTakeBtn'],
        ['Liberar', 'waInboxReleaseBtn'],
        ['Limpiar sesión', 'waInboxClearBtn'],
        ['Info cliente', 'waInboxToggleClient'],
        ['back móvil', 'waInboxBack'],
        ['scroll mensajes', 'waInboxMessages'],
        ['composer', 'waInboxComposer'],
        ['Enviar', 'waInboxSendBtn'],
        ['panel cliente', 'waInboxClientCol'],
        ['cuerpo ficha', 'waInboxClientBody'],
        ['cache-bust 2026072013+', 'admin.js?v=202607201'],
    ].forEach(([label, needle]) => {
        expect(html.includes(needle), label);
    });
    expect(!html.includes('waHandoffCard'), 'Legacy waHandoffCard eliminado');
    expect(!html.includes('Pedido') || !html.includes('waInbox'), 'Sin badges e-commerce en inbox');

    // ─── 4. JS comportamientos ───────────────────────────────────────────
    console.log('\n4. JS comportamientos');
    const js = read('public/admin.js');
    [
        ['loadWhatsAppInbox', 'loadWhatsAppInbox'],
        ['loadWhatsAppInboxChat', 'loadWhatsAppInboxChat'],
        ['loadWhatsAppInboxClient', 'loadWhatsAppInboxClient'],
        ['selectWhatsAppInboxSession', 'selectWhatsAppInboxSession'],
        ['takeWhatsAppInboxSession', 'takeWhatsAppInboxSession'],
        ['releaseWhatsAppInboxSession', 'releaseWhatsAppInboxSession'],
        ['clearWhatsAppInboxSession', 'clearWhatsAppInboxSession'],
        ['sendWhatsAppInboxReply', 'sendWhatsAppInboxReply'],
        ['polling lista 5s', '}, 5000)'],
        ['polling chat 3s', '}, 3000)'],
        ['WA_INBOX_LIMIT 50', 'WA_INBOX_LIMIT = 50'],
        ['tiempo relativo', 'waRelativeTime'],
        ['Ayer HH:MM', 'Ayer '],
        ['burbuja user izquierda', 'wa-chat-user'],
        ['burbuja bot/agente', 'wa-chat-bot'],
        ['tool pills', 'wa-tool-pill'],
        ['composer solo handoff', 'composer.hidden = !session?.handoffActive'],
        ['móvil show-chat', 'wa-inbox-show-chat'],
        ['panel cliente open', 'wa-inbox-client-open'],
        ['SSE refresca inbox', 'loadWhatsAppInbox(true)'],
        ['API sessions?mode=', 'mode: mode'],
        ['API /client', '/client'],
        ['API /clear', '/clear'],
    ].forEach(([label, needle]) => {
        expect(js.includes(needle), label);
    });
    expect(!js.includes('loadWhatsAppHandoff'), 'Legacy loadWhatsAppHandoff eliminado');
    expect(!js.includes('waHandoffSelectedPhone'), 'Legacy waHandoffSelectedPhone eliminado');

    // ─── 5. CSS split + móvil ────────────────────────────────────────────
    console.log('\n5. CSS layout');
    const css = read('public/admin.css');
    [
        ['grid lista+chat', '.wa-inbox-layout'],
        ['lista ~300px', 'grid-template-columns: 300px'],
        ['3 columnas con cliente', '280px minmax(0, 1fr) 260px'],
        ['avatar', '.wa-inbox-avatar'],
        ['badges', '.wa-badge-unread'],
        ['burbujas alineadas', '.wa-chat-user'],
        ['tool pill', '.wa-tool-pill'],
        ['composer', '.wa-inbox-composer'],
        ['panel cliente', '.wa-inbox-client-col'],
        ['breakpoint móvil 960', '@media (max-width: 960px)'],
        ['móvil show-chat', 'wa-inbox-show-chat'],
        ['back visible móvil', '.wa-inbox-back'],
        ['cliente en móvil', 'wa-inbox-client-open .wa-inbox-client-col'],
    ].forEach(([label, needle]) => {
        expect(css.includes(needle), label);
    });
    expect(css.includes('#waInboxCard'), 'Estilo borde panel #waInboxCard');
    expect(!css.includes('#waHandoffCard'), 'CSS legacy #waHandoffCard eliminado');

    // ─── 6. Runtime DB + flujos sesión ───────────────────────────────────
    console.log('\n6. Runtime — sesión / handoff / clear / enrich');
    const prisma = require('../src/db');
    const { getOrCreateSession, startHandoff, endHandoff } = require('../src/utils/chatSession');
    const { appendChatMessage } = require('../src/utils/chatMessages');

    try {
        // Limpieza previa
        const existing = await prisma.whatsAppSession.findUnique({ where: { phone: TEST_PHONE } });
        if (existing) {
            await prisma.chatMessage.deleteMany({ where: { sessionId: existing.id } });
            await prisma.whatsAppSession.delete({ where: { id: existing.id } });
        }

        let session = await getOrCreateSession(TEST_PHONE, { contactName: 'Verify Cristiano' });
        expect(session.phone === TEST_PHONE && session.step === 'menu', 'Crear sesión de prueba');
        expect(meta.initialsFromSession(session) === 'VC', 'Iniciales Verify Cristiano → VC');
        expect(meta.channelFromSession(session).key === 'rules', 'Canal inicial Bot');

        await appendChatMessage({
            phone: TEST_PHONE,
            role: 'user',
            direction: 'inbound',
            body: 'Hola, quiero reservar un turno de adoración por favor y algo más de texto para preview',
        });
        await appendChatMessage({
            phone: TEST_PHONE,
            role: 'assistant',
            direction: 'outbound',
            body: '¡Bendiciones! Te ayudo con tu reserva.',
        });

        session = await prisma.whatsAppSession.update({
            where: { phone: TEST_PHONE },
            data: { step: 'book_weekday', mode: 'ai' },
        });
        expect(meta.funnelFromSession(session).key === 'booking', 'Paso book_weekday → Reservando');
        expect(meta.channelFromSession(session).key === 'ai', 'Mode ai → canal IA');

        session = await startHandoff(TEST_PHONE, { operatorId: 1, reason: 'verify cristiano' });
        expect(session.handoffActive === true && session.mode === 'handoff', 'Tomar (startHandoff)');
        expect(meta.channelFromSession(session).key === 'human', 'Handoff → canal Humano');
        expect(meta.funnelFromSession(session).key === 'handoff', 'Handoff → funnel Handoff');

        await appendChatMessage({
            phone: TEST_PHONE,
            role: 'operator',
            direction: 'outbound',
            body: 'Hola, soy el operador. ¿En qué te ayudo?',
            operatorId: 1,
        });
        await appendChatMessage({
            phone: TEST_PHONE,
            role: 'user',
            direction: 'inbound',
            body: 'Necesito ayuda con mi horario',
        });

        // Enrich equivalente a API (preview + unread)
        const last = await prisma.chatMessage.findFirst({
            where: { sessionId: session.id, role: { in: ['user', 'assistant', 'operator'] } },
            orderBy: { createdAt: 'desc' },
        });
        const lastOutbound = await prisma.chatMessage.findFirst({
            where: { sessionId: session.id, role: { in: ['assistant', 'operator'] } },
            orderBy: { createdAt: 'desc' },
            select: { createdAt: true },
        });
        const unread = await prisma.chatMessage.count({
            where: {
                sessionId: session.id,
                role: 'user',
                ...(lastOutbound?.createdAt ? { createdAt: { gt: lastOutbound.createdAt } } : {}),
            },
        });
        const preview = meta.truncatePreview(last?.body || '', 60);
        expect(last?.role === 'user', 'Último mensaje es del usuario');
        expect(preview.length > 0 && preview.length <= 60, 'Preview último mensaje ≤60');
        expect(unread >= 1, `Unread ≥1 tras mensaje user post-operador (got ${unread})`);

        // Métricas respuesta (client panel)
        const msgs = await prisma.chatMessage.findMany({
            where: { sessionId: session.id, role: { in: ['user', 'assistant', 'operator'] } },
            orderBy: { createdAt: 'asc' },
            select: { role: true, createdAt: true },
        });
        let pairs = 0;
        for (let i = 0; i < msgs.length - 1; i++) {
            if (msgs[i].role === 'user' && ['assistant', 'operator'].includes(msgs[i + 1].role)) pairs += 1;
        }
        expect(pairs >= 1, `Pares user→respuesta para avgResponse (got ${pairs})`);

        session = await endHandoff(TEST_PHONE, { mode: 'rules' });
        expect(session.handoffActive === false && session.mode === 'rules', 'Liberar (endHandoff)');

        // Clear como API
        session = await prisma.whatsAppSession.update({
            where: { phone: TEST_PHONE },
            data: {
                step: 'menu',
                mode: 'rules',
                handoffActive: false,
                assignedOperatorId: null,
                handoffReason: null,
                data: '{}',
            },
        });
        expect(session.step === 'menu' && !session.handoffActive, 'Limpiar sesión → menú');

        // Filtros listado (equivalente GET /sessions)
        const all = await prisma.whatsAppSession.count();
        const handoffN = await prisma.whatsAppSession.count({ where: { handoffActive: true } });
        const aiN = await prisma.whatsAppSession.count({ where: { handoffActive: false, mode: 'ai' } });
        const qHit = await prisma.whatsAppSession.count({
            where: {
                OR: [{ phone: { contains: TEST_PHONE } }, { contactName: { contains: 'Verify' } }],
            },
        });
        expect(all >= 1, `Listado total ≥1 (got ${all})`);
        expect(typeof handoffN === 'number' && typeof aiN === 'number', 'Filtros handoff/ai ejecutables');
        expect(qHit >= 1, 'Búsqueda q por teléfono/nombre encuentra sesión verify');

        // Mensajes ordenados (chat scroll)
        const chatMsgs = await prisma.chatMessage.findMany({
            where: { sessionId: session.id },
            orderBy: { createdAt: 'asc' },
        });
        expect(chatMsgs.length >= 4, `Historial chat ≥4 mensajes (got ${chatMsgs.length})`);
        expect(
            chatMsgs.some((m) => m.role === 'user') &&
                chatMsgs.some((m) => m.role === 'assistant') &&
                chatMsgs.some((m) => m.role === 'operator'),
            'Historial incluye user + assistant + operator'
        );

        // Cleanup
        await prisma.chatMessage.deleteMany({ where: { sessionId: session.id } });
        await prisma.whatsAppSession.delete({ where: { id: session.id } });
        ok('Limpieza sesión de prueba');
    } catch (e) {
        fail('Runtime sesión', e.message);
        try {
            const s = await prisma.whatsAppSession.findUnique({ where: { phone: TEST_PHONE } });
            if (s) {
                await prisma.chatMessage.deleteMany({ where: { sessionId: s.id } });
                await prisma.whatsAppSession.delete({ where: { id: s.id } });
            }
        } catch (_) {}
    }

    // ─── 7. Integridad fases + verify ─────────────────────────────────────
    console.log('\n7. Integridad con fases previas');
    expect(api.includes('WHATSAPP_OPERATE'), 'Permiso WHATSAPP_OPERATE en rutas');
    expect(js.includes('connectWhatsAppSse'), 'SSE conectado desde inbox');
    expect(html.includes('data-perm="WHATSAPP_OPERATE"'), 'Card gated por WHATSAPP_OPERATE');

    console.log(
        '\n' +
            (failed
                ? `RESULTADO: ${failed} fallo(s), ${passed} OK`
                : `RESULTADO: Todas las verificaciones OK (${passed})`) +
            '\n'
    );
    process.exit(failed ? 1 : 0);
}

main().catch((e) => {
    console.error(e);
    process.exit(1);
});
