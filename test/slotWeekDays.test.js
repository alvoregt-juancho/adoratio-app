const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const {
    slotAppliesOnWeekday,
    slotAppliesOnSelection,
    weekDaysOverlap,
    subtractWeekDays,
    scopeCoversEntireSlot,
    normalizeWeekDaysInput,
} = require('../src/utils/slotWeekDays');

describe('slotWeekDays', () => {
    it('treats null weekDays as all days', () => {
        assert.equal(slotAppliesOnWeekday({ weekDays: null }, 1), true);
        assert.equal(slotAppliesOnWeekday({ weekDays: null }, 7), true);
    });

    it('filters by specific weekdays', () => {
        assert.equal(slotAppliesOnWeekday({ weekDays: '1,3' }, 1), true);
        assert.equal(slotAppliesOnWeekday({ weekDays: '1,3' }, 2), false);
    });

    it('selection filter uses union', () => {
        assert.equal(slotAppliesOnSelection({ weekDays: '1,3' }, [2, 3]), true);
        assert.equal(slotAppliesOnSelection({ weekDays: '1' }, [2, 3]), false);
    });

    it('detects overlapping weekdays', () => {
        assert.equal(weekDaysOverlap('1,2', '2,3'), true);
        assert.equal(weekDaysOverlap('1', '2,3'), false);
        assert.equal(weekDaysOverlap(null, '1'), true);
    });

    it('subtracts days from global slot', () => {
        assert.equal(subtractWeekDays(null, '1'), '2,3,4,5,6,7');
    });

    it('subtracts days from partial slot', () => {
        assert.equal(subtractWeekDays('1,3,5', '1,3'), '5');
    });

    it('scopeCoversEntireSlot', () => {
        assert.equal(scopeCoversEntireSlot({ weekDays: '1,3' }, '1,3,5'), true);
        assert.equal(scopeCoversEntireSlot({ weekDays: '1,3' }, '1'), false);
        assert.equal(scopeCoversEntireSlot({ weekDays: '1,3' }, '1,3'), true);
    });

    it('normalizeWeekDaysInput', () => {
        assert.equal(normalizeWeekDaysInput('1,2,3,4,5,6,7'), null);
        assert.equal(normalizeWeekDaysInput('1,3'), '1,3');
    });
});
