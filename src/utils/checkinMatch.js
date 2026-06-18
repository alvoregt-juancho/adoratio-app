const { COMMITMENT_FREQUENCY } = require('../constants/commitment');
const { commitmentAppliesOn } = require('./commitmentMatch');

const RECURRING_FREQUENCIES = new Set([
    COMMITMENT_FREQUENCY.WEEKLY,
    COMMITMENT_FREQUENCY.DAILY,
    COMMITMENT_FREQUENCY.BIWEEKLY,
    COMMITMENT_FREQUENCY.MONTHLY,
]);

function isRecurringFrequency(frequency) {
    return RECURRING_FREQUENCIES.has(frequency || COMMITMENT_FREQUENCY.WEEKLY);
}

function isSlotActiveNow(slot, nowHHMM) {
    if (!slot) return false;
    return slot.startTime <= nowHHMM && slot.endTime > nowHHMM;
}

function findCheckinReservation(reservations, dateStr, nowHHMM) {
    return reservations.find((r) => {
        if (r.status !== 'confirmed') return false;
        if (!commitmentAppliesOn(r, dateStr)) return false;
        return isSlotActiveNow(r.slot, nowHHMM);
    }) || null;
}

function startOfDay(dateStr) {
    return new Date(`${dateStr}T00:00:00`);
}

function endOfDay(dateStr) {
    return new Date(`${dateStr}T23:59:59.999`);
}

module.exports = {
    isRecurringFrequency,
    isSlotActiveNow,
    findCheckinReservation,
    startOfDay,
    endOfDay,
};
