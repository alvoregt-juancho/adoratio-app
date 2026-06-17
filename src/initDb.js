const { execSync } = require('child_process');
const prisma = require('./db');

async function initDatabase() {
    const isSqlite = (process.env.DATABASE_URL || '').startsWith('file:');

    if (isSqlite) {
        console.log('ℹ Sincronizando esquema SQLite (adoratio.db)…');
        execSync('npx prisma db push', { stdio: 'inherit' });
    } else {
        execSync('npx prisma migrate deploy', { stdio: 'inherit' });
    }

    await prisma.$connect();

    const userCount = await prisma.user.count();
    if (userCount === 0) {
        console.log('ℹ Base de datos vacía; ejecutando seed…');
        execSync('node prisma/seed.js', { stdio: 'inherit' });
    }
}

module.exports = { initDatabase };
