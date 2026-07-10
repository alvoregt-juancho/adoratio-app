const config = require('../config');
const { formatPhoneForWa, callWhatsAppApi } = require('./whatsapp');

function bodyParams(values) {
    return values.map((text) => ({
        type: 'text',
        text: String(text || '').slice(0, 1024),
    }));
}

async function sendTemplate(toPhone8, templateName, bodyValues = []) {
    if (!templateName) {
        throw new Error('Plantilla de WhatsApp no configurada.');
    }

    const payload = {
        to: formatPhoneForWa(toPhone8),
        type: 'template',
        template: {
            name: templateName,
            language: { code: config.whatsapp.templates.language },
            components: [
                {
                    type: 'body',
                    parameters: bodyParams(bodyValues),
                },
            ],
        },
    };

    return callWhatsAppApi(payload);
}

async function sendReminderTemplate(toPhone8, reminderType, { name, date, time, chapel }) {
    const templateName =
        reminderType === '24h'
            ? config.whatsapp.templates.reminder24h
            : config.whatsapp.templates.reminder3h;
    return sendTemplate(toPhone8, templateName, [name, date, time, chapel]);
}

async function sendCaptainEmergencyTemplate(toPhone8, { captainName, adorerName, date, time }) {
    return sendTemplate(toPhone8, config.whatsapp.templates.captainEmergency, [
        captainName,
        adorerName,
        date,
        time,
    ]);
}

async function sendBookingConfirmedTemplate(toPhone8, { name, date, time }) {
    const templateName = config.whatsapp.templates.bookingConfirmed;
    if (!templateName) return null;
    return sendTemplate(toPhone8, templateName, [name, date, time]);
}

module.exports = {
    sendTemplate,
    sendReminderTemplate,
    sendCaptainEmergencyTemplate,
    sendBookingConfirmedTemplate,
};
