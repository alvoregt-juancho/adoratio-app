const { PRIV, hasPermission } = require('../constants/permissions');
const { loadActiveCaptainRanges } = require('../utils/captainScope');

function isScopedCaptain(user, captainRanges) {
    if (!captainRanges?.length) return false;
    if (!user) return false;
    if (hasPermission(user.privileges ?? 0, PRIV.SLOTS_EDIT)) return false;
    if (hasPermission(user.privileges ?? 0, PRIV.USERS_MANAGE)) return false;
    return true;
}

async function attachCaptainContext(req, res, next) {
    try {
        if (!req.user?.id) {
            req.captainRanges = [];
            req.isScopedCaptain = false;
            return next();
        }
        const ranges = await loadActiveCaptainRanges(req.user.id);
        req.captainRanges = ranges;
        req.isScopedCaptain = isScopedCaptain(req.user, ranges);
        next();
    } catch (e) {
        console.error(e);
        return res.status(500).json({ error: 'Error al cargar contexto de capitán.' });
    }
}

function requireCaptainScopeForReservation(reservation, req) {
    if (!req.isScopedCaptain) return null;
    const { reservationMatchesCaptainScope } = require('../utils/captainScope');
    if (!reservationMatchesCaptainScope(reservation, req.captainRanges)) {
        return 'No administras este turno u horario.';
    }
    return null;
}

module.exports = {
    attachCaptainContext,
    isScopedCaptain,
    requireCaptainScopeForReservation,
};
