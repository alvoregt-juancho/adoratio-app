const test = require('node:test');
const assert = require('node:assert/strict');
const {
    countWeeklyActiveSlotOccurrences,
    buildCalendarDaySlots,
    uniqueSlotTimeRows,
} = require('../src/utils/slotCalendar');

test('countWeeklyActiveSlotOccurrences counts each active hour per weekday', () => {
    const slots = [
        { id: 1, startTime: '08:00', endTime: '09:00', isActive: true, weekDays: '1' },
        { id: 2, startTime: '09:00', endTime: '10:00', isActive: true, weekDays: null },
        { id: 3, startTime: '13:00', endTime: '14:00', isActive: false, weekDays: null },
    ];
    assert.equal(countWeeklyActiveSlotOccurrences(slots), 8);
});

test('buildCalendarDaySlots includes inactive slots for the day', () => {
    const slots = [
        { id: 1, startTime: '13:00', endTime: '14:00', isActive: false, weekDays: null, capacity: 4 },
        { id: 2, startTime: '17:00', endTime: '18:00', isActive: true, weekDays: null, capacity: 4 },
        { id: 3, startTime: '20:00', endTime: '21:00', isActive: true, weekDays: '3', capacity: 4 },
    ];
    const monday = buildCalendarDaySlots(slots, '2026-06-29', []);
    assert.ok(monday.some((s) => s.startTime === '13:00' && s.isInactive));
    assert.ok(monday.some((s) => s.startTime === '17:00' && !s.isInactive));
    assert.equal(monday.some((s) => s.startTime === '20:00'), false);

    const wednesday = buildCalendarDaySlots(slots, '2026-07-01', []);
    assert.ok(wednesday.some((s) => s.startTime === '20:00' && s.isActive));
});

test('uniqueSlotTimeRows includes inactive and partial-week slots', () => {
    const rows = uniqueSlotTimeRows([
        { startTime: '20:00', endTime: '21:00', isActive: true, weekDays: '3' },
        { startTime: '08:00', endTime: '09:00', isActive: true, weekDays: null },
    ]);
    assert.equal(rows.length, 2);
    assert.equal(rows[1].startTime, '20:00');
});
