/**
 * Detección de espacios de 30 minutos en bloques horarios.
 * CRITICAL_GAP solo aplica cuando hay cobertura parcial:
 * una media hora cubierta y la otra vacía.
 * Una hora completamente vacía no es un “hueco de 30 min”.
 */

const GAP_STATUS = {
    COVERED: 'COVERED',
    EMPTY: 'EMPTY',
    CRITICAL_GAP: 'CRITICAL_GAP',
};

/**
 * @param {Array<{ startTimeOffset: number, durationMinutes: number }>} commitments
 * @returns {'COVERED' | 'EMPTY' | 'CRITICAL_GAP'}
 */
function checkTimelineGaps(commitments) {
    const list = Array.isArray(commitments) ? commitments : [];
    if (!list.length) return GAP_STATUS.EMPTY;

    let hasFirstHalfCoverage = false;
    let hasSecondHalfCoverage = false;

    for (const c of list) {
        const offset = c.startTimeOffset ?? c.offsetMinutes ?? 0;
        const duration = c.durationMinutes ?? 60;

        if (offset === 0 && duration >= 30) hasFirstHalfCoverage = true;
        if ((offset === 0 && duration >= 60) || (offset === 30 && duration >= 30)) {
            hasSecondHalfCoverage = true;
        }
    }

    if (hasFirstHalfCoverage && hasSecondHalfCoverage) {
        return GAP_STATUS.COVERED;
    }
    // Solo es hueco de 30 min si una mitad está cubierta y la otra no.
    if (hasFirstHalfCoverage || hasSecondHalfCoverage) {
        return GAP_STATUS.CRITICAL_GAP;
    }
    return GAP_STATUS.EMPTY;
}

/** Indica si algún compromiso usa duración u offset no estándar (30 min). */
function hasFractionalCoverage(commitments) {
    return (Array.isArray(commitments) ? commitments : []).some((c) => {
        const offset = c.startTimeOffset ?? c.offsetMinutes ?? 0;
        const duration = c.durationMinutes ?? 60;
        return offset === 30 || duration === 30;
    });
}

module.exports = {
    GAP_STATUS,
    checkTimelineGaps,
    hasFractionalCoverage,
};
