const bcrypt = require('bcryptjs');
const prisma = require('../src/db');
const config = require('../src/config');
const { splitFullName, buildFullName } = require('../src/utils/name');
const {
    ALL_PRIVILEGES,
    ADMIN_PRIVILEGES,
    LECTOR_PRIVILEGES,
} = require('../src/constants/permissions');

const SYSTEM_ROLES = [
    {
        name: 'Super Admin',
        slug: 'super-admin',
        description: 'Control total del back-office. Gestiona perfiles, permisos y auditoría.',
        privileges: ALL_PRIVILEGES,
        isSystem: true,
    },
    {
        name: 'Administrador',
        slug: 'administrador',
        description: 'Gestión operativa: turnos, reservas y QR.',
        privileges: ADMIN_PRIVILEGES,
        isSystem: true,
    },
    {
        name: 'Lector',
        slug: 'lector',
        description: 'Solo lectura y exportación de reportes.',
        privileges: LECTOR_PRIVILEGES,
        isSystem: true,
    },
];

async function seedRoles() {
    const roles = {};
    for (const def of SYSTEM_ROLES) {
        const role = await prisma.adminRole.upsert({
            where: { slug: def.slug },
            update: {
                name: def.name,
                description: def.description,
                privileges: def.privileges,
                isSystem: def.isSystem,
            },
            create: def,
        });
        roles[def.slug] = role;
    }
    return roles;
}

async function main() {
    console.log('▶ Sembrando datos iniciales…');

    const roles = await seedRoles();
    console.log(`  ✓ ${Object.keys(roles).length} perfiles RBAC de sistema`);

    const passwordHash = await bcrypt.hash(config.admin.password, 10);
    const admin = await prisma.user.upsert({
        where: { email: config.admin.email },
        update: {
            role: 'superadmin',
            passwordHash,
            emailVerified: true,
            adminRoleId: roles['super-admin'].id,
        },
        create: {
            name: config.admin.name,
            email: config.admin.email,
            passwordHash,
            role: 'superadmin',
            emailVerified: true,
            adminRoleId: roles['super-admin'].id,
        },
    });
    console.log(`  ✓ Admin: ${admin.email} → ${roles['super-admin'].name}`);

    console.log('  ↻ Actualizando plantilla de turnos (7:00–20:00, lun–vie)…');
    await prisma.scanLog.deleteMany();
    await prisma.auditLog.deleteMany();
    await prisma.reservation.deleteMany();
    await prisma.slot.deleteMany();

    const slots = [];
    for (let h = 7; h < 20; h++) {
        const start = `${String(h).padStart(2, '0')}:00`;
        const end = `${String(h + 1).padStart(2, '0')}:00`;
        slots.push({ startTime: start, endTime: end, capacity: 4, label: `${start} – ${end}` });
    }
    await prisma.slot.createMany({ data: slots });
    console.log(`  ✓ ${slots.length} turnos creados (7:00–20:00)`);

    await prisma.settings.upsert({
        where: { id: 1 },
        update: {},
        create: {
            id: 1,
            freqOnceEnabled: true,
            freqDailyEnabled: true,
            freqWeeklyEnabled: true,
            freqBiweeklyEnabled: true,
            freqMonthlyEnabled: true,
            allowOffsetStartTimes: true,
            allowThirtyMinuteDurations: true,
        },
    });
    console.log('  ✓ Configuración global (Settings) inicializada');

    const existingQr = await prisma.physicalQR.count();
    if (existingQr === 0) {
        const qr = await prisma.physicalQR.create({
            data: {
                qrCode: generateQrCodeId(),
                displayName: 'Entrada Principal',
                location: 'Puerta principal de la capilla',
                isActive: true,
                generatedBy: admin.id,
            },
        });
        console.log(`  ✓ QR de ejemplo: ${qr.qrCode}`);
    } else {
        console.log(`  • ${existingQr} QR ya existen, se omite`);
    }

    // Migrar usuarios legacy sin adminRoleId
    const legacyMap = {
        superadmin: roles['super-admin'].id,
        admin: roles['administrador'].id,
        lector: roles['lector'].id,
    };
    for (const [legacyRole, roleId] of Object.entries(legacyMap)) {
        await prisma.user.updateMany({
            where: { role: legacyRole, adminRoleId: null },
            data: { adminRoleId: roleId },
        });
    }

    // Migrar nombres completos → nombre + apellido en reservas existentes
    const reservations = await prisma.reservation.findMany({
        where: { OR: [{ userFirstName: '' }, { userLastName: '' }] },
    });
    for (const r of reservations) {
        const { first, last } = splitFullName(r.userName);
        await prisma.reservation.update({
            where: { id: r.id },
            data: {
                userFirstName: first,
                userLastName: last,
                userName: buildFullName(first, last) || r.userName,
            },
        });
    }
    if (reservations.length) {
        console.log(`  ✓ ${reservations.length} reservas migradas a nombre/apellido`);
    }

    console.log('✔ Seed completado.');
}

main()
    .catch((e) => {
        console.error('✖ Error en seed:', e);
        process.exit(1);
    })
    .finally(async () => {
        await prisma.$disconnect();
    });
