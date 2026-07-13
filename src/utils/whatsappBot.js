const prisma = require('../db');
const config = require('../config');
const { sendText, sendButtons, parseWaPhone } = require('./whatsapp');
const { normalizePhone, isValidPhone } = require('./phone');
const { todayStr } = require('./dates');
const { filterSlotsForDate } = require('./schedule');
const { COMMITMENT_FREQUENCY } = require('../constants/commitment');
const { commitmentEndDateFromMonths } = require('./commitmentMatch');
const { formatTimeRange12 } = require('./timeFormat');
const { getUpcomingOccurrenceDates, hoursUntilOccurrence } = require('./whatsappOccurrences');
const { notifyCaptainOccurrenceAbsence } = require('./whatsappAbsence');
const { sendBookingConfirmedTemplate } = require('./whatsappTemplates');
const {
    getWhatsAppBotConfig,
    truncateBotText,
    tonePrefix,
} = require('./whatsappBotConfig');

const TEMPLATE_CONFIRM_TEXTS = ['sí, asistiré', 'si, asistire', 'si asistire', 'sí asistiré'];
const TEMPLATE_ABSENCE_TEXTS = ['no podré asistir', 'no podre asistir', 'no podré', 'no podre'];

const FAQ = [
    {
        keys: ['como funciona', 'cómo funciona', 'que es', 'qué es', 'ayuda', 'help'],
        answer:
            `*¿Cómo funciona AdoraHora?*\n\n` +
            `1️⃣ Reservas un turno de adoración al Santísimo (por web o aquí en WhatsApp)\n` +
            `2️⃣ Te recordamos 24 h y 3 h antes de tu guardia\n` +
            `3️⃣ Si no puedes asistir, avísanos y el capitán busca un sustituto\n` +
            `4️⃣ Al llegar a la capilla, escaneas el código QR para registrar tu asistencia\n\n` +
            `Horario de adoración: 7:00 AM – 8:00 PM todos los días.\n` +
            `Web: ${config.baseUrl}`,
    },
    {
        keys: ['horario', 'horarios', 'cuando', 'cuándo'],
        answer:
            `*Horarios de adoración*\n\n` +
            `La adoración al Santísimo es de *7:00 AM a 8:00 PM* todos los días.\n` +
            `Algunas horas están bloqueadas por misa (domingos y entre semana).\n\n` +
            `Escribe *reservar* para ver cupos disponibles.`,
    },
    {
        keys: ['capilla', 'donde', 'dónde', 'ubicacion', 'ubicación'],
        answer: `📍 *${config.whatsapp.chapelName}*\n\nPuedes reservar tu turno escribiendo *reservar*.`,
    },
    {
        keys: ['cancelar', 'cancelación'],
        answer:
            `Para cancelar tu compromiso completo, visita:\n${config.baseUrl}/?tab=mas&manage=shifts\n\n` +
            `Si solo no puedes asistir a *una* guardia, escribe *no podré* o usa el botón en el recordatorio.`,
    },
];

function parseSessionData(raw) {
    try {
        return raw ? JSON.parse(raw) : {};
    } catch {
        return {};
    }
}

async function getSession(phone) {
    let session = await prisma.whatsAppSession.findUnique({ where: { phone } });
    if (!session) {
        session = await prisma.whatsAppSession.create({
            data: { phone, step: 'menu', data: '{}' },
        });
    }
    return session;
}

async function updateSession(phone, step, data = {}) {
    return prisma.whatsAppSession.update({
        where: { phone },
        data: { step, data: JSON.stringify(data) },
    });
}

async function sendMainMenu(phone) {
    const botCfg = await getWhatsAppBotConfig();
    if (!botCfg.enabled) {
        await sendText(
            phone,
            truncateBotText(
                botCfg.escalationMessage ||
                    'El asistente de WhatsApp está en pausa. Contacta a la coordinación de adoración.',
                botCfg.responseMaxChars
            )
        );
        return;
    }

    const prefix = tonePrefix(botCfg);
    const title = botCfg.welcomeTitle || `Bienvenido a ${botCfg.botName}`;
    const chapel = botCfg.chapelDescription || config.whatsapp.chapelName;
    const intro = botCfg.welcomeBody
        ? botCfg.welcomeBody
        : `${chapel}\n\n${botCfg.assistantTitle}`;

    await sendButtons(
        phone,
        truncateBotText(
            `${prefix}*${title}*\n${intro}\n\n¿En qué ${botCfg.formality === 'tu' ? 'te' : 'le'} podemos ayudar?`,
            botCfg.responseMaxChars
        ),
        [
            { id: 'menu_reservar', title: 'Reservar turno' },
            { id: 'menu_mis_turnos', title: 'Mis turnos' },
            { id: 'menu_ayuda', title: botCfg.menuHelpLabel.slice(0, 20) },
        ]
    );
    await updateSession(phone, 'menu', {});
}

async function matchFaq(text) {
    const botCfg = await getWhatsAppBotConfig();
    const lower = text.toLowerCase().trim();
    const allFaq = [...FAQ, ...botCfg.customFaq];
    for (const item of allFaq) {
        if (item.keys.some((k) => lower.includes(k))) {
            return truncateBotText(item.answer, botCfg.responseMaxChars);
        }
    }
    return null;
}

async function getAvailableSlotOptions(daysAhead = 3) {
    const options = [];
    const start = new Date(`${todayStr()}T12:00:00`);

    for (let i = 0; i < daysAhead; i++) {
        const d = new Date(start);
        d.setDate(start.getDate() + i);
        const dateStr = d.toISOString().slice(0, 10);

        const allSlots = await prisma.slot.findMany({
            where: { isActive: true },
            orderBy: { startTime: 'asc' },
        });
        const { slots: eligible } = filterSlotsForDate(allSlots, dateStr);

        const reservations = await prisma.reservation.groupBy({
            by: ['slotId'],
            where: { date: dateStr, status: { in: ['confirmed', 'completed'] } },
            _count: { _all: true },
        });
        const countBySlot = Object.fromEntries(
            reservations.map((r) => [r.slotId, r._count._all])
        );

        for (const slot of eligible) {
            const taken = countBySlot[slot.id] || 0;
            const available = Math.max(0, slot.capacity - taken);
            if (available > 0) {
                options.push({
                    dateStr,
                    slot,
                    available,
                    label: `${dateStr} · ${formatTimeRange12(slot.startTime, slot.endTime)} (${available} cupo${available === 1 ? '' : 's'})`,
                });
            }
        }
    }
    return options;
}

async function handleAbsenceButton(phone, reservationId, occurrenceDate) {
    const reservation = await prisma.reservation.findFirst({
        where: { id: reservationId, userPhone: phone, status: 'confirmed' },
        include: { slot: true },
    });
    if (!reservation) {
        await sendText(phone, 'No encontramos esa guardia activa. Escribe *menu* para volver al inicio.');
        return;
    }

    await notifyCaptainOccurrenceAbsence(reservation, occurrenceDate);
    await sendText(
        phone,
        `Gracias por avisar. El capitán fue notificado para buscar un adorador de emergencia el *${occurrenceDate}*.\n\nTu compromiso sigue activo para las próximas fechas. 🙏`
    );
    await updateSession(phone, 'menu', {});
}

async function handleConfirmButton(phone, reservationId, occurrenceDate) {
    await sendText(
        phone,
        `¡Perfecto! Te esperamos el *${occurrenceDate}*. Que Dios te bendiga. 🙏\n\nEscribe *menu* cuando necesites algo más.`
    );
    await updateSession(phone, 'menu', {});
}

async function listMyShifts(phone) {
    const reservations = await prisma.reservation.findMany({
        where: { userPhone: phone, status: { in: ['confirmed', 'completed'] } },
        include: { slot: true },
        orderBy: { date: 'asc' },
    });

    if (!reservations.length) {
        await sendText(phone, 'No tienes turnos registrados. Escribe *reservar* para agendar uno.');
        return;
    }

    const lines = reservations.map((r) => {
        const slotLabel = formatTimeRange12(r.slot.startTime, r.slot.endTime);
        const nextDates = getUpcomingOccurrenceDates(r, 14).slice(0, 3);
        const next = nextDates.length ? `\n   Próximas: ${nextDates.join(', ')}` : '';
        return `• *${r.userName}* — ${slotLabel} (${r.frequency})${next}`;
    });

    await sendText(
        phone,
        `📋 *Tus turnos de adoración*\n\n${lines.join('\n\n')}\n\nPara reservar otro turno: *reservar*\nSi no puedes asistir a la próxima guardia: *no podré*`
    );
}

async function reportAbsenceFromLatestReminder(phone) {
    const log = await prisma.whatsAppReminderLog.findFirst({
        where: { phone },
        orderBy: { sentAt: 'desc' },
    });
    if (log) {
        const hoursSince =
            (Date.now() - new Date(log.sentAt).getTime()) / (1000 * 60 * 60);
        if (hoursSince <= 48) {
            await handleAbsenceButton(phone, log.reservationId, log.occurrenceDate);
            return;
        }
    }
    await reportNextAbsence(phone);
}

function isTemplateConfirmReply(text) {
    if (isTemplateAbsenceReply(text)) return false;
    const lower = String(text || '').toLowerCase().trim();
    return TEMPLATE_CONFIRM_TEXTS.some((t) => lower === t);
}

function isTemplateAbsenceReply(text) {
    const lower = String(text || '').toLowerCase().trim();
    return TEMPLATE_ABSENCE_TEXTS.some((t) => lower.includes(t) || lower.includes('no podr'));
}

async function reportNextAbsence(phone) {
    const reservations = await prisma.reservation.findMany({
        where: { userPhone: phone, status: 'confirmed' },
        include: { slot: true },
    });

    let nearest = null;
    let nearestHours = Infinity;

    for (const r of reservations) {
        for (const dateStr of getUpcomingOccurrenceDates(r, 14)) {
            const h = hoursUntilOccurrence(dateStr, r.slot.startTime, r.startTimeOffset);
            if (h > 0 && h < nearestHours) {
                nearestHours = h;
                nearest = { reservation: r, dateStr };
            }
        }
    }

    if (!nearest) {
        await sendText(phone, 'No encontramos una guardia próxima. Escribe *mis turnos* para revisar.');
        return;
    }

    await handleAbsenceButton(phone, nearest.reservation.id, nearest.dateStr);
}

async function createReservationFromWhatsApp(phone, data) {
    const { slotId, dateStr, firstName, lastName } = data;
    const commitmentMonths = 3;
    const commitmentEndDate = commitmentEndDateFromMonths(dateStr, commitmentMonths);

    const slot = await prisma.slot.findFirst({ where: { id: Number(slotId), isActive: true } });
    if (!slot) throw new Error('Turno no disponible.');

    const dup = await prisma.reservation.findFirst({
        where: { slotId: slot.id, userPhone: phone, date: dateStr, status: { in: ['confirmed', 'completed'] } },
    });
    if (dup) throw new Error('Ya tienes una reserva para este turno.');

    const taken = await prisma.reservation.count({
        where: { slotId: slot.id, date: dateStr, status: { in: ['confirmed', 'completed'] } },
    });
    if (taken >= slot.capacity) throw new Error('Este turno ya está completo.');

    const fullName = [firstName, lastName].filter(Boolean).join(' ').trim();

    const reservation = await prisma.reservation.create({
        data: {
            slotId: slot.id,
            userPhone: phone,
            userFirstName: firstName,
            userLastName: lastName || '',
            userName: fullName,
            date: dateStr,
            frequency: COMMITMENT_FREQUENCY.WEEKLY,
            durationMinutes: 60,
            startTimeOffset: 0,
            commitmentEndDate,
            status: 'confirmed',
        },
        include: { slot: true },
    });

    await prisma.auditLog.create({
        data: {
            action: 'reservation.create',
            entity: 'reservation',
            entityId: reservation.id,
            reservationId: reservation.id,
            meta: JSON.stringify({ via: 'whatsapp', date: dateStr, frequency: 'WEEKLY' }),
        },
    });

    return reservation;
}

async function handleBookFlow(phone, session, text) {
    const data = parseSessionData(session.data);
    const msg = text.trim();

    if (session.step === 'book_name') {
        const parts = msg.split(/\s+/);
        if (parts.length < 1 || parts[0].length < 2) {
            await sendText(phone, 'Por favor escribe tu *nombre* (ej: María González).');
            return;
        }
        data.firstName = parts[0];
        data.lastName = parts.slice(1).join(' ');
        const options = await getAvailableSlotOptions(4);
        if (!options.length) {
            await sendText(phone, 'No hay cupos disponibles en los próximos días. Intenta más tarde.');
            await updateSession(phone, 'menu', {});
            return;
        }
        data.slotOptions = options.slice(0, 10).map((o, i) => ({
            index: i + 1,
            slotId: o.slot.id,
            dateStr: o.dateStr,
            label: o.label,
        }));
        const list = data.slotOptions.map((o) => `${o.index}. ${o.label}`).join('\n');
        await sendText(phone, `Elige tu turno respondiendo con el *número*:\n\n${list}`);
        await updateSession(phone, 'book_slot', data);
        return;
    }

    if (session.step === 'book_slot') {
        const choice = Number(msg);
        const picked = data.slotOptions?.find((o) => o.index === choice);
        if (!picked) {
            await sendText(phone, 'Número inválido. Responde con el número del turno que deseas.');
            return;
        }
        data.slotId = picked.slotId;
        data.dateStr = picked.dateStr;
        const slot = await prisma.slot.findUnique({ where: { id: picked.slotId } });
        const slotLabel = formatTimeRange12(slot.startTime, slot.endTime);
        await sendButtons(
            phone,
            `Confirmas tu guardia *semanal*?\n\n📅 ${picked.dateStr}\n⏰ ${slotLabel}\n👤 ${data.firstName} ${data.lastName || ''}\n📆 Compromiso: 3 meses\n\n¿Confirmar reserva?`,
            [
                { id: 'book_confirm_yes', title: 'Sí, confirmar' },
                { id: 'book_confirm_no', title: 'Cancelar' },
            ]
        );
        await updateSession(phone, 'book_confirm', data);
        return;
    }
}

async function handleButtonReply(phone, buttonId) {
    if (buttonId === 'menu_reservar' || buttonId === 'book_confirm_yes') {
        if (buttonId === 'menu_reservar') {
            await sendText(phone, 'Para reservar, escribe tu *nombre completo* (ej: Juan Pérez).');
            await updateSession(phone, 'book_name', {});
            return;
        }
        const session = await getSession(phone);
        const data = parseSessionData(session.data);
        try {
            const reservation = await createReservationFromWhatsApp(phone, data);
            const slotLabel = formatTimeRange12(reservation.slot.startTime, reservation.slot.endTime);
            const name = data.firstName || reservation.userName;
            const sentTemplate = await sendBookingConfirmedTemplate(phone, {
                name,
                date: reservation.date,
                time: slotLabel,
            }).catch(() => null);
            if (!sentTemplate) {
                await sendText(
                    phone,
                    `✅ *¡Reserva confirmada!*\n\n📅 ${reservation.date}\n⏰ ${slotLabel}\n\nTe enviaremos recordatorios 24 h y 3 h antes. 🙏`
                );
            }
        } catch (e) {
            await sendText(phone, `No se pudo completar la reserva: ${e.message}`);
        }
        await updateSession(phone, 'menu', {});
        return;
    }

    if (buttonId === 'menu_mis_turnos') {
        await listMyShifts(phone);
        return;
    }

    if (buttonId === 'menu_ayuda') {
        await sendText(phone, FAQ[0].answer);
        return;
    }

    if (buttonId === 'book_confirm_no') {
        await sendText(phone, 'Reserva cancelada. Escribe *menu* para volver al inicio.');
        await updateSession(phone, 'menu', {});
        return;
    }

    const absenceMatch = buttonId.match(/^absence_(\d+)_(\d{4}-\d{2}-\d{2})$/);
    if (absenceMatch) {
        await handleAbsenceButton(phone, Number(absenceMatch[1]), absenceMatch[2]);
        return;
    }

    const confirmMatch = buttonId.match(/^confirm_(\d+)_(\d{4}-\d{2}-\d{2})$/);
    if (confirmMatch) {
        await handleConfirmButton(phone, Number(confirmMatch[1]), confirmMatch[2]);
        return;
    }
}

async function handleIncomingMessage(waId, text, buttonId = null) {
    const phone = normalizePhone(parseWaPhone(waId));
    if (!isValidPhone(phone)) {
        console.warn('[WhatsApp] teléfono inválido:', waId);
        return;
    }

    const botCfg = await getWhatsAppBotConfig();
    const msg = (text || '').trim();

    if (buttonId) {
        await handleButtonReply(phone, buttonId);
        return;
    }

    if (isTemplateAbsenceReply(msg)) {
        await reportAbsenceFromLatestReminder(phone);
        return;
    }

    if (isTemplateConfirmReply(msg)) {
        const log = await prisma.whatsAppReminderLog.findFirst({
            where: { phone },
            orderBy: { sentAt: 'desc' },
        });
        if (log) {
            await handleConfirmButton(phone, log.reservationId, log.occurrenceDate);
        } else {
            await sendText(phone, '¡Gracias! Te esperamos en tu guardia. 🙏');
        }
        return;
    }

    const session = await getSession(phone);
    const lower = msg.toLowerCase();

    if (!msg || ['hola', 'menu', 'menú', 'inicio', 'hi', 'hello'].includes(lower)) {
        await sendMainMenu(phone);
        return;
    }

    if (['reservar', 'turno', 'agendar'].includes(lower)) {
        await sendText(phone, 'Para reservar, escribe tu *nombre completo* (ej: Juan Pérez).');
        await updateSession(phone, 'book_name', {});
        return;
    }

    if (['mis turnos', 'mis guardias', 'turnos'].includes(lower)) {
        await listMyShifts(phone);
        return;
    }

    if (['no podré', 'no podre', 'no asistiré', 'no asistire', 'ausencia', 'emergencia'].some((k) => lower.includes(k))) {
        await reportAbsenceFromLatestReminder(phone);
        return;
    }

    if (['adios', 'adiós', 'chao', 'gracias', 'bye'].includes(lower)) {
        await sendText(phone, truncateBotText(botCfg.goodbyeMessage, botCfg.responseMaxChars));
        return;
    }

    const faqAnswer = await matchFaq(lower);
    if (faqAnswer) {
        await sendText(phone, faqAnswer);
        return;
    }

    if (session.step === 'book_name' || session.step === 'book_slot') {
        await handleBookFlow(phone, session, msg);
        return;
    }

    const fallback =
        botCfg.fallbackMessage ||
        `No entendí tu mensaje. Escribe *menu* para ver opciones, *reservar* para un turno, o *ayuda* para saber cómo funciona.`;
    await sendText(phone, truncateBotText(fallback, botCfg.responseMaxChars));
}

module.exports = { handleIncomingMessage, sendMainMenu };
