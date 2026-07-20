const JSZip = require('jszip');
const { parseCsvLine, shouldSkipImportRow, findCsvHeaderIndex } = require('./rosterCsv');
const { minutesToTime24 } = require('./timeFormat');

function getExcelJS() {
    // Carga diferida: require('exceljs') a veces se bloquea si hay procesos colgados.
    return require('exceljs');
}

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
            ['• hora — formato 7:00 AM o 08:00 (mejor como texto para que Excel no la convierta)'],
            ['• duracion_minutos — 30 o 60'],
            ['• frecuencia — Semanal, Diario, Quincenal, Mensual o Una sola vez'],
            ['• celular — opcional por ahora (8 dígitos si se indica)'],
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

    const ExcelJS = getExcelJS();
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

/** Excel guarda horas como fracción del día (0.333… = 08:00). */
function excelFractionToTime(n) {
    const totalMinutes = Math.round(Number(n) * 24 * 60);
    if (!Number.isFinite(totalMinutes) || totalMinutes < 0) return null;
    return minutesToTime24(((totalMinutes % (24 * 60)) + (24 * 60)) % (24 * 60));
}

function looksLikeExcelTimeDate(d) {
    if (!(d instanceof Date) || Number.isNaN(d.getTime())) return false;
    const y = d.getFullYear();
    // ExcelJS suele mapear horas “solo tiempo” a 1899-12-30 / 1900-01-01.
    return y <= 1901;
}

function cellValueToString(value) {
    let v = value;
    if (v && typeof v === 'object' && v.text != null) v = v.text;
    if (v && typeof v === 'object' && v.result != null) v = v.result;
    if (v && typeof v === 'object' && Array.isArray(v.richText)) {
        v = v.richText.map((t) => t.text || '').join('');
    }
    if (typeof v === 'number') {
        if (v >= 0 && v < 1) {
            const asTime = excelFractionToTime(v);
            if (asTime) return asTime;
        }
        // Celulares largos a veces llegan como número.
        if (Number.isInteger(v) && v >= 1e7 && v < 1e12) return String(Math.trunc(v));
        return String(v);
    }
    if (v instanceof Date) {
        if (looksLikeExcelTimeDate(v)) {
            return minutesToTime24(v.getHours() * 60 + v.getMinutes());
        }
        return v.toISOString().slice(0, 10);
    }
    return v == null ? '' : String(v).trim();
}

function rowValuesToCells(row) {
    const cells = [];
    row.eachCell({ includeEmpty: true }, (cell, colNumber) => {
        while (cells.length < colNumber - 1) cells.push('');
        cells[colNumber - 1] = cellValueToString(cell.value);
    });
    return cells;
}

function headerMatch(cells) {
    const normalized = cells.map(normalizeHeaderCell);
    if (normalized.includes('dia') && normalized.includes('hora')) return normalized;
    if (normalized.includes('nombre') && normalized.includes('celular')) return normalized;
    return null;
}

function findExcelHeaderRow(sheet) {
    let found = null;
    sheet.eachRow({ includeEmpty: false }, (row, rowNumber) => {
        if (found) return;
        const headers = headerMatch(rowValuesToCells(row));
        if (headers) found = { rowNumber, headers };
    });
    return found;
}

function decodeXmlEntities(s) {
    return String(s || '')
        .replace(/&amp;/g, '&')
        .replace(/&lt;/g, '<')
        .replace(/&gt;/g, '>')
        .replace(/&quot;/g, '"')
        .replace(/&#(\d+);/g, (_, n) => String.fromCharCode(Number(n)));
}

function parseSharedStrings(xml) {
    const strings = [];
    for (const m of String(xml || '').matchAll(/<si>([\s\S]*?)<\/si>/g)) {
        const texts = [...m[1].matchAll(/<t[^>]*>([\s\S]*?)<\/t>/g)].map((x) => decodeXmlEntities(x[1]));
        strings.push(texts.join(''));
    }
    return strings;
}

function colLettersToIndex(letters) {
    let n = 0;
    for (const ch of String(letters || '').toUpperCase()) {
        n = n * 26 + (ch.charCodeAt(0) - 64);
    }
    return Math.max(0, n - 1);
}

function parseSheetRows(xml, sharedStrings) {
    const rows = new Map();
    for (const rm of String(xml || '').matchAll(/<row r="(\d+)"[^>]*>([\s\S]*?)<\/row>/g)) {
        const rowNumber = Number(rm[1]);
        const cells = [];
        for (const cm of rm[2].matchAll(/<c r="([A-Z]+)(\d+)"([^>]*)>(?:<v>([\s\S]*?)<\/v>)?<\/c>/g)) {
            const col = colLettersToIndex(cm[1]);
            const attrs = cm[3] || '';
            const raw = cm[4];
            let val = '';
            if (raw != null) {
                if (attrs.includes('t="s"')) val = sharedStrings[Number(raw)] || '';
                else if (attrs.includes('t="inlineStr"')) val = decodeXmlEntities(raw);
                else val = cellValueToString(Number(raw));
            }
            cells[col] = val;
        }
        rows.set(rowNumber, cells);
    }
    return rows;
}

async function parseRosterExcelWithZip(buffer) {
    const zip = await JSZip.loadAsync(buffer);
    const workbookXml = await zip.file('xl/workbook.xml')?.async('string');
    const relsXml = await zip.file('xl/_rels/workbook.xml.rels')?.async('string');
    if (!workbookXml || !relsXml) return { headers: [], rows: [] };

    const rels = new Map();
    for (const m of relsXml.matchAll(/Id="(rId\d+)"[^>]*Target="([^"]+)"/g)) {
        rels.set(m[1], m[2].replace(/^\//, '').replace(/^xl\//, ''));
    }

    const sheets = [];
    for (const m of workbookXml.matchAll(/<sheet[^>]*name="([^"]+)"[^>]*r:id="(rId\d+)"/g)) {
        sheets.push({ name: m[1], path: `xl/${rels.get(m[2])}` });
    }

    const sstFile = zip.file('xl/sharedStrings.xml');
    const sharedStrings = sstFile ? parseSharedStrings(await sstFile.async('string')) : [];

    const preferred = sheets.find((s) => s.name === DATA_SHEET) || sheets[0];
    const ordered = preferred ? [preferred, ...sheets.filter((s) => s !== preferred)] : sheets;

    for (const sheet of ordered) {
        const file = zip.file(sheet.path);
        if (!file) continue;
        const rowMap = parseSheetRows(await file.async('string'), sharedStrings);
        let headerInfo = null;
        for (const [rowNumber, cells] of [...rowMap.entries()].sort((a, b) => a[0] - b[0])) {
            const headers = headerMatch(cells);
            if (headers) {
                headerInfo = { rowNumber, headers };
                break;
            }
        }
        if (!headerInfo) continue;

        const rows = [];
        for (const [rowNumber, cells] of [...rowMap.entries()].sort((a, b) => a[0] - b[0])) {
            if (rowNumber <= headerInfo.rowNumber) continue;
            while (cells.length < headerInfo.headers.length) cells.push('');
            for (let i = 0; i < cells.length; i += 1) {
                if (cells[i] == null) cells[i] = '';
            }
            if (cells.every((c) => !String(c).trim())) continue;
            rows.push({ rowNumber, cells: cells.slice(0, headerInfo.headers.length) });
        }
        return { headers: headerInfo.headers, rows };
    }

    return { headers: [], rows: [] };
}

async function parseRosterExcelWithExcelJs(buffer) {
    const ExcelJS = getExcelJS();
    const wb = new ExcelJS.Workbook();

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

async function parseRosterExcel(buffer) {
    // Algunos .xlsx editados en Excel hacen colgar a ExcelJS (dpi inválidos, etc.).
    // Preferimos el parser ZIP/XML, más tolerante con esos archivos.
    try {
        const parsed = await parseRosterExcelWithZip(buffer);
        if (parsed.headers.length) return parsed;
    } catch (e) {
        // fallback below
    }
    try {
        return await parseRosterExcelWithExcelJs(buffer);
    } catch (e) {
        return { headers: [], rows: [] };
    }
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
