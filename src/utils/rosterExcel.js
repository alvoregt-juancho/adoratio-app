const ExcelJS = require('exceljs');
const { parseCsvLine, shouldSkipImportRow, findCsvHeaderIndex } = require('./rosterCsv');

const HEADER_FILL = {
    type: 'pattern',
    pattern: 'solid',
    fgColor: { argb: 'FF1C1C1E' },
};
const HEADER_FONT = { bold: true, color: { argb: 'FFFFFFFF' }, size: 11 };
const EXAMPLE_FILL = {
    type: 'pattern',
    pattern: 'solid',
    fgColor: { argb: 'FFF5F0E8' },
};
const INSTR_FONT = { size: 11 };
const DATA_SHEET = 'Datos';
const INSTR_SHEET = 'Instrucciones';

const TEMPLATES = {
    commitments: {
        filename: 'plantilla-turnos-adoracion.xlsx',
        headers: ['dia', 'hora', 'duracion_minutos', 'frecuencia', 'nombre', 'apellido', 'celular', 'dias_extra', 'notas'],
        widths: [14, 12, 18, 14, 16, 16, 14, 14, 28],
        example: ['viernes', '8:00 AM', 60, 'Semanal', 'María', 'García', '88881234', '', 'Fila de ejemplo — no modificar'],
        instructions: [
            ['Plantilla — Turnos de adoración'],
            [''],
            ['Cómo usar esta plantilla'],
            ['1. Vaya a la hoja «Datos».'],
            ['2. Escriba sus registros desde la fila 3 en adelante (la fila 2 es solo un ejemplo).'],
            ['3. Guarde el archivo y cárguelo en Turnos → Lista → Cargar CSV/Excel.'],
            [''],
            ['Columnas'],
            ['• dia — lunes, martes, miércoles, jueves, viernes, sábado o domingo'],
            ['• hora — formato 7:00 AM o 08:00'],
            ['• duracion_minutos — 30 o 60'],
            ['• frecuencia — Semanal, Diario, Quincenal, Mensual o Una sola vez'],
            ['• dias_extra — solo para Diario (ej. lunes,miércoles,viernes)'],
            [''],
            ['Importante'],
            ['• La importación solo agrega registros nuevos; no borra ni modifica los existentes.'],
            ['• Si un adorador ya tiene el mismo turno y día, esa fila se omite.'],
            ['• Las filas con errores se reportan sin afectar las demás.'],
        ],
    },
    captains: {
        filename: 'plantilla-capitanes.xlsx',
        headers: ['nombre', 'apellido', 'celular', 'correo', 'dias', 'horas', 'notas'],
        widths: [16, 16, 14, 24, 18, 18, 28],
        example: ['Juan', 'Pérez', '88880001', 'correo@ejemplo.com', 'viernes', '8:00 AM', 'Fila de ejemplo — no modificar'],
        instructions: [
            ['Plantilla — Contactos capitanes'],
            [''],
            ['Directorio de contacto (llamar/WhatsApp). No da acceso al panel.'],
            ['Complete la hoja «Datos» desde la fila 3. La fila 2 es un ejemplo.'],
            [''],
            ['• dias y horas vacíos = todos los días/horas'],
            ['• Varios días u horas separados por coma'],
            ['• La importación solo agrega contactos nuevos; no borra existentes.'],
            ['• Si el celular ya está registrado como capitán, la fila se omite.'],
        ],
    },
    substitutes: {
        filename: 'plantilla-sustitutos.xlsx',
        headers: ['nombre', 'apellido', 'celular', 'correo', 'dias', 'horas', 'notas'],
        widths: [16, 16, 14, 24, 18, 18, 28],
        example: ['Ana', 'López', '88880002', '', 'sábado', '9:00 AM', 'Fila de ejemplo — no modificar'],
        instructions: [
            ['Plantilla — Sustitutos'],
            [''],
            ['Complete la hoja «Datos» desde la fila 3. La fila 2 es un ejemplo.'],
            [''],
            ['• dias y horas vacíos = todos los días/horas'],
            ['• La importación solo agrega sustitutos nuevos; no borra existentes.'],
            ['• Si el celular ya está registrado, la fila se omite.'],
        ],
    },
};

function styleHeaderRow(sheet, colCount) {
    const row = sheet.getRow(1);
    row.height = 22;
    for (let c = 1; c <= colCount; c += 1) {
        const cell = row.getCell(c);
        cell.fill = HEADER_FILL;
        cell.font = HEADER_FONT;
        cell.alignment = { vertical: 'middle', horizontal: 'center', wrapText: true };
        cell.border = {
            bottom: { style: 'thin', color: { argb: 'FFE0D8CC' } },
        };
    }
}

function styleExampleRow(sheet, colCount) {
    const row = sheet.getRow(2);
    for (let c = 1; c <= colCount; c += 1) {
        const cell = row.getCell(c);
        cell.fill = EXAMPLE_FILL;
        cell.font = { italic: true, color: { argb: 'FF6B6560' } };
    }
}

async function buildRosterTemplateBuffer(section) {
    const def = TEMPLATES[section];
    if (!def) return null;

    const wb = new ExcelJS.Workbook();
    wb.creator = 'Adoratio';
    wb.created = new Date();

    const instr = wb.addWorksheet(INSTR_SHEET);
    instr.properties.defaultColWidth = 90;
    def.instructions.forEach((line, i) => {
        const row = instr.getRow(i + 1);
        row.getCell(1).value = line[0];
        row.getCell(1).font = i === 0 ? { bold: true, size: 14 } : INSTR_FONT;
        row.getCell(1).alignment = { wrapText: true, vertical: 'top' };
    });
    instr.mergeCells(1, 1, 1, 4);

    const data = wb.addWorksheet(DATA_SHEET);
    data.views = [{ state: 'frozen', ySplit: 1 }];
    def.headers.forEach((h, i) => {
        data.getCell(1, i + 1).value = h;
        data.getColumn(i + 1).width = def.widths[i] || 14;
    });
    styleHeaderRow(data, def.headers.length);

    def.example.forEach((val, i) => {
        data.getCell(2, i + 1).value = val;
    });
    styleExampleRow(data, def.headers.length);

    for (let r = 3; r <= 50; r += 1) {
        for (let c = 1; c <= def.headers.length; c += 1) {
            data.getCell(r, c).border = {
                bottom: { style: 'hair', color: { argb: 'FFE8E4DC' } },
            };
        }
    }

    return wb.xlsx.writeBuffer();
}

function normalizeHeaderCell(value) {
    return String(value || '').trim().toLowerCase();
}

function rowValuesToCells(row) {
    const cells = [];
    row.eachCell({ includeEmpty: true }, (cell, colNumber) => {
        while (cells.length < colNumber - 1) cells.push('');
        let v = cell.value;
        if (v && typeof v === 'object' && v.text != null) v = v.text;
        if (v instanceof Date) {
            v = v.toISOString().slice(0, 10);
        }
        cells[colNumber - 1] = v == null ? '' : String(v).trim();
    });
    return cells;
}

function findExcelHeaderRow(sheet) {
    let found = null;
    sheet.eachRow({ includeEmpty: false }, (row, rowNumber) => {
        if (found) return;
        const cells = rowValuesToCells(row).map(normalizeHeaderCell);
        if (cells.includes('dia') && cells.includes('hora')) {
            found = { rowNumber, headers: cells };
        } else if (cells.includes('nombre') && cells.includes('celular')) {
            found = { rowNumber, headers: cells };
        }
    });
    return found;
}

async function parseRosterExcel(buffer) {
    const wb = new ExcelJS.Workbook();
    await wb.xlsx.load(buffer);

    let sheet = wb.getWorksheet(DATA_SHEET);
    if (!sheet) {
        sheet = wb.worksheets.find((ws) => findExcelHeaderRow(ws)) || wb.worksheets[0];
    }
    if (!sheet) return { headers: [], rows: [] };

    const headerInfo = findExcelHeaderRow(sheet);
    if (!headerInfo) return { headers: [], rows: [] };

    const { headers, rowNumber: headerRowNum } = headerInfo;
    const rows = [];
    sheet.eachRow({ includeEmpty: false }, (row, rowNumber) => {
        if (rowNumber <= headerRowNum) return;
        const cells = rowValuesToCells(row);
        while (cells.length < headers.length) cells.push('');
        rows.push({ rowNumber, cells: cells.slice(0, headers.length) });
    });
    return { headers, rows };
}

function parseCsvTextForImport(text) {
    const normalized = String(text || '').replace(/^\uFEFF/, '').trim();
    if (!normalized) return { headers: [], rows: [] };
    const lines = normalized.split(/\r?\n/).filter((l) => l.trim().length > 0);
    if (!lines.length) return { headers: [], rows: [] };

    const headerIdx = findCsvHeaderIndex(lines);
    const headers = parseCsvLine(lines[headerIdx]).map((h) => h.toLowerCase());
    const rows = lines.slice(headerIdx + 1).map((line, index) => ({
        rowNumber: headerIdx + index + 2,
        cells: parseCsvLine(line),
    }));
    return { headers, rows };
}

function getRosterTemplateMeta(section) {
    const def = TEMPLATES[section];
    if (!def) return null;
    return { filename: def.filename, section };
}

module.exports = {
    buildRosterTemplateBuffer,
    parseRosterExcel,
    parseCsvTextForImport,
    getRosterTemplateMeta,
    DATA_SHEET,
    INSTR_SHEET,
};
