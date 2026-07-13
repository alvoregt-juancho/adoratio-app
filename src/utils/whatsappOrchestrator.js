const { sendText } = require('./whatsapp');
const { appendChatMessage, getRecentChatHistory } = require('./chatMessages');
const { getOrCreateSession, updateSessionState } = require('./chatSession');
const {
    getWhatsAppBotConfig,
    truncateBotText,
    tonePrefix,
} = require('./whatsappBotConfig');
const {
    parseEnabledTools,
    parseHandoffKeywords,
    detectToolIntent,
    executeTool,
    getToolDefinitionsForLlm,
} = require('./whatsappTools');
const { chatCompletion, isDeepSeekConfigured } = require('./ai/deepseekClient');
const { broadcastWhatsAppEvent } = require('../ws/adminWhatsAppHub');

async function sendAssistantReply(phone, text, { toolName = null, operatorId = null } = {}) {
    const botCfg = await getWhatsAppBotConfig();
    const prefix = operatorId ? '' : tonePrefix(botCfg);
    const body = truncateBotText(`${prefix}${text}`, botCfg.responseMaxChars);
    await sendText(phone, body);
    await appendChatMessage({
        phone,
        role: operatorId ? 'operator' : 'assistant',
        direction: 'outbound',
        body,
        toolName,
        operatorId,
    });
    broadcastWhatsAppEvent('message:outbound', { phone, body });
}

async function runDeepSeekPath(phone, text) {
    const botCfg = await getWhatsAppBotConfig({ fresh: true });
    if (!isDeepSeekConfigured(botCfg)) return false;

    const history = await getRecentChatHistory(phone, botCfg.aiHistoryLimit || 30);
    const messages = [
        {
            role: 'system',
            content:
                `${botCfg.personalityInstructions || ''}\n\n` +
                `Capilla: ${botCfg.chapelDescription || ''}\n` +
                `Horario: ${botCfg.adorationHours || ''}\n` +
                `Evita: ${botCfg.prohibitedTopics || ''}\n` +
                `Responde en español de Guatemala, tono ${botCfg.tone}, tratamiento ${botCfg.formality}.`,
        },
        ...history
            .reverse()
            .filter((m) => ['user', 'assistant', 'operator'].includes(m.role))
            .map((m) => ({
                role: m.role === 'operator' ? 'assistant' : m.role,
                content: m.body,
            })),
        { role: 'user', content: text },
    ];

    const tools = getToolDefinitionsForLlm();
    const maxIterations = botCfg.aiMaxIterations || 6;
    let iterations = 0;

    while (iterations < maxIterations) {
        iterations += 1;
        const llm = await chatCompletion({
            apiKey: botCfg.deepseekApiKey,
            baseUrl: botCfg.aiBaseUrl,
            model: botCfg.aiModel,
            messages,
            tools,
        });

        const assistantMsg = llm.message;
        if (!assistantMsg) break;

        if (!assistantMsg.tool_calls?.length) {
            if (llm.content) {
                await sendAssistantReply(phone, llm.content);
            }
            return Boolean(llm.content);
        }

        messages.push(assistantMsg);

        for (const call of assistantMsg.tool_calls) {
            let args = {};
            try {
                args = call.function?.arguments ? JSON.parse(call.function.arguments) : {};
            } catch {
                args = {};
            }
            const toolName = call.function?.name;
            const result = await executeTool(toolName, phone, args);
            const resultText = result || 'Listo.';

            await appendChatMessage({
                phone,
                role: 'tool',
                direction: 'internal',
                body: resultText,
                toolName,
            });

            if (toolName === 'escalate_to_human') {
                broadcastWhatsAppEvent('handoff:started', { phone, reason: args.reason });
                await sendAssistantReply(phone, resultText, { toolName });
                return true;
            }

            messages.push({
                role: 'tool',
                tool_call_id: call.id,
                content: resultText,
            });
        }
    }

    return false;
}

async function runToolIntentPath(phone, text, buttonId) {
    const botCfg = await getWhatsAppBotConfig();
    const enabled = parseEnabledTools(botCfg.enabledToolsJson);
    const handoffKeywords = parseHandoffKeywords(botCfg.handoffRulesJson);
    const intent = detectToolIntent(text, buttonId, enabled, handoffKeywords);
    if (!intent) return false;

    const result = await executeTool(intent.tool, phone, intent.args);
    if (!result) return false;

    if (intent.tool === 'escalate_to_human') {
        broadcastWhatsAppEvent('handoff:started', { phone, reason: intent.args?.reason });
    }

    await sendAssistantReply(phone, result, { toolName: intent.tool });
    return true;
}

/**
 * Orquestador principal. Retorna true si manejó el mensaje (IA o tools).
 * Si retorna false, el bot por reglas continúa el flujo habitual.
 */
async function runOrchestrator(phone, text, buttonId = null) {
    const session = await getOrCreateSession(phone);
    if (session.handoffActive) return true;

    const botCfg = await getWhatsAppBotConfig();

    if (isDeepSeekConfigured(botCfg) && (session.mode === 'ai' || botCfg.aiEnabled)) {
        try {
            if (session.mode !== 'ai') {
                await updateSessionState(phone, { mode: 'ai' });
            }
            const handled = await runDeepSeekPath(phone, text);
            if (handled) return true;
        } catch (e) {
            console.error('[WhatsApp orchestrator AI]', e.message);
            await appendChatMessage({
                phone,
                role: 'system',
                direction: 'internal',
                body: `AI error: ${e.message}`,
            });
        }
    }

    return runToolIntentPath(phone, text, buttonId);
}

module.exports = { runOrchestrator, sendAssistantReply };
