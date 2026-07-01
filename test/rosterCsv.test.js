const test = require('node:test');
const assert = require('node:assert/strict');
const { parseCsvText, parseCommitmentImportRow, getRosterTemplate } = require('../src/utils/rosterCsv');

test('parseCsvText reads headers and rows', () => {
    const { headers, rows } = parseCsvText('nombre,celular\nAna,88881234');
    assert.deepEqual(headers, ['nombre', 'celular']);
    assert.equal(rows.length, 1);
    assert.equal(rows[0].cells[0], 'Ana');
});

test('parseCommitmentImportRow validates weekday and phone', () => {
    const headers = ['dia', 'hora', 'duracion_minutos', 'frecuencia', 'nombre', 'apellido', 'celular'];
    const ok = parseCommitmentImportRow({ rowNumber: 2, cells: ['lunes', '7:00 AM', '60', 'Semanal', 'María', 'López', '88881234'] }, headers);
    assert.equal(ok.firstName, 'María');
    assert.equal(ok.weekday, 1);
    assert.equal(ok.slotTime, '07:00');

    const bad = parseCommitmentImportRow({ rowNumber: 3, cells: ['', '7:00 AM', '60', 'Semanal', 'María', 'López', '88881234'] }, headers);
    assert.ok(bad.error);
});

test('getRosterTemplate includes bom and headers', () => {
    const tpl = getRosterTemplate('commitments');
    assert.ok(tpl.content.startsWith('\uFEFF'));
    assert.ok(tpl.content.includes('dia,hora,duracion_minutos'));
});
