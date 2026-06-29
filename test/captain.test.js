const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const {
    captainRangesOverlap,
    blockRangesOverlap,
    timeRangesOverlap,
    daysOverlap,
    slotMatchesCaptainScope,
    reservationMatchesCaptainScope,
} = require('../src/utils/captainScope');
const { requireCaptainScopeForReservation } = require('../src/middleware/captainContext');

describe('captainRangesOverlap', () => {
    const base = { userId: 1, isActive: true, dayOfWeek: 1, startTime: '07:00', endTime: '12:00' };

    it('detects overlap on same day and crossing hours', () => {
        assert.equal(
            captainRangesOverlap(base, { ...base, id: 2, startTime: '10:00', endTime: '14:00' }),
            true
        );
    });

    it('ignores different weekdays', () => {
        assert.equal(
            captainRangesOverlap(base, { ...base, id: 2, dayOfWeek: 2 }),
            false
        );
    });

    it('treats null day as all days', () => {
        assert.equal(
            captainRangesOverlap(base, { ...base, id: 2, dayOfWeek: null, startTime: '08:00', endTime: '09:00' }),
            true
        );
    });

    it('ignores different users for same-user overlap helper', () => {
        assert.equal(
            captainRangesOverlap(base, { ...base, id: 2, userId: 2 }),
            false
        );
    });
});

describe('blockRangesOverlap', () => {
    it('detects conflict between different captains on same block', () => {
        const a = { id: 1, userId: 1, isActive: true, dayOfWeek: 1, startTime: '07:00', endTime: '12:00' };
        const b = { id: 2, userId: 2, isActive: true, dayOfWeek: 1, startTime: '10:00', endTime: '14:00' };
        assert.equal(blockRangesOverlap(a, b), true);
    });
});

describe('timeRangesOverlap', () => {
    it('handles overnight ranges', () => {
        assert.equal(timeRangesOverlap(22 * 60, 2 * 60, 23 * 60, 23 * 60 + 30), true);
        assert.equal(timeRangesOverlap(22 * 60, 2 * 60, 10 * 60, 11 * 60), false);
    });
});

describe('slotMatchesCaptainScope', () => {
    const ranges = [{ dayOfWeek: 1, startTime: '07:00', endTime: '12:00' }];

    it('matches slot inside range on correct weekday', () => {
        assert.equal(slotMatchesCaptainScope(1, '08:00', ranges), true);
    });

    it('rejects slot outside range', () => {
        assert.equal(slotMatchesCaptainScope(1, '14:00', ranges), false);
        assert.equal(slotMatchesCaptainScope(2, '08:00', ranges), false);
    });
});

describe('requireCaptainScopeForReservation', () => {
    const mondayRange = [{ dayOfWeek: 1, startTime: '07:00', endTime: '12:00' }];
    const reservation = {
        date: '2026-06-01',
        weekDays: '1',
        frequency: 'WEEKLY',
        slot: { startTime: '08:00', endTime: '09:00' },
    };

    it('allows full admin (not scoped captain)', () => {
        const req = { isScopedCaptain: false, captainRanges: [] };
        assert.equal(requireCaptainScopeForReservation(reservation, req), null);
    });

    it('returns 403 message when scoped captain is out of range', () => {
        const req = {
            isScopedCaptain: true,
            captainRanges: [{ dayOfWeek: 3, startTime: '07:00', endTime: '12:00' }],
        };
        assert.ok(requireCaptainScopeForReservation(reservation, req));
    });

    it('allows scoped captain inside range', () => {
        const req = { isScopedCaptain: true, captainRanges: mondayRange };
        assert.equal(requireCaptainScopeForReservation(reservation, req), null);
    });
});

describe('reservationMatchesCaptainScope', () => {
    it('matches weekly commitment on assigned weekday', () => {
        const reservation = {
            frequency: 'WEEKLY',
            weekDays: '1',
            date: '2026-06-01',
            slot: { startTime: '09:00' },
        };
        const ranges = [{ dayOfWeek: 1, startTime: '07:00', endTime: '12:00' }];
        assert.equal(reservationMatchesCaptainScope(reservation, ranges), true);
    });
});
