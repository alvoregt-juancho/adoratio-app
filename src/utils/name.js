/** Utilidades para nombre / apellido de participantes. */

function splitFullName(full) {
    const trimmed = String(full || '').trim();
    if (!trimmed) return { first: '', last: '' };
    const parts = trimmed.split(/\s+/);
    if (parts.length === 1) return { first: parts[0], last: '' };
    return { first: parts[0], last: parts.slice(1).join(' ') };
}

function buildFullName(first, last) {
    return [first, last].map((s) => String(s || '').trim()).filter(Boolean).join(' ');
}

function parseParticipantNames(body) {
    let first = String(body?.userFirstName || '').trim();
    let last = String(body?.userLastName || '').trim();

    if (!first && !last && body?.userName) {
        const split = splitFullName(body.userName);
        first = split.first;
        last = split.last;
    }

    return { first, last, full: buildFullName(first, last) };
}

function normalizeReservationNames(reservation) {
    let first = reservation.userFirstName || '';
    let last = reservation.userLastName || '';
    if (!first && !last && reservation.userName) {
        const split = splitFullName(reservation.userName);
        first = split.first;
        last = split.last;
    }
    return {
        ...reservation,
        userFirstName: first,
        userLastName: last,
        userName: reservation.userName || buildFullName(first, last),
    };
}

module.exports = {
    splitFullName,
    buildFullName,
    parseParticipantNames,
    normalizeReservationNames,
};
