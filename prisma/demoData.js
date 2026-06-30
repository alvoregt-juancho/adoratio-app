/**
 * Datos de demostración para desarrollo y pruebas del back-office.
 * Usado por prisma/seed.js y por el reset temporal en Auditoría.
 */

const prisma = require('../src/db');
const { buildFullName } = require('../src/utils/name');
const { resolveKioskUserByPhone } = require('../src/utils/kioskUser');

function todayStr(d = new Date()) {
    const y = d.getFullYear();
    const m = String(d.getMonth() + 1).padStart(2, '0');
    const day = String(d.getDate()).padStart(2, '0');
    return `${y}-${m}-${day}`;
}

function weekdayFromDate(dateStr) {
    const [y, m, d] = dateStr.split('-').map(Number);
    const jsDay = new Date(y, m - 1, d).getDay();
    return jsDay === 0 ? 7 : jsDay;
}

function dateForWeekday(targetWeekday, fromDate = new Date()) {
    const today = new Date(fromDate);
    today.setHours(0, 0, 0, 0);
    const current = weekdayFromDate(todayStr(today));
    let diff = Number(targetWeekday) - current;
    if (diff < 0) diff += 7;
    const result = new Date(today);
    result.setDate(today.getDate() + diff);
    return todayStr(result);
}

const { OPERATIONAL_CATEGORY_IDS, wipeSelectedCategories } = require('../src/utils/demoWipe');

async function clearOperationalData() {
    await wipeSelectedCategories(OPERATIONAL_CATEGORY_IDS);
}

async function seedSlots() {
    const slots = [];
    for (let h = 7; h < 20; h++) {
        const start = `${String(h).padStart(2, '0')}:00`;
        const end = `${String(h + 1).padStart(2, '0')}:00`;
        slots.push({ startTime: start, endTime: end, capacity: 4, label: `${start} – ${end}` });
    }
    await prisma.slot.createMany({ data: slots });
    return prisma.slot.findMany({ orderBy: { startTime: 'asc' } });
}

const ADORADORES = [
    { first: 'Unai', last: 'Godoy', phone: '88881234' },
    { first: 'Jorge', last: 'Quintanilla', phone: '70112233' },
    { first: 'Laura', last: 'Jaramillo', phone: '63129832' },
    { first: 'María', last: 'Rodríguez', phone: '88991122' },
    { first: 'Carlos', last: 'Méndez', phone: '88776655' },
    { first: 'Ana', last: 'Solís', phone: '77665544' },
    { first: 'Pedro', last: 'Vargas', phone: '66554433' },
    { first: 'Sofía', last: 'Castro', phone: '55443322' },
    { first: 'Luis', last: 'Herrera', phone: '44332211' },
    { first: 'Elena', last: 'Morales', phone: '33221100' },
    { first: 'Roberto', last: 'Jiménez', phone: '22110099' },
    { first: 'Carmen', last: 'Navarro', phone: '11009988' },
];

async function seedDemoReservations(slots) {
    const byStart = Object.fromEntries(slots.map((s) => [s.startTime, s]));
    const commitments = [
        { person: 0, start: '07:00', weekday: 7, frequency: 'WEEKLY' },
        { person: 1, start: '07:00', weekday: 1, frequency: 'WEEKLY' },
        { person: 2, start: '07:00', weekday: 2, frequency: 'WEEKLY' },
        { person: 3, start: '08:00', weekday: 3, frequency: 'WEEKLY' },
        { person: 4, start: '09:00', weekday: 4, frequency: 'WEEKLY' },
        { person: 5, start: '10:00', weekday: 5, frequency: 'WEEKLY' },
        { person: 6, start: '11:00', weekday: 6, frequency: 'WEEKLY' },
        { person: 7, start: '12:00', weekday: 7, frequency: 'WEEKLY' },
        { person: 8, start: '14:00', weekday: 1, frequency: 'WEEKLY' },
        { person: 9, start: '15:00', weekday: 2, frequency: 'WEEKLY' },
        { person: 0, start: '16:00', weekday: 3, frequency: 'WEEKLY' },
        { person: 1, start: '17:00', weekday: 4, frequency: 'WEEKLY' },
        { person: 2, start: '18:00', weekday: 5, frequency: 'DAILY', weekDays: '1,3,5' },
        { person: 3, start: '08:00', weekday: 2, frequency: 'BIWEEKLY', biweeklyWeeks: '1,3' },
        { person: 4, start: '13:00', weekday: 6, frequency: 'MONTHLY' },
        { person: 5, start: '19:00', weekday: 1, frequency: 'ONCE' },
    ];

    let created = 0;
    for (const c of commitments) {
        const slot = byStart[c.start];
        const person = ADORADORES[c.person];
        if (!slot || !person) continue;

        const anchorWeekday = c.weekday ?? weekdayFromDate(todayStr());
        const date = dateForWeekday(anchorWeekday);

        await prisma.reservation.create({
            data: {
                slotId: slot.id,
                userPhone: person.phone,
                userFirstName: person.first,
                userLastName: person.last,
                userName: buildFullName(person.first, person.last),
                date,
                frequency: c.frequency,
                weekDays: c.weekDays || null,
                biweeklyWeeks: c.biweeklyWeeks || null,
                status: 'confirmed',
            },
        });
        created++;
    }
    return created;
}

async function seedRosterMembers() {
    const members = [
        {
            role: 'captain',
            firstName: 'Juan',
            lastName: 'Castañeda',
            phone: '88880001',
            email: 'capitan7am@ejemplo.com',
            slotTimes: '07:00',
            internalNotes: 'Capitán hora 7 AM — todos los días',
        },
        {
            role: 'captain',
            firstName: 'Rosa',
            lastName: 'Marín',
            phone: '88880002',
            email: 'capitan.lunes@ejemplo.com',
            weekDays: '1',
            internalNotes: 'Capitana del lunes — todas las horas',
        },
        {
            role: 'substitute',
            firstName: 'Miguel',
            lastName: 'Araya',
            phone: '88880003',
            email: 'sustituto@ejemplo.com',
            slotTimes: '07:00,08:00',
            weekDays: '7,1,2',
        },
        {
            role: 'substitute',
            firstName: 'Patricia',
            lastName: 'López',
            phone: '88880004',
            weekDays: '1,3,5',
        },
        {
            role: 'substitute',
            firstName: 'Diego',
            lastName: 'Ramírez',
            phone: '88880005',
            slotTimes: '18:00,19:00',
        },
    ];

    await prisma.rosterMember.createMany({ data: members });
    return members.length;
}

async function seedDemoIntentions() {
    const items = [
        {
            text: 'Por la salud de mi madre enferma',
            displayName: 'Anónimo',
            visibility: 'wall',
            status: 'active',
        },
        {
            text: 'Gracias por las bendiciones recibidas',
            displayName: 'Laura J.',
            userPhone: '63129832',
            visibility: 'wall',
            status: 'active',
        },
        {
            text: 'Por la paz en las familias de la parroquia',
            displayName: 'Feligresía',
            visibility: 'wall',
            status: 'prayed',
        },
    ];
    await prisma.prayerIntention.createMany({ data: items });
    return items.length;
}

async function seedDemoQr(adminId) {
    const { ensureChapelQr } = require('../src/utils/chapelQr');
    const qr = await ensureChapelQr(adminId);
    return qr;
}

async function reloadDemoForCategories(categoryIds, { adminId } = {}) {
    const selected = new Set(categoryIds);
    const counts = {};

    let slots = null;
    const needsSlots = selected.has('slots') || selected.has('reservations');
    if (needsSlots) {
        const existing = await prisma.slot.count();
        if (existing === 0 || selected.has('slots')) {
            slots = await seedSlots();
            counts.slots = slots.length;
        } else {
            slots = await prisma.slot.findMany({ orderBy: { startTime: 'asc' } });
        }
    }

    if (selected.has('reservations') && slots?.length) {
        counts.reservations = await seedDemoReservations(slots);
    }
    if (selected.has('roster')) {
        counts.roster = await seedRosterMembers();
    }
    if (selected.has('intentions')) {
        counts.intentions = await seedDemoIntentions();
    }
    if (selected.has('qrs') && adminId) {
        const qr = await seedDemoQr(adminId);
        counts.qrCode = qr?.qrCode ?? null;
    }
    if (selected.has('reservations')) {
        counts.kioskUsers = await syncKioskUsersFromReservations();
    }

    return counts;
}

async function runDemoSeed({ adminId, wipeFirst = true, categories = null, reloadDemo = true } = {}) {
    const wipeCategories = categories ?? OPERATIONAL_CATEGORY_IDS;
    let wipeResult = null;

    if (wipeFirst) {
        wipeResult = await wipeSelectedCategories(wipeCategories, { excludeUserId: adminId });
    }

    const seedCounts = reloadDemo
        ? await reloadDemoForCategories(wipeCategories, { adminId })
        : {};

    return {
        wiped: wipeResult?.deleted ?? null,
        categories: wipeResult?.categoryIds ?? wipeCategories,
        ...seedCounts,
    };
}

async function syncKioskUsersFromReservations() {
    const reservations = await prisma.reservation.findMany({
        where: { status: { in: ['confirmed', 'completed'] } },
        select: { userPhone: true, userFirstName: true, userLastName: true, userName: true },
    });
    const phones = new Set();
    let count = 0;
    for (const r of reservations) {
        if (!r.userPhone || phones.has(r.userPhone)) continue;
        phones.add(r.userPhone);
        const user = await resolveKioskUserByPhone(r.userPhone);
        if (user) count += 1;
    }
    return count;
}

module.exports = {
    todayStr,
    dateForWeekday,
    clearOperationalData,
    seedSlots,
    reloadDemoForCategories,
    runDemoSeed,
};
