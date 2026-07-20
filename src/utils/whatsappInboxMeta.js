/** Etiquetas de embudo WhatsApp para AdoraHora (no e-commerce). */

const FUNNEL_BY_STEP = {
    menu: { key: 'menu', label: 'Menú' },
    book_weekday: { key: 'booking', label: 'Reservando · Día' },
    book_time: { key: 'booking', label: 'Reservando · Hora' },
    book_frequency: { key: 'booking', label: 'Reservando · Frecuencia' },
    book_biweekly: { key: 'booking', label: 'Reservando · Quincena' },
    book_duration: { key: 'booking', label: 'Reservando · Duración' },
    book_name: { key: 'booking', label: 'Reservando · Nombre' },
    book_confirm: { key: 'confirm', label: 'Confirmando' },
    book_slot: { key: 'booking', label: 'Reservando' },
};

function funnelFromSession(session) {
    if (!session) return { key: 'menu', label: 'Menú' };
    if (session.handoffActive || session.mode === 'handoff') {
        return { key: 'handoff', label: 'Handoff' };
    }
    return FUNNEL_BY_STEP[session.step] || { key: 'other', label: session.step || 'Menú' };
}

function channelFromSession(session) {
    if (!session) return { key: 'rules', label: 'Bot' };
    if (session.handoffActive || session.mode === 'handoff') {
        return { key: 'human', label: 'Humano' };
    }
    if (session.mode === 'ai') return { key: 'ai', label: 'IA' };
    return { key: 'rules', label: 'Bot' };
}

function initialsFromSession(session) {
    const name = String(session?.contactName || '').trim();
    if (name) {
        const parts = name.split(/\s+/).filter(Boolean);
        if (parts.length >= 2) {
            return (parts[0][0] + parts[1][0]).toUpperCase();
        }
        return name.slice(0, 2).toUpperCase();
    }
    const phone = String(session?.phone || '');
    return phone.slice(-2) || '??';
}

function truncatePreview(text, max = 60) {
    const s = String(text || '').replace(/\s+/g, ' ').trim();
    if (!s) return '';
    if (s.length <= max) return s;
    return s.slice(0, max - 1) + '…';
}

module.exports = {
    FUNNEL_BY_STEP,
    funnelFromSession,
    channelFromSession,
    initialsFromSession,
    truncatePreview,
};
