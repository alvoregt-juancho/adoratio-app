#!/usr/bin/env node
/**
 * Verify Cristiano — sesión AdoraHora
 * Favicon, directorio, import Excel (celular opcional + horas),
 * turnos prioritarios semanales, huecos de 30 min.
 *
 * Ejecutar: node scripts/verify-adorahora-session.js
 */
const fs = require('fs');
const path = require('path');

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
function expect(cond, label, detail) {
    if (cond) ok(label);
    else fail(label, detail);
}
function read(rel) {
    return fs.readFileSync(path.join(root, rel), 'utf8');
}
function exists(rel) {
    return fs.existsSync(path.join(root, rel));
}

async function main() {
    console.log('\n=== Verify Cristiano — AdoraHora (favicon · directorio · import · prioridad · gaps) ===\n');

    console.log('1. Favicon');
    [
        'public/favicon.ico',
        'public/favicon-16x16.png',
        'public/favicon-32x32.png',
        'public/favicon.png',
        'public/apple-touch-icon.png',
    ].forEach((f) => expect(exists(f), f));
    ['public/index.html', 'public/admin.html', 'public/horarios.html', 'public/scan.html', 'public/chapel-registro-7f3c2a1b.html']
        .forEach((f) => {
            const html = read(f);
            expect(html.includes('rel="icon"') && html.includes('favicon'), `${f} enlaza favicon`);
        });

    console.log('\n2. Directorio — formatWeekDays importado');
    const adminRoute = read('src/routes/admin.js');
    expect(adminRoute.includes("require('../utils/weekDays')"), 'Import formatWeekDays desde weekDays');
    expect(/formatWeekDays\(\[\.\.\.a\.weekdays\]\.join/.test(adminRoute), 'Directorio usa formatWeekDays');
    expect(adminRoute.includes('byKey') || adminRoute.includes("name:${"), 'Directorio agrupa también sin celular');

    console.log('\n3. Import — celular opcional + Excel horas');
    const rosterCsv = read('src/utils/rosterCsv.js');
    const adminRes = read('src/utils/adminReservation.js');
    const rosterExcel = read('src/utils/rosterExcel.js');
    const rosterImport = read('src/utils/rosterImport.js');
    expect(rosterCsv.includes('Celular opcional') || rosterCsv.includes('phone && !isValidPhone'), 'parseCommitmentImportRow permite celular vacío');
    expect(adminRes.includes('Turno y nombre son requeridos'), 'createAdminReservation no exige celular');
    expect(adminRes.includes('userPhone && !isValidPhone'), 'Valida celular solo si viene');
    expect(rosterExcel.includes('parseRosterExcelWithZip') || rosterExcel.includes('JSZip'), 'Parser ZIP/XML para xlsx');
    expect(rosterExcel.includes('excelFractionToTime') || rosterExcel.includes('excelFraction'), 'Convierte horas serial Excel');
    expect(rosterImport.includes('userPhone: \'\'') || rosterImport.includes('userFirstName: parsed.firstName'), 'Duplicados sin teléfono por nombre');
    expect(adminRoute.includes('los anteriores se conservan'), 'Mensaje import no destructivo');

    const { parseCommitmentImportRow } = require('../src/utils/rosterCsv');
    const headers = ['dia', 'hora', 'duracion_minutos', 'frecuencia', 'nombre', 'apellido', 'celular'];
    const noPhone = parseCommitmentImportRow(
        { rowNumber: 4, cells: ['lunes', '8:00 AM', '60', 'Semanal', 'Ana', 'Pérez', ''] },
        headers,
    );
    expect(!noPhone.error && noPhone.phone === '', 'Runtime: import sin celular OK', noPhone.error);
    const badPhone = parseCommitmentImportRow(
        { rowNumber: 5, cells: ['lunes', '8:00 AM', '60', 'Semanal', 'Ana', 'Pérez', '12'] },
        headers,
    );
    expect(Boolean(badPhone.error), 'Runtime: celular inválido sigue fallando');

    console.log('\n4. Timeline gaps 30 min');
    const { checkTimelineGaps, GAP_STATUS } = require('../src/utils/timeline');
    expect(checkTimelineGaps([]) === GAP_STATUS.EMPTY, 'Hora vacía → EMPTY');
    expect(
        checkTimelineGaps([{ startTimeOffset: 0, durationMinutes: 60 }]) === GAP_STATUS.COVERED,
        'Hora de 60 min → COVERED',
    );
    expect(
        checkTimelineGaps([{ startTimeOffset: 0, durationMinutes: 30 }]) === GAP_STATUS.CRITICAL_GAP,
        'Solo 1ª media hora → CRITICAL_GAP',
    );
    expect(
        checkTimelineGaps([{ startTimeOffset: 30, durationMinutes: 30 }]) === GAP_STATUS.CRITICAL_GAP,
        'Solo 2ª media hora → CRITICAL_GAP',
    );
    const adminJs = read('public/admin.js');
    expect(adminJs.includes('Hora completa sin custodia'), 'UI distingue hora vacía de hueco 30 min');
    expect(adminJs.includes('return "EMPTY"'), 'admin.js checkTimelineGaps conoce EMPTY');

    console.log('\n5. Turnos prioritarios semanales');
    expect(exists('src/utils/prioritySlots.js'), 'prioritySlots.js existe');
    const slotsRoute = read('src/routes/slots.js');
    const priorityUtil = read('src/utils/prioritySlots.js');
    const indexHtml = read('public/index.html');
    expect(slotsRoute.includes("/priority"), 'Ruta GET /api/slots/priority');
    expect(slotsRoute.includes('commitmentAppliesOn'), 'Slots usan commitmentAppliesOn');
    expect(adminRoute.includes('priorityWeek') && adminRoute.includes('buildPriorityWeek'), 'Timeline admin incluye priorityWeek');
    expect(priorityUtil.includes('selectPrioritySlots') && priorityUtil.includes('PRIORITY_TIERS'), 'Cascada 0→1→2');
    expect(indexHtml.includes('/api/slots/priority'), 'App home consume /api/slots/priority');
    expect(adminJs.includes('Turnos prioritarios') && adminJs.includes('priorityWeek'), 'Admin timeline renderiza prioridad semanal');

    const { selectPrioritySlots } = require('../src/utils/prioritySlots');
    const sample = [
        { date: '2026-07-21', startTime: '10:00', reserved: 2 },
        { date: '2026-07-22', startTime: '09:00', reserved: 1 },
        { date: '2026-07-23', startTime: '08:00', reserved: 0 },
        { date: '2026-07-24', startTime: '11:00', reserved: 0 },
    ];
    const p0 = selectPrioritySlots(sample, { max: 10 });
    expect(p0.tier === 0 && p0.totalInTier === 2, 'Cascada elige tier 0 si existe');
    const p1 = selectPrioritySlots(sample.filter((s) => s.reserved > 0), { max: 10 });
    expect(p1.tier === 1 && p1.totalInTier === 1, 'Cascada cae a tier 1 si no hay 0');
    const p2 = selectPrioritySlots(sample.filter((s) => s.reserved === 2), { max: 10 });
    expect(p2.tier === 2, 'Cascada cae a tier 2 si solo hay 2');

    console.log('\n6. Tests unitarios relacionados');
    const { spawnSync } = require('child_process');
    // Evitar buildRosterTemplateBuffer (ExcelJS puede colgarse en este entorno).
    const unit = spawnSync(
        process.execPath,
        [
            '--test',
            '--test-name-pattern=hora |ambas |solo |parseCsv|parseCommitment|shouldSkip|findCsv',
            'test/timeline.test.js',
            'test/rosterCsv.test.js',
        ],
        { cwd: root, encoding: 'utf8', timeout: 15000 },
    );
    if (unit.status === 0) ok('node --test timeline + rosterCsv (sin ExcelJS)');
    else fail('node --test', (unit.stderr || unit.stdout || '').slice(0, 240));

    console.log(
        '\n' +
            (failed ? `RESULTADO: ${failed} fallo(s), ${passed} OK` : `RESULTADO: OK (${passed})`) +
            '\n',
    );
    process.exit(failed ? 1 : 0);
}

main().catch((e) => {
    console.error(e);
    process.exit(1);
});
