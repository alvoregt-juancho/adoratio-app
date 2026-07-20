const test = require('node:test');
const assert = require('node:assert/strict');
const { checkTimelineGaps, GAP_STATUS } = require('../src/utils/timeline');

test('hora vacía no es hueco de 30 min', () => {
    assert.equal(checkTimelineGaps([]), GAP_STATUS.EMPTY);
});

test('hora cubierta completa', () => {
    assert.equal(
        checkTimelineGaps([{ startTimeOffset: 0, durationMinutes: 60 }]),
        GAP_STATUS.COVERED,
    );
});

test('solo primera media hora → CRITICAL_GAP', () => {
    assert.equal(
        checkTimelineGaps([{ startTimeOffset: 0, durationMinutes: 30 }]),
        GAP_STATUS.CRITICAL_GAP,
    );
});

test('solo segunda media hora → CRITICAL_GAP', () => {
    assert.equal(
        checkTimelineGaps([{ startTimeOffset: 30, durationMinutes: 30 }]),
        GAP_STATUS.CRITICAL_GAP,
    );
});

test('ambas medias horas cubiertas por turnos de 30 → COVERED', () => {
    assert.equal(
        checkTimelineGaps([
            { startTimeOffset: 0, durationMinutes: 30 },
            { startTimeOffset: 30, durationMinutes: 30 },
        ]),
        GAP_STATUS.COVERED,
    );
});
