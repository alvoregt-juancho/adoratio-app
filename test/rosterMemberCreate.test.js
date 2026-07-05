const test = require('node:test');
const assert = require('node:assert/strict');
const {
    validateRosterMemberPayload,
    normalizeWeekDaysString,
    normalizeSlotTimesString,
} = require('../src/utils/rosterMemberCreate');

test('validateRosterMemberPayload accepts valid substitute data', () => {
    const result = validateRosterMemberPayload(
        {
            firstName: 'María',
            lastName: 'López',
            phone: '8888-1234',
            weekDays: '1,3,5',
            slotTimes: '07:00,08:00',
        },
        { role: 'substitute', requireRole: false },
    );
    assert.ok(!result.error);
    assert.equal(result.data.firstName, 'María');
    assert.equal(result.data.phone, '88881234');
    assert.equal(result.data.weekDays, '1,3,5');
    assert.equal(result.data.slotTimes, '07:00,08:00');
});

test('validateRosterMemberPayload rejects invalid phone', () => {
    const result = validateRosterMemberPayload(
        { firstName: 'Ana', phone: '123' },
        { role: 'substitute', requireRole: false },
    );
    assert.equal(result.error, 'El celular debe tener exactamente 8 dígitos.');
});

test('validateRosterMemberPayload rejects missing name', () => {
    const result = validateRosterMemberPayload(
        { phone: '88881234' },
        { role: 'substitute', requireRole: false },
    );
    assert.equal(result.error, 'Nombre y celular son requeridos.');
});

test('normalizeWeekDaysString filters invalid days', () => {
    assert.equal(normalizeWeekDaysString('1,9,3'), '1,3');
    assert.equal(normalizeWeekDaysString(''), null);
});

test('normalizeSlotTimesString filters invalid times', () => {
    assert.equal(normalizeSlotTimesString('07:00,bad,08:30'), '07:00,08:30');
    assert.equal(normalizeSlotTimesString(null), null);
});
