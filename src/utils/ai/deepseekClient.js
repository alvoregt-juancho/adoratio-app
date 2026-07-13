async function chatCompletionOnce({ apiKey, baseUrl, model, messages, tools }) {
    const url = `${String(baseUrl || 'https://api.deepseek.com').replace(/\/$/, '')}/v1/chat/completions`;
    const body = {
        model: model || 'deepseek-chat',
        messages,
        temperature: 0.4,
    };
    if (tools?.length) body.tools = tools;

    const res = await fetch(url, {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${apiKey}`,
        },
        body: JSON.stringify(body),
    });

    if (!res.ok) {
        const errText = await res.text();
        throw new Error(`DeepSeek API ${res.status}: ${errText.slice(0, 300)}`);
    }

    const data = await res.json();
    return data.choices?.[0]?.message || null;
}

async function chatCompletion(opts) {
    const message = await chatCompletionOnce(opts);
    return {
        content: message?.content || '',
        toolResults: (message?.tool_calls || []).map((call) => ({
            id: call.id,
            name: call.function?.name,
            arguments: call.function?.arguments,
        })),
        message,
    };
}

function isDeepSeekConfigured(botCfg) {
    return Boolean(botCfg?.aiEnabled && botCfg?.deepseekApiKey);
}

async function testDeepSeekConnection({ apiKey, baseUrl, model } = {}) {
    if (!apiKey) throw new Error('API key requerida.');
    const message = await chatCompletionOnce({
        apiKey,
        baseUrl: baseUrl || 'https://api.deepseek.com',
        model: model || 'deepseek-chat',
        messages: [{ role: 'user', content: 'Responde únicamente con la palabra OK.' }],
    });
    const reply = String(message?.content || '').trim();
    if (!reply) throw new Error('DeepSeek no devolvió respuesta.');
    return { ok: true, reply: reply.slice(0, 120), model: model || 'deepseek-chat' };
}

module.exports = { chatCompletion, chatCompletionOnce, isDeepSeekConfigured, testDeepSeekConnection };
