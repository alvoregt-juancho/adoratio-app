const prisma = require('../db');
const config = require('../config');

const DEFAULT_WHATSAPP_BOT_CONFIG = {
    enabled: true,
    botName: 'AdoraHora',
    assistantTitle: 'Asistente de Adoración',
    language: 'es',
    locale: 'es-GT',
    tone: 'pastoral',
    formality: 'usted',
    useEmojis: true,
    welcomeTitle: null,
    welcomeBody: null,
    menuHelpLabel: 'Cómo funciona',
    personalityInstructions:
        'Eres un asistente católico de la Capilla Cristo Rey. Hablas con respeto, calidez y sencillez. ' +
        'Tu misión es ayudar a reservar guardias de adoración eucarística, recordar horarios y orientar con paciencia. ' +
        'No das consejos médicos, legales ni políticos. Ante dudas doctrinales profundas, invita a hablar con el coordinador o el párroco.',
    chapelDescription: null,
    adorationHours: '7:00 AM – 8:00 PM todos los días',
    fallbackMessage: null,
    goodbyeMessage: 'Que el Señor te bendiga. Escribe *menu* cuando quieras volver. 🙏',
    escalationMessage:
        'Para consultas personales o urgentes de custodia, comunícate con la coordinación de adoración.',
    customFaqJson: '[]',
    prohibitedTopics:
        'Política partidista, contenido sexual, insultos, consejos médicos o legales, ventas comerciales.',
    responseMaxChars: 900,
    aiEnabled: false,
    aiProvider: 'deepseek',
    aiModel: 'deepseek-chat',
    aiBaseUrl: 'https://api.deepseek.com',
    deepseekApiKey: null,
    aiMaxIterations: 6,
    aiHistoryLimit: 30,
    handoffRulesJson: null,
    enabledToolsJson: null,
    inviteToWebUrl: null,
};

let cachedConfig = null;
let cacheAt = 0;
const CACHE_MS = 30_000;

function parseCustomFaq(raw) {
    if (!raw) return [];
    try {
        const parsed = JSON.parse(raw);
        if (!Array.isArray(parsed)) return [];
        return parsed
            .filter((item) => item && (item.answer || item.response))
            .map((item) => ({
                keys: Array.isArray(item.keywords)
                    ? item.keywords
                    : Array.isArray(item.keys)
                      ? item.keys
                      : String(item.keywords || item.keys || '')
                            .split(',')
                            .map((k) => k.trim())
                            .filter(Boolean),
                answer: String(item.answer || item.response || '').trim(),
            }))
            .filter((item) => item.keys.length && item.answer);
    } catch {
        return [];
    }
}

function maskApiKey(key) {
    if (!key) return null;
    const str = String(key);
    if (str.length <= 8) return '••••••••';
    return `${str.slice(0, 4)}…${str.slice(-4)}`;
}

function serializeBotConfig(row, { includeSecrets = false } = {}) {
    if (!row) return { ...DEFAULT_WHATSAPP_BOT_CONFIG, customFaq: [], deepseekApiKeySet: false };
    const base = {
        enabled: row.enabled,
        botName: row.botName,
        assistantTitle: row.assistantTitle,
        language: row.language,
        locale: row.locale,
        tone: row.tone,
        formality: row.formality,
        useEmojis: row.useEmojis,
        welcomeTitle: row.welcomeTitle,
        welcomeBody: row.welcomeBody,
        menuHelpLabel: row.menuHelpLabel,
        personalityInstructions: row.personalityInstructions,
        chapelDescription: row.chapelDescription,
        adorationHours: row.adorationHours,
        fallbackMessage: row.fallbackMessage,
        goodbyeMessage: row.goodbyeMessage,
        escalationMessage: row.escalationMessage,
        customFaqJson: row.customFaqJson || '[]',
        customFaq: parseCustomFaq(row.customFaqJson),
        prohibitedTopics: row.prohibitedTopics,
        responseMaxChars: row.responseMaxChars,
        aiEnabled: row.aiEnabled === true,
        aiProvider: row.aiProvider || 'deepseek',
        aiModel: row.aiModel || 'deepseek-chat',
        aiBaseUrl: row.aiBaseUrl || 'https://api.deepseek.com',
        aiMaxIterations: row.aiMaxIterations ?? 6,
        aiHistoryLimit: row.aiHistoryLimit ?? 30,
        handoffRulesJson: row.handoffRulesJson || null,
        enabledToolsJson: row.enabledToolsJson || null,
        inviteToWebUrl: row.inviteToWebUrl || null,
        deepseekApiKeySet: Boolean(row.deepseekApiKey),
        deepseekApiKeyMasked: maskApiKey(row.deepseekApiKey),
        updatedAt: row.updatedAt,
    };
    if (includeSecrets) {
        base.deepseekApiKey = row.deepseekApiKey || null;
    }
    return base;
}

async function getWhatsAppBotConfig({ fresh = false } = {}) {
    const now = Date.now();
    if (!fresh && cachedConfig && now - cacheAt < CACHE_MS) {
        return cachedConfig;
    }

    let row = await prisma.whatsAppBotConfig.findUnique({ where: { id: 1 } });
    if (!row) {
        row = await prisma.whatsAppBotConfig.create({
            data: {
                id: 1,
                ...DEFAULT_WHATSAPP_BOT_CONFIG,
                chapelDescription: config.whatsapp.chapelName,
            },
        });
    }

    cachedConfig = serializeBotConfig(row, { includeSecrets: true });
    cacheAt = now;
    return cachedConfig;
}

function invalidateWhatsAppBotConfigCache() {
    cachedConfig = null;
    cacheAt = 0;
}

function truncateBotText(text, maxChars) {
    const limit = Math.max(200, Number(maxChars) || 900);
    const str = String(text || '');
    if (str.length <= limit) return str;
    return str.slice(0, limit - 1) + '…';
}

function tonePrefix(botCfg) {
    if (!botCfg.useEmojis) return '';
    const map = {
        pastoral: '🙏 ',
        formal: '',
        cercano: '✨ ',
        sereno: '🕊️ ',
    };
    return map[botCfg.tone] || '🙏 ';
}

function addressUser(botCfg) {
    return botCfg.formality === 'tu' ? 'usted' : 'usted';
}

module.exports = {
    DEFAULT_WHATSAPP_BOT_CONFIG,
    getWhatsAppBotConfig,
    invalidateWhatsAppBotConfigCache,
    parseCustomFaq,
    serializeBotConfig,
    truncateBotText,
    tonePrefix,
    addressUser,
};
