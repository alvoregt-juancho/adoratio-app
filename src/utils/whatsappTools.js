const prisma = require('../db');
const config = require('../config');
const { todayStr } = require('./dates');
const { filterSlotsForDate } = require('./schedule');
const { formatTimeRange12 } = require('./timeFormat');
const { getUpcomingOccurrenceDates } = require('./whatsappOccurrences');
const { getWhatsAppBotConfig } = require('./whatsappBotConfig');
const { startHandoff } = require('./chatSession');

const DEFAULT_TOOLS = [
    'get_chapel_info',
    'get_available_slots',
    'get_user_reservations',
    'get_profile',
    'invite_web_registration',
    'escalate_to_human',
];

function parseEnabledTools(raw) {
    if (!raw) return [...DEFAULT_TOOLS];
    try {
        const parsed = JSON.parse(raw);
        return Array.isArray(parsed) ? parsed : [...DEFAULT_TOOLS];
    } catch {
        return [...DEFAULT_TOOLS];
    }
}

function parseHandoffKeywords(raw) {
    const defaults = [
        'operador',
        'humano',
        'persona',
        'coordinador',
        'hablar con alguien',
        'agente',
        'ayuda humana',
    ];
    if (!raw) return defaults;
    try {
        const parsed = JSON.parse(raw);
        if (Array.isArray(parsed)) return parsed.map((k) => String(k).toLowerCase());
        if (parsed.keywords) return parsed.keywords.map((k) => String(k).toLowerCase());
    } catch {
        /* ignore */
    }
    return defaults;
}

async function toolGetChapelInfo() {
    const botCfg = await getWhatsAppBotConfig();
    const chapel = botCfg.chapelDescription || config.whatsapp.chapelName;
    const hours = botCfg.adorationHours || '7:00 AM – 8:00 PM todos los días';
    return `📍 *${chapel}*\n\nHorario de adoración: ${hours}\n\nWeb: ${config.baseUrl}`;
}

async function toolGetAvailableSlots(phone, { daysAhead = 3 } = {}) {
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
        const countBySlot = Object.fromEntries(reservations.map((r) => [r.slotId, r._count._all]));

        for (const slot of eligible) {
            const taken = countBySlot[slot.id] || 0;
            const available = Math.max(0, slot.capacity - taken);
            if (available > 0) {
                options.push(
                    `• ${dateStr} · ${formatTimeRange12(slot.startTime, slot.endTime)} (${available} cupo${available === 1 ? '' : 's'})`
                );
            }
        }
    }

    if (!options.length) {
        return 'No hay cupos disponibles en los próximos días. Escribe *reservar* para el flujo guiado o visita la web.';
    }
    return `*Cupos disponibles (resumen)*\n\n${options.slice(0, 12).join('\n')}\n\nPara reservar escribe *reservar*.`;
}

async function toolGetUserReservations(phone) {
    const reservations = await prisma.reservation.findMany({
        where: { userPhone: phone, status: { in: ['confirmed', 'completed'] } },
        include: { slot: true },
        orderBy: { date: 'asc' },
    });

    if (!reservations.length) {
        return 'No tienes turnos registrados con este número. Escribe *reservar* para agendar.';
    }

    const lines = reservations.map((r) => {
        const slotLabel = formatTimeRange12(r.slot.startTime, r.slot.endTime);
        const nextDates = getUpcomingOccurrenceDates(r, 14).slice(0, 2);
        const next = nextDates.length ? ` — próx: ${nextDates.join(', ')}` : '';
        return `• ${r.userName}: ${slotLabel} (${r.frequency})${next}`;
    });

    return `📋 *Tus turnos*\n\n${lines.join('\n')}\n\nEscribe *reservar* para otro turno.`;
}

async function toolGetProfile(phone) {
    const user = await prisma.user.findFirst({
        where: { phone },
        select: { id: true, name: true, email: true, phone: true, role: true },
    });
    if (!user) {
        return `No encontramos un perfil web con este número.\n\nCompleta tu registro en:\n${config.baseUrl}`;
    }
    return `👤 *Tu perfil*\n\nNombre: ${user.name}\nCorreo: ${user.email || '—'}\nRol: ${user.role}\n\nPuedes gestionar turnos en la web: ${config.baseUrl}`;
}

async function toolInviteWebRegistration() {
    const botCfg = await getWhatsAppBotConfig();
    const url = botCfg.inviteToWebUrl || config.baseUrl;
    return `Para completar tu inscripción o gestionar tu perfil, visita:\n\n${url}\n\nAllí podrás registrar tus datos y ver todos los turnos con más detalle.`;
}

async function toolEscalateToHuman(phone, { reason = 'Solicitud del usuario' } = {}) {
    await startHandoff(phone, { reason });
    const botCfg = await getWhatsAppBotConfig();
    return (
        botCfg.escalationMessage ||
        'Un operador de la coordinación revisará tu mensaje en breve. Gracias por tu paciencia. 🙏'
    );
}

const TOOL_EXECUTORS = {
    get_chapel_info: () => toolGetChapelInfo(),
    get_available_slots: (phone, args) => toolGetAvailableSlots(phone, args),
    get_user_reservations: (phone) => toolGetUserReservations(phone),
    get_profile: (phone) => toolGetProfile(phone),
    invite_web_registration: () => toolInviteWebRegistration(),
    escalate_to_human: (phone, args) => toolEscalateToHuman(phone, args),
};

function detectToolIntent(text, buttonId, enabledTools, handoffKeywords) {
    const lower = String(text || '').toLowerCase().trim();
    const enabled = new Set(enabledTools);

    if (buttonId === 'menu_ayuda' && enabled.has('get_chapel_info')) {
        return { tool: 'get_chapel_info', args: {} };
    }
    if ((buttonId === 'menu_mis_turnos' || lower.includes('mis turnos')) && enabled.has('get_user_reservations')) {
        return { tool: 'get_user_reservations', args: {} };
    }

    if (enabled.has('escalate_to_human') && handoffKeywords.some((k) => lower.includes(k))) {
        return { tool: 'escalate_to_human', args: { reason: `Usuario escribió: ${text}` } };
    }
    if (enabled.has('get_profile') && /perfil|mi cuenta|mis datos|registro/.test(lower)) {
        return { tool: 'get_profile', args: {} };
    }
    if (enabled.has('invite_web_registration') && /inscribir|registr|completar datos|web/.test(lower)) {
        return { tool: 'invite_web_registration', args: {} };
    }
    if (enabled.has('get_available_slots') && /cupos|disponib|horarios libres/.test(lower)) {
        return { tool: 'get_available_slots', args: {} };
    }
    if (enabled.has('get_chapel_info') && /capilla|ubicaci|donde|dónde|parroquia/.test(lower)) {
        return { tool: 'get_chapel_info', args: {} };
    }

    return null;
}

async function executeTool(toolName, phone, args = {}) {
    const fn = TOOL_EXECUTORS[toolName];
    if (!fn) return null;
    return fn(phone, args);
}

function getToolDefinitionsForLlm() {
    return [
        { type: 'function', function: { name: 'get_chapel_info', description: 'Info de capilla y horarios' } },
        { type: 'function', function: { name: 'get_available_slots', description: 'Cupos disponibles' } },
        { type: 'function', function: { name: 'get_user_reservations', description: 'Turnos del usuario' } },
        { type: 'function', function: { name: 'get_profile', description: 'Perfil del usuario' } },
        { type: 'function', function: { name: 'invite_web_registration', description: 'Link de registro web' } },
        { type: 'function', function: { name: 'escalate_to_human', description: 'Pasar a operador humano' } },
    ];
}

module.exports = {
    DEFAULT_TOOLS,
    parseEnabledTools,
    parseHandoffKeywords,
    detectToolIntent,
    executeTool,
    getToolDefinitionsForLlm,
};
