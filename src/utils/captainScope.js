const prisma = require('../db');
const { weekdayFromDate } = require('../utils/schedule');
const { commitmentAppliesOn, participationWeekdays } = require('../utils/commitmentMatch');
const { formatWeekDays } = require('../utils/weekDays');

function timeToMinutes(hhmm) {
    if (!hhmm) return 0;
    const [h, m] = String(hhmm).split(':').map(Number);
    return h * 60 + (m || 0);
}

function formatTimeLabel(hhmm) {
    const mins = timeToMinutes(hhmm);
    const h = Math.floor(mins / 60);
    const m = mins % 60;
    const suffix = h < 12 ? 'AM' : 'PM';
    const hour12 = h % 12 || 12;
    return m ? `${hour12}:${String(m).padStart(2, '0')} ${suffix}` : `${hour12} ${suffix}`;
}

function timeRangesOverlap(startA, endA, startB, endB) {
    const segments = (start, end) => {
        if (end > start) return [[start, end]];
        return [
            [start, 24 * 60],
            [0, end],
        ];
    };
    const aSegs = segments(startA, endA);
    const bSegs = segments(startB, endB);
    return aSegs.some(([as, ae]) => bSegs.some(([bs, be]) => as < be && bs < ae));
}

function daysOverlap(dayA, dayB) {
    if (dayA == null || dayB == null) return true;
    return Number(dayA) === Number(dayB);
}

/** True when two active ranges for the same user share day + overlapping hours. */
function captainRangesOverlap(a, b) {
    if (!a || !b || Number(a.userId) !== Number(b.userId)) return false;
    if (a.isActive === false || b.isActive === false) return false;
    if (a.id != null && b.id != null && Number(a.id) === Number(b.id)) return false;
    if (!daysOverlap(a.dayOfWeek, b.dayOfWeek)) return false;
    return timeRangesOverlap(
        timeToMinutes(a.startTime),
        timeToMinutes(a.endTime),
        timeToMinutes(b.startTime),
        timeToMinutes(b.endTime)
    );
}

async function findOverlappingCaptainRange(parsed, excludeId = null) {
    const existing = await prisma.captainRange.findMany({
        where: { userId: parsed.userId, isActive: true },
    });
    return existing.find(
        (range) =>
            (!excludeId || range.id !== excludeId) && captainRangesOverlap(range, parsed)
    );
}

function slotMatchesCaptainScope(weekday, slotStartTime, ranges) {
    if (!ranges?.length || !slotStartTime) return false;
    const t = timeToMinutes(slotStartTime);
    return ranges.some((range) => {
        if (range.dayOfWeek != null && Number(range.dayOfWeek) !== Number(weekday)) {
            return false;
        }
        const start = timeToMinutes(range.startTime);
        const end = timeToMinutes(range.endTime);
        if (end <= start) {
            return t >= start || t < end;
        }
        return t >= start && t < end;
    });
}

function occurrenceMatchesCaptainScope(dateStr, slotStartTime, ranges) {
    return slotMatchesCaptainScope(weekdayFromDate(dateStr), slotStartTime, ranges);
}

function reservationMatchesCaptainScope(reservation, ranges) {
    if (!reservation?.slot || !ranges?.length) return false;
    const slotStart = reservation.slot.startTime;
    const weekdays = participationWeekdays(reservation);
    if (weekdays.length) {
        return weekdays.some((wd) => slotMatchesCaptainScope(wd, slotStart, ranges));
    }
    if (reservation.date) {
        return occurrenceMatchesCaptainScope(reservation.date, slotStart, ranges);
    }
    return false;
}

function filterReservationsForCaptain(reservations, ranges) {
    if (!ranges?.length) return reservations;
    return reservations.filter((r) => reservationMatchesCaptainScope(r, ranges));
}

function filterCalendarDaysForCaptain(days, ranges) {
    if (!ranges?.length) return days;
    return days
        .map((day) => ({
            ...day,
            slots: (day.slots || []).filter((slot) =>
                slotMatchesCaptainScope(day.weekday, slot.startTime, ranges)
            ),
        }))
        .filter((day) => day.slots.length > 0);
}

function formatCaptainRangeLabel(range) {
    const dayPart =
        range.dayOfWeek != null ? formatWeekDays(String(range.dayOfWeek)) : 'Todos los días';
    return `${dayPart} · ${formatTimeLabel(range.startTime)} – ${formatTimeLabel(range.endTime)}`;
}

function serializeCaptainRange(range) {
    return {
        id: range.id,
        userId: range.userId,
        userName: range.user?.name ?? null,
        userEmail: range.user?.email ?? null,
        adminRoleName: range.user?.adminRole?.name ?? null,
        dayOfWeek: range.dayOfWeek,
        dayLabel: range.dayOfWeek != null ? formatWeekDays(String(range.dayOfWeek)) : 'Todos',
        startTime: range.startTime,
        endTime: range.endTime,
        label: range.label || formatCaptainRangeLabel(range),
        isActive: range.isActive,
        createdById: range.createdById ?? null,
        updatedById: range.updatedById ?? null,
        createdByName: range.createdBy?.name ?? null,
        updatedByName: range.updatedBy?.name ?? null,
    };
}

async function loadActiveCaptainRanges(userId) {
    return prisma.captainRange.findMany({
        where: { userId, isActive: true },
        include: {
            user: {
                select: {
                    id: true,
                    name: true,
                    email: true,
                    adminRole: { select: { name: true } },
                },
            },
        },
        orderBy: [{ dayOfWeek: 'asc' }, { startTime: 'asc' }],
    });
}

async function findCaptainUsersForOccurrence(dateStr, slotStartTime) {
    const weekday = weekdayFromDate(dateStr);
    const ranges = await prisma.captainRange.findMany({
        where: { isActive: true },
        include: { user: { select: { id: true, name: true, email: true } } },
    });
    const byUser = new Map();
    for (const range of ranges) {
        if (!slotMatchesCaptainScope(weekday, slotStartTime, [range])) continue;
        if (!byUser.has(range.userId)) {
            byUser.set(range.userId, { user: range.user, ranges: [] });
        }
        byUser.get(range.userId).ranges.push(range);
    }
    return [...byUser.values()];
}

async function createCaptainNotification({
    captainUserId,
    captainRangeId,
    type,
    title,
    message,
    slotId,
    reservationId,
    occurrenceDate,
    isUrgent = false,
}) {
    const existing = await prisma.captainNotification.findFirst({
        where: {
            captainUserId,
            type,
            reservationId: reservationId ?? null,
            occurrenceDate: occurrenceDate ?? null,
            slotId: slotId ?? null,
            isRead: false,
        },
    });
    if (existing) {
        return prisma.captainNotification.update({
            where: { id: existing.id },
            data: { message, isUrgent: existing.isUrgent || isUrgent, title },
        });
    }
    return prisma.captainNotification.create({
        data: {
            captainUserId,
            captainRangeId,
            type,
            title,
            message,
            slotId,
            reservationId,
            occurrenceDate,
            isUrgent,
        },
    });
}

async function createSubstitutionRequestsForCancel(reservation) {
    if (!reservation?.slot) {
        reservation = await prisma.reservation.findUnique({
            where: { id: reservation.id || reservation },
            include: { slot: true },
        });
    }
    if (!reservation?.slot) return [];

    const weekdays = participationWeekdays(reservation);
    const dates = [];
    if (reservation.date) {
        dates.push(reservation.date);
    } else if (weekdays.length) {
        weekdays.forEach((wd) => {
            const today = new Date();
            const js = wd === 7 ? 0 : wd;
            const diff = (js - today.getDay() + 7) % 7;
            const d = new Date(today);
            d.setDate(today.getDate() + diff);
            dates.push(d.toISOString().slice(0, 10));
        });
    }

    const created = [];
    const name = reservation.userName || 'Un adorador';
    for (const dateStr of [...new Set(dates)]) {
        const captains = await findCaptainUsersForOccurrence(dateStr, reservation.slot.startTime);
        for (const { user } of captains) {
            const existing = await prisma.substitutionRequest.findFirst({
                where: {
                    reservationId: reservation.id,
                    occurrenceDate: dateStr,
                    captainUserId: user.id,
                    status: 'pending',
                },
            });
            if (existing) {
                created.push(existing);
                continue;
            }
            const row = await prisma.substitutionRequest.create({
                data: {
                    reservationId: reservation.id,
                    occurrenceDate: dateStr,
                    requestedByName: name,
                    captainUserId: user.id,
                    status: 'pending',
                },
            });
            created.push(row);
        }
    }
    return created;
}

async function notifyCaptainsSubstituteNeeded(reservation) {
    if (!reservation?.slot) {
        reservation = await prisma.reservation.findUnique({
            where: { id: reservation.id || reservation },
            include: { slot: true },
        });
    }
    if (!reservation?.slot) return;

    const weekdays = participationWeekdays(reservation);
    const dates = [];
    if (reservation.date) {
        dates.push(reservation.date);
    } else if (weekdays.length) {
        weekdays.forEach((wd) => {
            const today = new Date();
            const js = wd === 7 ? 0 : wd;
            const diff = (js - today.getDay() + 7) % 7;
            const d = new Date(today);
            d.setDate(today.getDate() + diff);
            dates.push(d.toISOString().slice(0, 10));
        });
    }

    const slotLabel = `${reservation.slot.startTime}–${reservation.slot.endTime}`;
    const name = reservation.userName || 'Un adorador';

    for (const dateStr of [...new Set(dates)]) {
        const captains = await findCaptainUsersForOccurrence(dateStr, reservation.slot.startTime);
        for (const { user, ranges } of captains) {
            await createCaptainNotification({
                captainUserId: user.id,
                captainRangeId: ranges[0]?.id ?? null,
                type: 'substitute_needed',
                title: 'Solicitud de sustituto',
                message: `${name} canceló o necesita sustituto el ${dateStr} a las ${slotLabel}.`,
                slotId: reservation.slotId,
                reservationId: reservation.id,
                occurrenceDate: dateStr,
            });
        }
    }

    await createSubstitutionRequestsForCancel(reservation);
}

async function syncCaptainOpenSlotAlerts(captainUserId, ranges) {
    if (!ranges?.length) return [];

    const today = new Date();
    const horizon = new Date(today);
    horizon.setDate(horizon.getDate() + 7);

    const [allSlots, reservations] = await Promise.all([
        prisma.slot.findMany({ where: { isActive: true }, orderBy: { startTime: 'asc' } }),
        prisma.reservation.findMany({
            where: { status: { in: ['confirmed', 'completed'] } },
            include: { slot: true },
        }),
    ]);

    const created = [];
    for (let d = new Date(today); d <= horizon; d.setDate(d.getDate() + 1)) {
        const dateStr = d.toISOString().slice(0, 10);
        const weekday = weekdayFromDate(dateStr);

        for (const slot of allSlots) {
            if (!slotMatchesCaptainScope(weekday, slot.startTime, ranges)) continue;

            const commitments = reservations.filter(
                (r) => r.slotId === slot.id && commitmentAppliesOn(r, dateStr)
            );
            const taken = commitments.length;
            const open = Math.max(0, slot.capacity - taken);
            if (open <= 0) continue;

            const occurrence = new Date(`${dateStr}T${slot.startTime}:00`);
            const hoursUntil = (occurrence - new Date()) / (1000 * 60 * 60);
            const isUrgent = hoursUntil > 0 && hoursUntil <= 24;

            const notif = await createCaptainNotification({
                captainUserId,
                type: isUrgent ? 'urgent_open' : 'open_slot',
                title: isUrgent ? 'Turno abierto — urgente' : 'Turno con cupo libre',
                message: `${dateStr} ${slot.startTime}–${slot.endTime}: faltan ${open} adorador${open === 1 ? '' : 'es'}.`,
                slotId: slot.id,
                occurrenceDate: dateStr,
                isUrgent,
            });
            created.push(notif);
        }
    }
    return created;
}

module.exports = {
    timeToMinutes,
    timeRangesOverlap,
    daysOverlap,
    captainRangesOverlap,
    findOverlappingCaptainRange,
    formatTimeLabel,
    slotMatchesCaptainScope,
    occurrenceMatchesCaptainScope,
    reservationMatchesCaptainScope,
    filterReservationsForCaptain,
    filterCalendarDaysForCaptain,
    formatCaptainRangeLabel,
    serializeCaptainRange,
    loadActiveCaptainRanges,
    findCaptainUsersForOccurrence,
    createCaptainNotification,
    createSubstitutionRequestsForCancel,
    notifyCaptainsSubstituteNeeded,
    syncCaptainOpenSlotAlerts,
};
