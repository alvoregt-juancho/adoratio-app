const { execSync } = require('child_process');
const prisma = require('./db');
const { PRIV } = require('./constants/permissions');

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

    const userCount = await prisma.user.count();
    if (userCount === 0) {
        console.log('ℹ Base de datos vacía; ejecutando seed…');
        execSync('node prisma/seed.js', { stdio: 'inherit' });
    }
}

module.exports = { initDatabase };
