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
    funnelFromSession,
    channelFromSession,
    initialsFromSession,
    truncatePreview,
} = require('../utils/whatsappInboxMeta');
const {
    getWhatsAppBotConfig,
    invalidateWhatsAppBotConfigCache,
    serializeBotConfig,
    DEFAULT_WHATSAPP_BOT_CONFIG,
} = require('../utils/whatsappBotConfig');
const { testDeepSeekConnection, validateDeepSeekApiKey } = require('../utils/ai/deepseekClient');

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
                const validated = validateDeepSeekApiKey(key);
                if (!validated.ok) {
                    return res.status(400).json({ error: validated.error });
                }
                data.deepseekApiKey = validated.key;
            }
        }

        if (customFaqJson !== undefined) {
            data.customFaqJson = customFaqJson;
        }

        if (req.user?.isSuperAdmin && data.aiEnabled === true) {
            const current = await prisma.whatsAppBotConfig.findUnique({ where: { id: 1 } });
            const effectiveKey = data.deepseekApiKey ?? current?.deepseekApiKey;
            if (!validateDeepSeekApiKey(effectiveKey).ok) {
                return res.status(400).json({
                    error: 'Para activar la IA guarda primero una API key válida (sk-…) con el botón «Guardar API key e IA».',
                });
            }
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

router.post('/ai-test', requirePermission(PRIV.WHATSAPP_MANAGE), async (req, res) => {
    if (!req.user?.isSuperAdmin) {
        return res.status(403).json({ error: 'Solo el super administrador puede probar DeepSeek.' });
    }
    try {
        const botCfg = await getWhatsAppBotConfig({ fresh: true });
        const fromField = String(req.body?.deepseekApiKey || '').trim();
        const apiKey = fromField || botCfg.deepseekApiKey;
        const baseUrl = String(req.body?.aiBaseUrl || botCfg.aiBaseUrl || 'https://api.deepseek.com').trim();
        const model = String(req.body?.aiModel || botCfg.aiModel || 'deepseek-chat').trim();
        const result = await testDeepSeekConnection({ apiKey, baseUrl, model });
        const savedInDb = Boolean(botCfg.deepseekApiKey && validateDeepSeekApiKey(botCfg.deepseekApiKey).ok);
        res.json({
            message: fromField && !savedInDb
                ? 'Conexión OK con la key del campo. Guarda la API key para activarla en WhatsApp.'
                : 'Conexión con DeepSeek exitosa.',
            ...result,
            keySource: fromField ? 'request' : 'saved',
            savedInDb,
            whatsappWillUseAi: savedInDb && botCfg.aiEnabled,
        });
    } catch (e) {
        console.error('[WhatsApp ai-test]', e.message);
        res.status(400).json({ error: e.message || 'No se pudo conectar con DeepSeek.' });
    }
});

router.put('/ai-config', requirePermission(PRIV.WHATSAPP_MANAGE), async (req, res) => {
    if (!req.user?.isSuperAdmin) {
        return res.status(403).json({ error: 'Solo el super administrador puede configurar DeepSeek.' });
    }
    try {
        const body = req.body || {};
        const data = {
            aiEnabled: body.aiEnabled === true,
            aiProvider: String(body.aiProvider || 'deepseek').trim().slice(0, 40),
            aiModel: String(body.aiModel || 'deepseek-chat').trim().slice(0, 80),
            aiBaseUrl: String(body.aiBaseUrl || 'https://api.deepseek.com').trim().slice(0, 200),
            aiMaxIterations: Math.min(12, Math.max(1, Number(body.aiMaxIterations) || 6)),
            aiHistoryLimit: Math.min(60, Math.max(5, Number(body.aiHistoryLimit) || 30)),
            inviteToWebUrl: body.inviteToWebUrl ? String(body.inviteToWebUrl).trim().slice(0, 300) : null,
            updatedById: req.user?.id ?? null,
        };

        const key = body.deepseekApiKey;
        if (key === '') {
            data.deepseekApiKey = null;
        } else if (key && String(key).trim()) {
            const validated = validateDeepSeekApiKey(key);
            if (!validated.ok) {
                return res.status(400).json({ error: validated.error });
            }
            data.deepseekApiKey = validated.key;
        }

        if (data.aiEnabled) {
            const current = await prisma.whatsAppBotConfig.findUnique({ where: { id: 1 } });
            const effectiveKey = data.deepseekApiKey ?? current?.deepseekApiKey;
            if (!validateDeepSeekApiKey(effectiveKey).ok) {
                return res.status(400).json({
                    error: 'Para activar la IA debes guardar una API key válida (sk-…) de platform.deepseek.com.',
                });
            }
        }

        const row = await prisma.whatsAppBotConfig.upsert({
            where: { id: 1 },
            create: { id: 1, ...DEFAULT_WHATSAPP_BOT_CONFIG, ...data },
            update: data,
        });

        invalidateWhatsAppBotConfigCache();
        await writeAudit({
            action: 'whatsapp.ai_config.update',
            entity: 'whatsapp_bot_config',
            entityId: 1,
            userId: req.user?.id ?? null,
            meta: { aiEnabled: data.aiEnabled, keyUpdated: Boolean(data.deepseekApiKey) },
            req,
        });

        const pub = serializeBotConfig(row);
        res.json({
            message: 'API key e IA guardadas. WhatsApp ya puede usar DeepSeek.',
            botConfig: pub,
            aiConnected: Boolean(row.aiEnabled && row.deepseekApiKey),
        });
    } catch (e) {
        console.error(e);
        res.status(500).json({ error: 'Error al guardar configuración de IA.' });
    }
});

function serializeSession(row, extras = {}) {
    const funnel = funnelFromSession(row);
    const channel = channelFromSession(row);
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
        createdAt: row.createdAt,
        initials: initialsFromSession(row),
        funnelKey: funnel.key,
        funnelLabel: funnel.label,
        channelKey: channel.key,
        channelLabel: channel.label,
        ...extras,
    };
}

async function enrichSessionRow(row) {
    const last = await prisma.chatMessage.findFirst({
        where: {
            sessionId: row.id,
            role: { in: ['user', 'assistant', 'operator'] },
        },
        orderBy: { createdAt: 'desc' },
    });
    const lastOutbound = await prisma.chatMessage.findFirst({
        where: { sessionId: row.id, role: { in: ['assistant', 'operator'] } },
        orderBy: { createdAt: 'desc' },
        select: { createdAt: true },
    });
    const unreadWhere = {
        sessionId: row.id,
        role: 'user',
        ...(lastOutbound?.createdAt ? { createdAt: { gt: lastOutbound.createdAt } } : {}),
    };
    const unreadCount = await prisma.chatMessage.count({ where: unreadWhere });
    return serializeSession(row, {
        lastMessagePreview: truncatePreview(last?.body || ''),
        lastMessageRole: last?.role || null,
        unreadCount: Math.min(unreadCount, 99),
        needsAttention: row.handoffActive || unreadCount > 0,
    });
}

router.get('/sessions', requirePermission(PRIV.WHATSAPP_OPERATE), async (req, res) => {
    try {
        const handoffOnly = req.query.handoff === '1' || req.query.handoff === 'true';
        const mode = String(req.query.mode || 'all'); // all | ai | rules | handoff | human
        const q = String(req.query.q || '').trim();
        const limit = Math.min(100, Math.max(1, Number(req.query.limit) || 50));
        const offset = Math.max(0, Number(req.query.offset) || 0);

        const where = {};
        if (handoffOnly || mode === 'handoff' || mode === 'human') {
            where.handoffActive = true;
        } else if (mode === 'ai') {
            where.handoffActive = false;
            where.mode = 'ai';
        } else if (mode === 'rules') {
            where.handoffActive = false;
            where.mode = 'rules';
        }
        if (q) {
            where.OR = [
                { phone: { contains: normalizePhone(q) || q } },
                { contactName: { contains: q } },
            ];
        }

        const [rows, total] = await Promise.all([
            prisma.whatsAppSession.findMany({
                where,
                orderBy: [{ lastMessageAt: 'desc' }, { updatedAt: 'desc' }],
                skip: offset,
                take: limit,
            }),
            prisma.whatsAppSession.count({ where }),
        ]);

        const sessions = [];
        for (const row of rows) {
            sessions.push(await enrichSessionRow(row));
        }

        res.json({ sessions, total, limit, offset });
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
        const limit = Math.min(200, Math.max(1, Number(req.query.limit) || 120));
        const messages = await prisma.chatMessage.findMany({
            where: { sessionId: session.id },
            orderBy: { createdAt: 'asc' },
            take: limit,
        });
        res.json({
            session: await enrichSessionRow(session),
            messages: messages.map((m) => ({
                id: m.id,
                role: m.role,
                direction: m.direction,
                body: m.body,
                toolName: m.toolName,
                messageType: m.messageType,
                operatorId: m.operatorId,
                createdAt: m.createdAt,
            })),
        });
    } catch (e) {
        console.error(e);
        res.status(500).json({ error: 'Error al cargar historial.' });
    }
});

router.get('/sessions/:phone/client', requirePermission(PRIV.WHATSAPP_OPERATE), async (req, res) => {
    try {
        const phone = normalizePhone(req.params.phone);
        if (!phone) return res.status(400).json({ error: 'Teléfono inválido.' });
        const session = await prisma.whatsAppSession.findUnique({ where: { phone } });
        if (!session) return res.status(404).json({ error: 'Sesión no encontrada.' });

        const user = await prisma.user.findFirst({
            where: { OR: [{ phoneNumber: phone }, { phoneNumber: { endsWith: phone } }] },
            select: { id: true, name: true, email: true, phoneNumber: true, role: true, createdAt: true },
        });

        const reservations = await prisma.reservation.findMany({
            where: { userPhone: phone, status: { in: ['confirmed', 'completed'] } },
            include: { slot: { select: { startTime: true, endTime: true } } },
            orderBy: { date: 'desc' },
            take: 8,
        });

        const messages = await prisma.chatMessage.findMany({
            where: { sessionId: session.id, role: { in: ['user', 'assistant', 'operator'] } },
            orderBy: { createdAt: 'asc' },
            select: { role: true, createdAt: true },
        });

        let responseSumMs = 0;
        let responseCount = 0;
        for (let i = 0; i < messages.length - 1; i++) {
            if (messages[i].role === 'user' && ['assistant', 'operator'].includes(messages[i + 1].role)) {
                const delta = new Date(messages[i + 1].createdAt) - new Date(messages[i].createdAt);
                if (delta > 0 && delta < 30 * 60 * 1000) {
                    responseSumMs += delta;
                    responseCount += 1;
                }
            }
        }

        let sessionData = null;
        try {
            sessionData = session.data ? JSON.parse(session.data) : null;
        } catch {
            sessionData = null;
        }

        const auditRows = await prisma.auditLog.findMany({
            where: {
                entity: 'whatsapp_session',
                entityId: session.id,
                action: { in: ['whatsapp.handoff.start', 'whatsapp.handoff.release', 'whatsapp.session.clear'] },
            },
            include: { user: { select: { id: true, name: true, email: true } } },
            orderBy: { createdAt: 'desc' },
            take: 20,
        });

        const assignments = auditRows.map((a) => {
            let meta = null;
            try {
                meta = a.meta ? JSON.parse(a.meta) : null;
            } catch {
                meta = null;
            }
            return {
                action: a.action,
                at: a.createdAt,
                operatorName: a.user?.name || a.user?.email || null,
                operatorId: a.userId,
                reason: meta?.reason || null,
                mode: meta?.mode || null,
            };
        });

        res.json({
            session: await enrichSessionRow(session),
            client: {
                displayName: session.contactName || user?.name || null,
                phone,
                email: user?.email || null,
                userId: user?.id || null,
                role: user?.role || null,
                registeredAt: user?.createdAt || null,
                bookingDraft: sessionData,
            },
            reservations: reservations.map((r) => ({
                id: r.id,
                date: r.date,
                status: r.status,
                frequency: r.frequency,
                userName: r.userName,
                startTime: r.slot?.startTime,
                endTime: r.slot?.endTime,
            })),
            assignments,
            metrics: {
                messageCount: messages.length,
                avgResponseMs: responseCount ? Math.round(responseSumMs / responseCount) : null,
                avgResponseSeconds: responseCount ? Math.round(responseSumMs / responseCount / 1000) : null,
                hasReservation: reservations.length > 0,
                conversion: reservations.length > 0 ? 'con_reserva' : 'sin_reserva',
                conversionLabel: reservations.length > 0 ? 'Con reserva' : 'Sin reserva',
            },
        });
    } catch (e) {
        console.error(e);
        res.status(500).json({ error: 'Error al cargar ficha del contacto.' });
    }
});

router.post('/sessions/:phone/clear', requirePermission(PRIV.WHATSAPP_OPERATE), async (req, res) => {
    try {
        const phone = normalizePhone(req.params.phone);
        if (!phone) return res.status(400).json({ error: 'Teléfono inválido.' });
        const session = await prisma.whatsAppSession.update({
            where: { phone },
            data: {
                step: 'menu',
                mode: 'rules',
                handoffActive: false,
                assignedOperatorId: null,
                handoffReason: null,
                data: '{}',
            },
        });
        broadcastWhatsAppEvent('session:cleared', { phone });
        await writeAudit({
            action: 'whatsapp.session.clear',
            entity: 'whatsapp_session',
            entityId: session.id,
            userId: req.user.id,
            meta: { phone },
            req,
        });
        res.json({ message: 'Sesión reiniciada al menú.', session: await enrichSessionRow(session) });
    } catch (e) {
        console.error(e);
        res.status(500).json({ error: 'Error al limpiar sesión.' });
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
        res.json({ message: 'Handoff activado.', session: await enrichSessionRow(session) });
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
        res.json({ message: 'Conversación devuelta al bot.', session: await enrichSessionRow(session) });
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
