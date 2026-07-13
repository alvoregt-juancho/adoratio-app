const config = require('../config');
const { formatPhoneForWa, callWhatsAppApi } = require('./whatsapp');

const TEMPLATE_PARAM_NAMES = {
    reminder: ['nombre', 'fecha', 'horario', 'lugar'],
    captain: ['capitan', 'adorador', 'fecha', 'horario'],
    booking: ['nombre', 'fecha', 'horario'],
};

function bodyParams(values, paramNames) {
    return values.map((text, i) => {
        const param = {
            type: 'text',
            text: String(text || '').slice(0, 1024),
        };
        if (paramNames?.[i]) {
            param.parameter_name = paramNames[i];
        }
        return param;
    });
}

async function sendTemplate(toPhone8, templateName, bodyValues = [], paramNames = null) {
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
                    parameters: bodyParams(bodyValues, paramNames),
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
    return sendTemplate(toPhone8, templateName, [name, date, time, chapel], TEMPLATE_PARAM_NAMES.reminder);
}

async function sendCaptainEmergencyTemplate(toPhone8, { captainName, adorerName, date, time }) {
    return sendTemplate(
        toPhone8,
        config.whatsapp.templates.captainEmergency,
        [captainName, adorerName, date, time],
        TEMPLATE_PARAM_NAMES.captain
    );
}

async function sendBookingConfirmedTemplate(toPhone8, { name, date, time }) {
    const templateName = config.whatsapp.templates.bookingConfirmed;
    if (!templateName) return null;
    return sendTemplate(toPhone8, templateName, [name, date, time], TEMPLATE_PARAM_NAMES.booking);
}

module.exports = {
    sendTemplate,
    sendReminderTemplate,
    sendCaptainEmergencyTemplate,
    sendBookingConfirmedTemplate,
};
