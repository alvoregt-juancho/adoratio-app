#!/usr/bin/env node
/**
 * Vincula phone_number en users a partir de reservas activas.
 * Ejecutar una vez en producción antes de activar el kiosk:
 *   node scripts/sync-kiosk-users.js
 */
const prisma = require('../src/db');
const { resolveKioskUserByPhone } = require('../src/utils/kioskUser');

async function main() {
    const reservations = await prisma.reservation.findMany({
        where: { status: { in: ['confirmed', 'completed'] } },
        select: { userPhone: true },
    });

    const phones = [...new Set(reservations.map((r) => r.userPhone).filter(Boolean))];
    let synced = 0;

    for (const phone of phones) {
        const user = await resolveKioskUserByPhone(phone);
        if (user) synced += 1;
    }

    console.log(`✔ ${synced} adorador(es) vinculados por celular (de ${phones.length} teléfonos únicos).`);
}

main()
    .catch((e) => {
        console.error(e);
        process.exit(1);
    })
    .finally(() => prisma.$disconnect());
