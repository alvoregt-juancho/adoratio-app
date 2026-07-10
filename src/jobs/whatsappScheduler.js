const config = require('../config');
const { processWhatsAppReminders } = require('../utils/whatsappReminders');

let intervalId = null;

function startWhatsAppScheduler() {
    if (!config.whatsapp.enabled) {
        console.log('ℹ WhatsApp deshabilitado (WHATSAPP_ENABLED=false).');
        return;
    }

    const run = async () => {
        try {
            const result = await processWhatsAppReminders();
            if (result.sent > 0) {
                console.log(`[WhatsApp] Recordatorios enviados: ${result.sent}`);
            }
        } catch (e) {
            console.error('[WhatsApp scheduler]', e);
        }
    };

    run();
    intervalId = setInterval(run, config.whatsapp.reminderIntervalMs);
    console.log(
        `ℹ WhatsApp scheduler activo (cada ${config.whatsapp.reminderIntervalMs / 1000}s). ` +
            (config.whatsappEnabled ? 'API conectada.' : 'Modo simulación (faltan credenciales).')
    );
}

function stopWhatsAppScheduler() {
    if (intervalId) {
        clearInterval(intervalId);
        intervalId = null;
    }
}

module.exports = { startWhatsAppScheduler, stopWhatsAppScheduler };
