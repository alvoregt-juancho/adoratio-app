#!/usr/bin/env node
/**
 * Verify Cristiano — Super Admin asigna passwords a administradores
 * Ejecutar: node scripts/verify-admin-set-password.js
 */
const fs = require('fs');
const path = require('path');
const bcrypt = require('bcryptjs');

const root = path.join(__dirname, '..');
let passed = 0;
let failed = 0;

function ok(label) {
    passed += 1;
    console.log(`  ✓ ${label}`);
}
function fail(label, detail) {
    failed += 1;
    console.log(`  ✗ ${label}${detail ? ` — ${detail}` : ''}`);
}
function read(rel) {
    return fs.readFileSync(path.join(root, rel), 'utf8');
}

const TEST_EMAIL = 'verify-setpwd@adoratio.test';

async function main() {
    console.log('\n=== Verify Cristiano — Asignar password (Super Admin) ===\n');

    console.log('1. Código');
    const api = read('src/routes/rbac.js');
    const html = read('public/admin.html');
    const js = read('public/admin.js');
    [
        [api.includes("/users/:id/password"), 'Ruta PUT /users/:id/password'],
        [api.includes('Solo Super Admin puede asignar contraseñas'), 'Gate Super Admin en API'],
        [api.includes('user.password.set'), 'Audit user.password.set'],
        [html.includes('adminPasswordSheet'), 'Modal HTML'],
        [html.includes('adminPasswordSaveBtn'), 'Botón guardar'],
        [js.includes('openAdminPasswordSheet'), 'JS open sheet'],
        [js.includes('saveAdminPassword'), 'JS save'],
        [js.includes('data-set-password'), 'Botón Contraseña en tabla'],
        [js.includes('/password'), 'Llama API password'],
    ].forEach(([cond, label]) => (cond ? ok(label) : fail(label)));

    console.log('\n2. Runtime hash + update');
    const prisma = require('../src/db');
    try {
        const existing = await prisma.user.findUnique({ where: { email: TEST_EMAIL } });
        if (existing) await prisma.user.delete({ where: { id: existing.id } });

        const role = await prisma.adminRole.findFirst({ where: { slug: 'super-admin' } })
            || await prisma.adminRole.findFirst();
        if (!role) {
            fail('Sin AdminRole en DB');
        } else {
            const user = await prisma.user.create({
                data: {
                    name: 'Verify SetPwd',
                    email: TEST_EMAIL,
                    passwordHash: await bcrypt.hash('oldpass1', 10),
                    role: 'lector',
                    adminRoleId: role.id,
                    emailVerified: true,
                },
            });
            ok('Usuario de prueba creado');

            const newHash = await bcrypt.hash('nuevaClave99', 10);
            await prisma.user.update({ where: { id: user.id }, data: { passwordHash: newHash } });
            const refreshed = await prisma.user.findUnique({ where: { id: user.id } });
            const matches = await bcrypt.compare('nuevaClave99', refreshed.passwordHash);
            const oldFails = !(await bcrypt.compare('oldpass1', refreshed.passwordHash));
            if (matches) ok('Nueva contraseña válida');
            else fail('Nueva contraseña no hace match');
            if (oldFails) ok('Contraseña anterior invalidada');
            else fail('Contraseña anterior aún válida');

            await prisma.user.delete({ where: { id: user.id } });
            ok('Limpieza usuario de prueba');
        }
    } catch (e) {
        fail('Runtime', e.message);
    }

    console.log(
        '\n' +
            (failed ? `RESULTADO: ${failed} fallo(s), ${passed} OK` : `RESULTADO: OK (${passed})`) +
            '\n'
    );
    process.exit(failed ? 1 : 0);
}

main().catch((e) => {
    console.error(e);
    process.exit(1);
});
