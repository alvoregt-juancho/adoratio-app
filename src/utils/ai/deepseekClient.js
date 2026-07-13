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

module.exports = { chatCompletion, chatCompletionOnce, isDeepSeekConfigured };
