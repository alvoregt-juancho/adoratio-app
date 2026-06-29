const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const { applyScopedSlotDelete } = require('../src/utils/slotScope');

describe('applyScopedSlotDelete', () => {
    const allWeekSlot = { id: 1, weekDays: null, startTime: '07:00', endTime: '08:00' };
    const monWedSlot = { id: 2, weekDays: '1,3', startTime: '09:00', endTime: '10:00' };

    it('plans full delete when scope is empty (all days)', async () => {
        const plan = await applyScopedSlotDelete(null, allWeekSlot, null);
        assert.equal(plan.action, 'delete');
    });

    it('plans full delete when scope is explicit full week', async () => {
        const plan = await applyScopedSlotDelete(null, allWeekSlot, '1,2,3,4,5,6,7');
        assert.equal(plan.action, 'delete');
    });

    it('plans trim when removing subset from global slot', async () => {
        const plan = await applyScopedSlotDelete(null, allWeekSlot, '1,2,3,4,5');
        assert.equal(plan.action, 'trim');
        assert.equal(plan.weekDays, '6,7');
    });

    it('plans full delete when scope covers partial slot entirely', async () => {
        const plan = await applyScopedSlotDelete(null, monWedSlot, '1,2,3');
        assert.equal(plan.action, 'delete');
    });

    it('plans trim when scope is partial on partial slot', async () => {
        const plan = await applyScopedSlotDelete(null, monWedSlot, '1');
        assert.equal(plan.action, 'trim');
        assert.equal(plan.weekDays, '3');
    });
});
