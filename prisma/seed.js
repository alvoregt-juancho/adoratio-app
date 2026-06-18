const bcrypt = require('bcryptjs');
const prisma = require('../src/db');
const config = require('../src/config');
const { splitFullName, buildFullName } = require('../src/utils/name');
const {
    ALL_PRIVILEGES,
    ADMIN_PRIVILEGES,
    LECTOR_PRIVILEGES,
} = require('../src/constants/permissions');
const { runDemoSeed } = require('./demoData');

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

    console.log('  ↻ Sembrando datos de demostración…');
    const demo = await runDemoSeed({ adminId: admin.id, wipeFirst: true });
    console.log(`  ✓ ${demo.slots} turnos · ${demo.reservations} compromisos · ${demo.roster} roster · ${demo.intentions} intenciones`);
    if (demo.qrCode) console.log(`  ✓ QR de ejemplo: ${demo.qrCode}`);

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
