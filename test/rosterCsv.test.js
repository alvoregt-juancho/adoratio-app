const test = require('node:test');
const assert = require('node:assert/strict');
const { parseCsvText, parseCommitmentImportRow, shouldSkipImportRow, findCsvHeaderIndex } = require('../src/utils/rosterCsv');
const { buildRosterTemplateBuffer, parseRosterExcel } = require('../src/utils/rosterExcel');

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

    const noPhone = parseCommitmentImportRow(
        { rowNumber: 4, cells: ['lunes', '7:00 AM', '60', 'Semanal', 'Ana', 'Pérez', ''] },
        headers,
    );
    assert.equal(noPhone.firstName, 'Ana');
    assert.equal(noPhone.phone, '');
    assert.equal(noPhone.error, undefined);

    const badPhone = parseCommitmentImportRow(
        { rowNumber: 5, cells: ['lunes', '7:00 AM', '60', 'Semanal', 'Ana', 'Pérez', '123'] },
        headers,
    );
    assert.ok(badPhone.error);
});

test('shouldSkipImportRow ignores example and instruction rows', () => {
    const headers = ['dia', 'hora', 'duracion_minutos', 'frecuencia', 'nombre', 'apellido', 'celular', 'dias_extra', 'notas'];
    assert.equal(
        shouldSkipImportRow(headers, ['viernes', '8:00 AM', '60', 'Semanal', 'María', 'García', '88881234', '', 'Fila de ejemplo — no modificar']),
        true,
    );
    assert.equal(
        shouldSkipImportRow(headers, ['Instrucciones: algo']),
        true,
    );
    assert.equal(
        shouldSkipImportRow(headers, ['viernes', '8:00 AM', '60', 'Semanal', 'Pedro', 'López', '88889999', '', '']),
        false,
    );
});

test('findCsvHeaderIndex locates header after preamble', () => {
    const lines = [
        'Instrucciones: borrar',
        'dia,hora,duracion_minutos,frecuencia,nombre,apellido,celular',
        'lunes,7:00 AM,60,Semanal,Ana,López,88881234',
    ];
    assert.equal(findCsvHeaderIndex(lines), 1);
});

test('buildRosterTemplateBuffer creates parseable xlsx', async () => {
    const buffer = await buildRosterTemplateBuffer('commitments');
    assert.ok(buffer);
    assert.ok(buffer.byteLength > 500);
    const parsed = await parseRosterExcel(Buffer.from(buffer));
    assert.ok(parsed.headers.includes('dia'));
    assert.ok(parsed.headers.includes('hora'));
    assert.equal(parsed.rows.length, 1);
    assert.equal(shouldSkipImportRow(parsed.headers, parsed.rows[0].cells), true);
});
