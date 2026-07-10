const prisma = require('../db');
const {
    findCaptainUsersForOccurrence,
    createCaptainNotification,
} = require('./captainScope');
const { formatTimeRange12 } = require('./timeFormat');
const { sendText } = require('./whatsapp');
const { sendCaptainEmergencyTemplate } = require('./whatsappTemplates');
const config = require('../config');

/**
 * Notifica al capitán que un adorador no podrá asistir a UNA ocurrencia
 * (sin cancelar el compromiso completo).
 */
async function notifyCaptainOccurrenceAbsence(reservation, occurrenceDate) {
    if (!reservation?.slot) {
        reservation = await prisma.reservation.findUnique({
            where: { id: reservation.id || reservation },
            include: { slot: true },
        });
    }
    if (!reservation?.slot) return;

    const slotLabel = formatTimeRange12(reservation.slot.startTime, reservation.slot.endTime, '–');
    const name = reservation.userName || 'Un adorador';

    const captains = await findCaptainUsersForOccurrence(occurrenceDate, reservation.slot.startTime);

    for (const { user, ranges } of captains) {
        const existing = await prisma.substitutionRequest.findFirst({
            where: {
                reservationId: reservation.id,
                occurrenceDate,
                captainUserId: user.id,
                status: 'pending',
            },
        });
        if (!existing) {
            await prisma.substitutionRequest.create({
                data: {
                    reservationId: reservation.id,
                    occurrenceDate,
                    requestedByName: name,
                    captainUserId: user.id,
                    status: 'pending',
                    notes: 'Reportado vía WhatsApp — buscar adorador de emergencia.',
                },
            });
        }

        await createCaptainNotification({
            captainUserId: user.id,
            captainRangeId: ranges[0]?.id ?? null,
            type: 'substitute_needed',
            title: 'Emergencia — adorador no asistirá',
            message: `${name} avisó que NO podrá asistir el ${occurrenceDate} a las ${slotLabel}. Revisa tu calendario y busca sustituto.`,
            slotId: reservation.slotId,
            reservationId: reservation.id,
            occurrenceDate,
            isUrgent: true,
        });

        if (user.phoneNumber) {
            const captainMsg =
                `🚨 *Emergencia AdoraHora*\n\n` +
                `${name} no podrá asistir el *${occurrenceDate}* (${slotLabel}).\n\n` +
                `Revisa el panel de capitán para buscar un adorador de emergencia.`;
            try {
                if (config.whatsappTemplatesEnabled && config.whatsapp.templates.captainEmergency) {
                    await sendCaptainEmergencyTemplate(user.phoneNumber, {
                        captainName: user.name,
                        adorerName: name,
                        date: occurrenceDate,
                        time: slotLabel,
                    });
                } else {
                    await sendText(user.phoneNumber, captainMsg);
                }
            } catch (e) {
                console.error('[WhatsApp capitán]', e.message);
            }
        }
    }

    await prisma.auditLog.create({
        data: {
            action: 'whatsapp.absence_reported',
            entity: 'reservation',
            entityId: reservation.id,
            reservationId: reservation.id,
            meta: JSON.stringify({ occurrenceDate, via: 'whatsapp' }),
        },
    });
}

module.exports = { notifyCaptainOccurrenceAbsence };
