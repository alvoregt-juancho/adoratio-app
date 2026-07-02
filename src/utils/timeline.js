/**
 * Detección de espacios de 30 minutos en bloques horarios.
 * Un bloque de 1 hora queda solo si falta cobertura en la primera o segunda media hora.
 */

const GAP_STATUS = {
    COVERED: 'COVERED',
    CRITICAL_GAP: 'CRITICAL_GAP',
};

/**
 * @param {Array<{ startTimeOffset: number, durationMinutes: number }>} commitments
 * @returns {'COVERED' | 'CRITICAL_GAP'}
 */
function checkTimelineGaps(commitments) {
    let hasFirstHalfCoverage = false;
    let hasSecondHalfCoverage = false;

    for (const c of commitments) {
        const offset = c.startTimeOffset ?? c.offsetMinutes ?? 0;
        const duration = c.durationMinutes ?? 60;

        if (offset === 0 && duration >= 30) hasFirstHalfCoverage = true;
        if ((offset === 0 && duration >= 60) || (offset === 30 && duration >= 30)) {
            hasSecondHalfCoverage = true;
        }
    }

    if (!hasFirstHalfCoverage || !hasSecondHalfCoverage) {
        return GAP_STATUS.CRITICAL_GAP;
    }
    return GAP_STATUS.COVERED;
}

/** Indica si algún compromiso usa duración u offset no estándar (30 min). */
function hasFractionalCoverage(commitments) {
    return commitments.some((c) => {
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
