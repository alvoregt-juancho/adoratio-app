const prisma = require('../db');
const config = require('../config');
const { sendButtons } = require('./whatsapp');
const { sendReminderTemplate } = require('./whatsappTemplates');
const { formatTimeRange12 } = require('./timeFormat');
const { getUpcomingOccurrenceDates, hoursUntilOccurrence } = require('./whatsappOccurrences');

const REMINDER_WINDOWS = {
    '24h': { min: 23.5, max: 24.5 },
    '3h': { min: 2.5, max: 3.5 },
};

function buildReminderMessage(reservation, occurrenceDate, type) {
    const slot = reservation.slot;
    const slotLabel = formatTimeRange12(slot.startTime, slot.endTime, '–');
    const chapel = config.whatsapp.chapelName;

    if (type === '24h') {
        return (
            `🙏 *Recordatorio AdoraHora*\n\n` +
            `Hola ${reservation.userFirstName || reservation.userName}, mañana tienes tu guardia de adoración:\n\n` +
            `📅 *${occurrenceDate}*\n` +
            `⏰ *${slotLabel}*\n` +
            `📍 ${chapel}\n\n` +
            `¿Podrás asistir?`
        );
    }
    return (
        `⏰ *Tu guardia es en 3 horas*\n\n` +
        `${reservation.userFirstName || reservation.userName}, tu turno de adoración es hoy:\n\n` +
        `📅 *${occurrenceDate}* · *${slotLabel}*\n` +
        `📍 ${chapel}\n\n` +
        `¿Confirmas tu asistencia?`
    );
}

async function deliverReminder(reservation, occurrenceDate, reminderType) {
    const slotLabel = formatTimeRange12(
        reservation.slot.startTime,
        reservation.slot.endTime,
        '–'
    );
    const name = reservation.userFirstName || reservation.userName || 'Adorador';
    const chapel = config.whatsapp.chapelName;

    if (config.whatsappTemplatesEnabled) {
        await sendReminderTemplate(reservation.userPhone, reminderType, {
            name,
            date: occurrenceDate,
            time: slotLabel,
            chapel,
        });
        return;
    }

    const body = buildReminderMessage(reservation, occurrenceDate, reminderType);
    const btnId = `absence_${reservation.id}_${occurrenceDate}`;
    await sendButtons(reservation.userPhone, body, [
        { id: `confirm_${reservation.id}_${occurrenceDate}`, title: 'Sí, asistiré' },
        { id: btnId, title: 'No podré asistir' },
    ]);
}

async function sendReminderIfDue(reservation, occurrenceDate, reminderType) {
    const hours = hoursUntilOccurrence(
        occurrenceDate,
        reservation.slot.startTime,
        reservation.startTimeOffset
    );
    const window = REMINDER_WINDOWS[reminderType];
    if (hours < window.min || hours > window.max) return false;

    const existing = await prisma.whatsAppReminderLog.findUnique({
        where: {
            reservationId_occurrenceDate_reminderType: {
                reservationId: reservation.id,
                occurrenceDate,
                reminderType,
            },
        },
    });
    if (existing) return false;

    await deliverReminder(reservation, occurrenceDate, reminderType);

    await prisma.whatsAppReminderLog.create({
        data: {
            reservationId: reservation.id,
            occurrenceDate,
            reminderType,
            phone: reservation.userPhone,
        },
    });

    return true;
}

async function processWhatsAppReminders() {
    if (!config.whatsapp.enabled) return { sent: 0, skipped: true };

    if (config.whatsappEnabled && !config.whatsappTemplatesEnabled) {
        console.warn(
            '[WhatsApp] Producción sin plantillas: configura WHATSAPP_TEMPLATE_REMINDER_24H y WHATSAPP_TEMPLATE_REMINDER_3H. ' +
                'Usando mensajes interactivos (solo válidos dentro de ventana de 24 h).'
        );
    }

    const reservations = await prisma.reservation.findMany({
        where: { status: 'confirmed' },
        include: { slot: true },
    });

    let sent = 0;
    for (const reservation of reservations) {
        const dates = getUpcomingOccurrenceDates(reservation, 2);
        for (const dateStr of dates) {
            for (const type of ['24h', '3h']) {
                try {
                    const didSend = await sendReminderIfDue(reservation, dateStr, type);
                    if (didSend) sent++;
                } catch (e) {
                    console.error(`[WhatsApp reminder] res=${reservation.id} date=${dateStr}`, e.message);
                }
            }
        }
    }
    return { sent, templatesEnabled: config.whatsappTemplatesEnabled };
}

module.exports = { processWhatsAppReminders, buildReminderMessage, deliverReminder };
