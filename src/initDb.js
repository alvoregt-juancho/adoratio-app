const { execSync } = require('child_process');
const prisma = require('./db');
const { PRIV, ALL_PRIVILEGES, ADMIN_PRIVILEGES, LECTOR_PRIVILEGES, CAPTAIN_PRIVILEGES } = require('./constants/permissions');

async function migrateSystemRolePrivileges() {
    const sync = [
        { slug: 'super-admin', privileges: ALL_PRIVILEGES },
        { slug: 'administrador', privileges: ADMIN_PRIVILEGES },
        { slug: 'lector', privileges: LECTOR_PRIVILEGES },
        { slug: 'capitan', privileges: CAPTAIN_PRIVILEGES },
    ];
    for (const def of sync) {
        const role = await prisma.adminRole.findUnique({ where: { slug: def.slug } });
        if (!role || role.privileges === def.privileges) continue;
        await prisma.adminRole.update({
            where: { id: role.id },
            data: { privileges: def.privileges },
        });
        console.log(`ℹ Perfil «${def.slug}» actualizado con privilegios del sistema.`);
    }
}

async function migrateSlotsDeletePrivilege() {
    const roles = await prisma.adminRole.findMany();
    for (const role of roles) {
        if (role.slug === 'capitan' || role.slug === 'lector') continue;
        if ((role.privileges & PRIV.SLOTS_EDIT) && !(role.privileges & PRIV.SLOTS_DELETE)) {
            await prisma.adminRole.update({
                where: { id: role.id },
                data: { privileges: role.privileges | PRIV.SLOTS_DELETE },
            });
        }
    }
}

async function migrateMuroPrivileges() {
    const roles = await prisma.adminRole.findMany();
    for (const role of roles) {
        let privileges = role.privileges;
        let changed = false;
        if (role.slug === 'capitan') continue;
        if ((privileges & PRIV.RESERVATIONS_VIEW) && !(privileges & PRIV.MURO_VIEW)) {
            privileges |= PRIV.MURO_VIEW;
            changed = true;
        }
        if ((privileges & PRIV.RESERVATIONS_CHECKIN) && !(privileges & PRIV.MURO_MANAGE)) {
            privileges |= PRIV.MURO_MANAGE;
            changed = true;
        }
        if (changed) {
            await prisma.adminRole.update({
                where: { id: role.id },
                data: { privileges },
            });
        }
    }
}

async function migrateWhatsAppPrivileges() {
    const roles = await prisma.adminRole.findMany();
    for (const role of roles) {
        if (role.slug === 'capitan' || role.slug === 'lector') continue;
        const isAdminLike =
            role.slug === 'super-admin' ||
            role.slug === 'administrador' ||
            (role.privileges & PRIV.RESERVATIONS_CHECKIN);
        let privileges = role.privileges;
        let changed = false;
        if (isAdminLike && !(privileges & PRIV.WHATSAPP_VIEW)) {
            privileges |= PRIV.WHATSAPP_VIEW;
            changed = true;
        }
        if (isAdminLike && !(privileges & PRIV.WHATSAPP_MANAGE)) {
            privileges |= PRIV.WHATSAPP_MANAGE;
            changed = true;
        }
        if (isAdminLike && !(privileges & PRIV.WHATSAPP_OPERATE)) {
            privileges |= PRIV.WHATSAPP_OPERATE;
            changed = true;
        }
        if (changed) {
            await prisma.adminRole.update({
                where: { id: role.id },
                data: { privileges },
            });
        }
    }
}

async function initDatabase() {
    const isSqlite = (process.env.DATABASE_URL || '').startsWith('file:');

    if (isSqlite) {
        console.log('ℹ Sincronizando esquema SQLite (adoratio.db)…');
        execSync('npx prisma db push', { stdio: 'inherit' });
    } else {
        execSync('npx prisma migrate deploy', { stdio: 'inherit' });
    }

    await prisma.$connect();

    await migrateMuroPrivileges();
    await migrateSlotsDeletePrivilege();
    await migrateWhatsAppPrivileges();
    await migrateSystemRolePrivileges();

    const userCount = await prisma.user.count();
    if (userCount === 0) {
        console.log('ℹ Base de datos vacía; ejecutando seed…');
        execSync('node prisma/seed.js', { stdio: 'inherit' });
    }
}

module.exports = { initDatabase };
