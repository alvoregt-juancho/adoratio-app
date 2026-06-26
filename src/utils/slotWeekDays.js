const { parseWeekDays, formatWeekDays } = require('./weekDays');

const ALL_WEEKDAYS = [1, 2, 3, 4, 5, 6, 7];

function normalizeWeekDaysInput(raw) {
    const days = parseWeekDays(raw);
    if (!days.length || days.length === 7) return null;
    return days.join(',');
}

function slotWeekDaysList(slot) {
    const days = parseWeekDays(slot?.weekDays);
    return days.length ? days : ALL_WEEKDAYS;
}

function slotAppliesOnWeekday(slot, weekday) {
    return slotWeekDaysList(slot).includes(Number(weekday));
}

function slotAppliesOnSelection(slot, selectedWeekdays) {
    const selected = parseWeekDays(selectedWeekdays);
    if (!selected.length) return true;
    const slotDays = slotWeekDaysList(slot);
    return selected.some((d) => slotDays.includes(d));
}

function weekDaysOverlap(daysA, daysB) {
    const a = parseWeekDays(daysA);
    const b = parseWeekDays(daysB);
    const listA = a.length ? a : ALL_WEEKDAYS;
    const listB = b.length ? b : ALL_WEEKDAYS;
    return listA.some((d) => listB.includes(d));
}

function intersectWeekDays(daysA, daysB) {
    const a = parseWeekDays(daysA);
    const b = parseWeekDays(daysB);
    const listA = a.length ? a : ALL_WEEKDAYS;
    const listB = b.length ? b : ALL_WEEKDAYS;
    return listA.filter((d) => listB.includes(d));
}

function subtractWeekDays(daysA, removeRaw) {
    const remove = parseWeekDays(removeRaw);
    if (!remove.length) return normalizeWeekDaysInput(daysA);

    const base = parseWeekDays(daysA);
    const listA = base.length ? base : ALL_WEEKDAYS;
    const remaining = listA.filter((d) => !remove.includes(d));
    return normalizeWeekDaysInput(remaining);
}

function scopeCoversEntireSlot(slot, scopeRaw) {
    const scope = parseWeekDays(scopeRaw);
    if (!scope.length) return true;
    const slotDays = slotWeekDaysList(slot);
    return scope.length >= slotDays.length && slotDays.every((d) => scope.includes(d));
}

function formatSlotWeekDaysLabel(weekDays) {
    if (weekDays == null || weekDays === '') return 'Todos';
    return formatWeekDays(weekDays) || 'Todos';
}

module.exports = {
    ALL_WEEKDAYS,
    normalizeWeekDaysInput,
    slotWeekDaysList,
    slotAppliesOnWeekday,
    slotAppliesOnSelection,
    weekDaysOverlap,
    intersectWeekDays,
    subtractWeekDays,
    scopeCoversEntireSlot,
    formatSlotWeekDaysLabel,
    parseWeekDays,
};
