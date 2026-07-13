const { EventEmitter } = require('events');

const hub = new EventEmitter();
hub.setMaxListeners(50);

const sseClients = new Set();

function broadcastWhatsAppEvent(type, data = {}) {
    const payload = { type, data, at: Date.now() };
    hub.emit(type, payload);
    const line = `data: ${JSON.stringify(payload)}\n\n`;
    for (const client of sseClients) {
        try {
            client.write(line);
        } catch {
            sseClients.delete(client);
        }
    }
}

function subscribeWhatsAppSse(res) {
    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Connection', 'keep-alive');
    res.flushHeaders?.();
    res.write(': connected\n\n');
    sseClients.add(res);
    res.on('close', () => sseClients.delete(res));
}

function getSseClientCount() {
    return sseClients.size;
}

module.exports = { broadcastWhatsAppEvent, subscribeWhatsAppSse, getSseClientCount, hub };
