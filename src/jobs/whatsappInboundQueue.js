const { processInboundWhatsApp } = require('../utils/whatsappInboundProcessor');

const queue = [];
let processing = false;

function enqueueInbound(payload) {
    queue.push(payload);
    drain().catch((e) => console.error('[WhatsApp queue]', e));
}

async function drain() {
    if (processing) return;
    processing = true;
    while (queue.length) {
        const job = queue.shift();
        try {
            await processInboundWhatsApp(job);
        } catch (e) {
            console.error('[WhatsApp queue job]', e);
        }
    }
    processing = false;
}

module.exports = { enqueueInbound };
