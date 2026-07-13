const express = require('express');
const prisma = require('../db');
const { requirePermission, attachPrivileges, PRIV } = require('../middleware/auth');
const { normalizePhone } = require('../utils/phone');
const config = require('../config');
const { writeAudit } = require('../utils/audit');
const { sendText } = require('../utils/whatsapp');
const { appendChatMessage } = require('../utils/chatMessages');
const { startHandoff, endHandoff } = require('../utils/chatSession');
const { subscribeWhatsAppSse, getSseClientCount, broadcastWhatsAppEvent } = require('../ws/adminWhatsAppHub');
const {
    getWhatsAppBotConfig,
    invalidateWhatsAppBotConfigCache,
    serializeBotConfig,
    DEFAULT_WHATSAPP_BOT_CONFIG,
} = require('../utils/whatsappBotConfig');

const router = express.Router();

function serializeMessage(row) {
    let meta = null;
    if (row.meta) {
        try {
            meta = JSON.parse(row.meta);
        } catch {
            meta = row.meta;
        }
    }
    return {
        id: row.id,
        direction: row.direction,
        phone: row.phone,
        waMessageId: row.waMessageId,
        messageType: row.messageType,
        body: row.body,
        meta,
        status: row.status,
        contactName: row.contactName,
        createdAt: row.createdAt,
    };
}

router.get('/stats', requirePermission(PRIV.WHATSAPP_VIEW), async (req, res) => {
    try {
        const today = new Date();
        today.setHours(0, 0, 0, 0);

        const [inboundToday, outboundToday, total, uniquePhones, handoffActive, chatMessagesToday, botCfg] =
            await Promise.all([
            prisma.whatsAppMessageLog.count({
                where: { direction: 'inbound', createdAt: { gte: today } },
            }),
            prisma.whatsAppMessageLog.count({
                where: { direction: 'outbound', createdAt: { gte: today } },
            }),
            prisma.whatsAppMessageLog.count(),
            prisma.whatsAppMessageLog.findMany({
                distinct: ['phone'],
                select: { phone: true },
            }),
            prisma.whatsAppSession.count({ where: { handoffActive: true } }),
            prisma.chatMessage.count({ where: { createdAt: { gte: today } } }),
            getWhatsAppBotConfig({ fresh: true }),
        ]);

        res.json({
            enabled: config.whatsapp.enabled,
            apiConnected: config.whatsappEnabled,
            templatesEnabled: config.whatsappTemplatesEnabled,
            templates: {
                language: config.whatsapp.templates.language,
                reminder24h: config.whatsapp.templates.reminder24h || null,
                reminder3h: config.whatsapp.templates.reminder3h || null,
                captainEmergency: config.whatsapp.templates.captainEmergency || null,
                bookingConfirmed: config.whatsapp.templates.bookingConfirmed || null,
            },
            inboundToday,
            outboundToday,
            totalMessages: total,
            uniqueContacts: uniquePhones.length,
            handoffActive,
            chatMessagesToday,
            sseClients: getSseClientCount(),
            ai: {
                enabled: botCfg.aiEnabled === true,
                provider: botCfg.aiProvider,
                model: botCfg.aiModel,
                keyConfigured: Boolean(botCfg.deepseekApiKey),
                connected: Boolean(botCfg.aiEnabled && botCfg.deepseekApiKey),
            },
        });
    } catch (e) {
        console.error(e);
        res.status(500).json({ error: 'Error al obtener estadísticas de WhatsApp.' });
    }
});

router.get('/messages', requirePermission(PRIV.WHATSAPP_VIEW), async (req, res) => {
    try {
        const limit = Math.min(100, Math.max(1, Number(req.query.limit) || 50));
        const offset = Math.max(0, Number(req.query.offset) || 0);
        const direction = req.query.direction;
        const phone = normalizePhone(req.query.phone);
        const q = String(req.query.q || '').trim();

        const where = {};
        if (direction === 'inbound' || direction === 'outbound') {
            where.direction = direction;
        }
        if (phone) {
            where.phone = phone;
        }
        if (q) {
            where.body = { contains: q };
        }

        const [messages, total] = await Promise.all([
            prisma.whatsAppMessageLog.findMany({
                where,
                orderBy: { createdAt: 'desc' },
                skip: offset,
                take: limit,
            }),
            prisma.whatsAppMessageLog.count({ where }),
        ]);

        res.json({
            messages: messages.map(serializeMessage),
            total,
            limit,
            offset,
        });
    } catch (e) {
        console.error(e);
        res.status(500).json({ error: 'Error al listar mensajes de WhatsApp.' });
    }
});

router.get('/conversations', requirePermission(PRIV.WHATSAPP_VIEW), async (req, res) => {
    try {
        const limit = Math.min(50, Math.max(1, Number(req.query.limit) || 30));
        const rows = await prisma.whatsAppMessageLog.findMany({
            orderBy: { createdAt: 'desc' },
            take: 500,
        });

        const byPhone = new Map();
        for (const row of rows) {
            if (byPhone.has(row.phone)) continue;
            byPhone.set(row.phone, serializeMessage(row));
            if (byPhone.size >= limit) break;
        }

        res.json({ conversations: [...byPhone.values()] });
    } catch (e) {
        console.error(e);
        res.status(500).json({ error: 'Error al listar conversaciones.' });
    }
});

router.get('/bot-config', requirePermission(PRIV.WHATSAPP_VIEW), async (req, res) => {
    try {
        const row = await prisma.whatsAppBotConfig.findUnique({ where: { id: 1 } });
        const botConfig = serializeBotConfig(row);
        res.json({ botConfig, isSuperAdmin: Boolean(req.user?.isSuperAdmin) });
    } catch (e) {
        console.error(e);
        res.status(500).json({ error: 'Error al cargar configuración del chatbot.' });
    }
});

function validateBotConfigBody(body = {}) {
    const errors = [];
    const botName = String(body.botName || '').trim();
    if (!botName || botName.length > 40) errors.push('Nombre del bot inválido (máx. 40 caracteres).');

    const tone = String(body.tone || 'pastoral');
    if (!['pastoral', 'formal', 'cercano', 'sereno'].includes(tone)) {
        errors.push('Tono inválido.');
    }

    const formality = String(body.formality || 'usted');
    if (!['usted', 'tu'].includes(formality)) {
        errors.push('Tratamiento inválido.');
    }

    const responseMaxChars = Number(body.responseMaxChars ?? 900);
    if (!Number.isFinite(responseMaxChars) || responseMaxChars < 200 || responseMaxChars > 2000) {
        errors.push('Límite de caracteres debe estar entre 200 y 2000.');
    }

    let customFaqJson = body.customFaqJson;
    if (customFaqJson !== undefined && customFaqJson !== null) {
        if (typeof customFaqJson !== 'string') {
            customFaqJson = JSON.stringify(customFaqJson);
        }
        try {
            const parsed = JSON.parse(customFaqJson);
            if (!Array.isArray(parsed)) errors.push('FAQ personalizadas debe ser un arreglo JSON.');
            else if (parsed.length > 30) errors.push('Máximo 30 entradas en FAQ personalizadas.');
        } catch {
            errors.push('FAQ personalizadas: JSON inválido.');
        }
    }

    return { errors, botName, tone, formality, responseMaxChars, customFaqJson };
}

router.put('/bot-config', requirePermission(PRIV.WHATSAPP_MANAGE), async (req, res) => {
    try {
        const body = req.body || {};
        const { errors, botName, tone, formality, responseMaxChars, customFaqJson } =
            validateBotConfigBody(body);
        if (errors.length) {
            return res.status(400).json({ error: errors.join(' ') });
        }

        const data = {
            enabled: body.enabled !== false,
            botName,
            assistantTitle: String(body.assistantTitle || DEFAULT_WHATSAPP_BOT_CONFIG.assistantTitle).trim().slice(0, 80),
            language: String(body.language || 'es').trim().slice(0, 10),
            locale: String(body.locale || 'es-GT').trim().slice(0, 12),
            tone,
            formality,
            useEmojis: body.useEmojis !== false,
            welcomeTitle: body.welcomeTitle ? String(body.welcomeTitle).trim().slice(0, 120) : null,
            welcomeBody: body.welcomeBody ? String(body.welcomeBody).trim().slice(0, 500) : null,
            menuHelpLabel: String(body.menuHelpLabel || 'Cómo funciona').trim().slice(0, 40),
            personalityInstructions: body.personalityInstructions
                ? String(body.personalityInstructions).trim().slice(0, 3000)
                : null,
            chapelDescription: body.chapelDescription
                ? String(body.chapelDescription).trim().slice(0, 500)
                : null,
            adorationHours: body.adorationHours
                ? String(body.adorationHours).trim().slice(0, 200)
                : null,
            fallbackMessage: body.fallbackMessage
                ? String(body.fallbackMessage).trim().slice(0, 500)
                : null,
            goodbyeMessage: body.goodbyeMessage
                ? String(body.goodbyeMessage).trim().slice(0, 300)
                : null,
            escalationMessage: body.escalationMessage
                ? String(body.escalationMessage).trim().slice(0, 500)
                : null,
            prohibitedTopics: body.prohibitedTopics
                ? String(body.prohibitedTopics).trim().slice(0, 1000)
                : null,
            responseMaxChars,
            inviteToWebUrl: body.inviteToWebUrl
                ? String(body.inviteToWebUrl).trim().slice(0, 300)
                : null,
            handoffRulesJson:
                body.handoffRulesJson != null ? String(body.handoffRulesJson).slice(0, 4000) : undefined,
            enabledToolsJson:
                body.enabledToolsJson != null ? String(body.enabledToolsJson).slice(0, 4000) : undefined,
            updatedById: req.user?.id ?? null,
        };

        if (req.user?.isSuperAdmin) {
            if (body.aiEnabled !== undefined) data.aiEnabled = body.aiEnabled === true;
            if (body.aiProvider) data.aiProvider = String(body.aiProvider).trim().slice(0, 40);
            if (body.aiModel) data.aiModel = String(body.aiModel).trim().slice(0, 80);
            if (body.aiBaseUrl) data.aiBaseUrl = String(body.aiBaseUrl).trim().slice(0, 200);
            if (body.aiMaxIterations != null) {
                const n = Number(body.aiMaxIterations);
                if (Number.isFinite(n) && n >= 1 && n <= 12) data.aiMaxIterations = n;
            }
            if (body.aiHistoryLimit != null) {
                const n = Number(body.aiHistoryLimit);
                if (Number.isFinite(n) && n >= 5 && n <= 60) data.aiHistoryLimit = n;
            }
            const key = body.deepseekApiKey;
            if (key === '') {
                data.deepseekApiKey = null;
            } else if (key && String(key).trim()) {
                data.deepseekApiKey = String(key).trim();
            }
        }

        if (customFaqJson !== undefined) {
            data.customFaqJson = customFaqJson;
        }

        const row = await prisma.whatsAppBotConfig.upsert({
            where: { id: 1 },
            create: { id: 1, ...DEFAULT_WHATSAPP_BOT_CONFIG, ...data },
            update: data,
        });

        invalidateWhatsAppBotConfigCache();
        await writeAudit({
            action: 'whatsapp.bot_config.update',
            entity: 'whatsapp_bot_config',
            entityId: 1,
            userId: req.user?.id ?? null,
            meta: { botName: data.botName, tone: data.tone, enabled: data.enabled },
            req,
        });

        res.json({ message: 'Configuración del chatbot guardada.', botConfig: serializeBotConfig(row) });
    } catch (e) {
        console.error(e);
        res.status(500).json({ error: 'Error al guardar configuración del chatbot.' });
    }
});

function serializeSession(row) {
    return {
        id: row.id,
        phone: row.phone,
        step: row.step,
        mode: row.mode,
        handoffActive: row.handoffActive,
        assignedOperatorId: row.assignedOperatorId,
        handoffReason: row.handoffReason,
        contactName: row.contactName,
        lastMessageAt: row.lastMessageAt,
        updatedAt: row.updatedAt,
    };
}

router.get('/sessions', requirePermission(PRIV.WHATSAPP_OPERATE), async (req, res) => {
    try {
        const handoffOnly = req.query.handoff === '1' || req.query.handoff === 'true';
        const limit = Math.min(100, Math.max(1, Number(req.query.limit) || 40));
        const where = handoffOnly ? { handoffActive: true } : {};
        const sessions = await prisma.whatsAppSession.findMany({
            where,
            orderBy: { lastMessageAt: 'desc' },
            take: limit,
        });
        res.json({ sessions: sessions.map(serializeSession) });
    } catch (e) {
        console.error(e);
        res.status(500).json({ error: 'Error al listar sesiones.' });
    }
});

router.get('/sessions/:phone/messages', requirePermission(PRIV.WHATSAPP_OPERATE), async (req, res) => {
    try {
        const phone = normalizePhone(req.params.phone);
        if (!phone) return res.status(400).json({ error: 'Teléfono inválido.' });
        const session = await prisma.whatsAppSession.findUnique({ where: { phone } });
        if (!session) return res.json({ messages: [], session: null });
        const limit = Math.min(200, Math.max(1, Number(req.query.limit) || 80));
        const messages = await prisma.chatMessage.findMany({
            where: { sessionId: session.id },
            orderBy: { createdAt: 'asc' },
            take: limit,
        });
        res.json({ session: serializeSession(session), messages });
    } catch (e) {
        console.error(e);
        res.status(500).json({ error: 'Error al cargar historial.' });
    }
});

router.post('/sessions/:phone/handoff', requirePermission(PRIV.WHATSAPP_OPERATE), async (req, res) => {
    try {
        const phone = normalizePhone(req.params.phone);
        if (!phone) return res.status(400).json({ error: 'Teléfono inválido.' });
        const reason = String(req.body?.reason || 'Operador tomó la conversación').slice(0, 500);
        const session = await startHandoff(phone, {
            operatorId: req.user.id,
            reason,
        });
        broadcastWhatsAppEvent('handoff:started', { phone, reason, operatorId: req.user.id });
        await writeAudit({
            action: 'whatsapp.handoff.start',
            entity: 'whatsapp_session',
            entityId: session.id,
            userId: req.user.id,
            meta: { phone, reason },
            req,
        });
        res.json({ message: 'Handoff activado.', session: serializeSession(session) });
    } catch (e) {
        console.error(e);
        res.status(500).json({ error: 'Error al activar handoff.' });
    }
});

router.post('/sessions/:phone/release', requirePermission(PRIV.WHATSAPP_OPERATE), async (req, res) => {
    try {
        const phone = normalizePhone(req.params.phone);
        if (!phone) return res.status(400).json({ error: 'Teléfono inválido.' });
        const mode = req.body?.mode === 'ai' ? 'ai' : 'rules';
        const session = await endHandoff(phone, { mode });
        broadcastWhatsAppEvent('handoff:released', { phone, mode });
        await writeAudit({
            action: 'whatsapp.handoff.release',
            entity: 'whatsapp_session',
            entityId: session.id,
            userId: req.user.id,
            meta: { phone, mode },
            req,
        });
        res.json({ message: 'Conversación devuelta al bot.', session: serializeSession(session) });
    } catch (e) {
        console.error(e);
        res.status(500).json({ error: 'Error al liberar handoff.' });
    }
});

router.post('/sessions/:phone/reply', requirePermission(PRIV.WHATSAPP_OPERATE), async (req, res) => {
    try {
        const phone = normalizePhone(req.params.phone);
        const text = String(req.body?.text || '').trim();
        if (!phone) return res.status(400).json({ error: 'Teléfono inválido.' });
        if (!text) return res.status(400).json({ error: 'Mensaje vacío.' });

        const session = await prisma.whatsAppSession.findUnique({ where: { phone } });
        if (!session?.handoffActive) {
            return res.status(400).json({ error: 'La conversación no está en handoff.' });
        }

        await sendText(phone, text);
        await appendChatMessage({
            phone,
            role: 'operator',
            direction: 'outbound',
            body: text,
            operatorId: req.user.id,
        });
        broadcastWhatsAppEvent('message:outbound', { phone, body: text, operatorId: req.user.id });

        res.json({ message: 'Mensaje enviado.' });
    } catch (e) {
        console.error(e);
        res.status(500).json({ error: 'Error al enviar mensaje.' });
    }
});

router.get('/events', (req, res) => {
    const header = req.headers.authorization || '';
    const bearer = header.startsWith('Bearer ') ? header.slice(7) : null;
    const token = bearer || req.query.token;
    if (!token) return res.status(401).json({ error: 'No autenticado.' });
    try {
        const jwt = require('jsonwebtoken');
        req.user = jwt.verify(token, config.jwtSecret);
    } catch {
        return res.status(401).json({ error: 'Sesión inválida.' });
    }
    attachPrivileges(req, res, () => {
        const privs = req.user?.privileges ?? 0;
        const { hasPermission } = require('../constants/permissions');
        if (!hasPermission(privs, PRIV.WHATSAPP_OPERATE)) {
            return res.status(403).json({ error: 'Sin permiso.' });
        }
        subscribeWhatsAppSse(res);
    });
});

module.exports = router;
