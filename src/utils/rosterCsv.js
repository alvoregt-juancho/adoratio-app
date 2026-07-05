const { FREQUENCY_LABELS, COMMITMENT_FREQUENCY, isValidFrequency } = require('../constants/commitment');
const { parseTimeInput } = require('./timeFormat');
const { normalizePhone, isValidPhone } = require('./phone');
const { parseWeekDays } = require('./weekDays');
const { todayStr, dateForWeekday } = require('./dates');

const CSV_BOM = '\uFEFF';

const WEEKDAY_NAMES = {
    1: 'lunes',
    2: 'martes',
    3: 'miércoles',
    4: 'jueves',
    5: 'viernes',
    6: 'sábado',
    7: 'domingo',
};

const WEEKDAY_ALIASES = {
    lunes: 1,
    martes: 2,
    miercoles: 3,
    miércoles: 3,
    jueves: 4,
    viernes: 5,
    sabado: 6,
    sábado: 6,
    domingo: 7,
    dom: 7,
    lun: 1,
    mar: 2,
    mie: 3,
    mié: 3,
    jue: 4,
    vie: 5,
    sab: 6,
};

const FREQ_ALIASES = {
    semanal: 'WEEKLY',
    weekly: 'WEEKLY',
    diario: 'DAILY',
    daily: 'DAILY',
    quincenal: 'BIWEEKLY',
    biweekly: 'BIWEEKLY',
    mensual: 'MONTHLY',
    monthly: 'MONTHLY',
    once: 'ONCE',
    'una sola vez': 'ONCE',
    onetime: 'ONCE',
};

function escapeCsvCell(value) {
    const s = value == null ? '' : String(value);
    if (/[",\n\r]/.test(s)) return `"${s.replace(/"/g, '""')}"`;
    return s;
}

function csvRow(cells) {
    return cells.map(escapeCsvCell).join(',');
}

function parseCsvLine(line) {
    const cells = [];
    let current = '';
    let inQuotes = false;
    for (let i = 0; i < line.length; i += 1) {
        const ch = line[i];
        if (inQuotes) {
            if (ch === '"') {
                if (line[i + 1] === '"') {
                    current += '"';
                    i += 1;
                } else {
                    inQuotes = false;
                }
            } else {
                current += ch;
            }
        } else if (ch === '"') {
            inQuotes = true;
        } else if (ch === ',') {
            cells.push(current);
            current = '';
        } else {
            current += ch;
        }
    }
    cells.push(current);
    return cells.map((c) => c.trim());
}

function parseCsvText(text) {
    const normalized = String(text || '').replace(/^\uFEFF/, '').trim();
    if (!normalized) return { headers: [], rows: [] };
    const lines = normalized.split(/\r?\n/).filter((l) => l.trim().length > 0);
    if (!lines.length) return { headers: [], rows: [] };
    const headers = parseCsvLine(lines[0]).map((h) => h.toLowerCase());
    const rows = lines.slice(1).map((line, index) => ({
        rowNumber: index + 2,
        cells: parseCsvLine(line),
    }));
    return { headers, rows };
}

function rowToObject(headers, cells) {
    const obj = {};
    headers.forEach((h, i) => {
        obj[h] = cells[i] ?? '';
    });
    return obj;
}

function parseWeekdayInput(raw) {
    const s = String(raw || '').trim().toLowerCase();
    if (!s) return null;
    if (/^[1-7]$/.test(s)) return Number(s);
    return WEEKDAY_ALIASES[s] ?? null;
}

function parseFrequencyInput(raw) {
    const s = String(raw || '').trim();
    if (!s) return COMMITMENT_FREQUENCY.WEEKLY;
    const upper = s.toUpperCase();
    if (isValidFrequency(upper)) return upper;
    const alias = FREQ_ALIASES[s.toLowerCase()];
    if (alias) return alias;
    const fromLabel = Object.entries(FREQUENCY_LABELS).find(([, label]) => label.toLowerCase() === s.toLowerCase());
    return fromLabel ? fromLabel[0] : null;
}

function parseDurationMinutes(raw) {
    const s = String(raw || '').trim().toLowerCase();
    if (!s) return 60;
    if (s === '30' || s.includes('30')) return 30;
    if (s === '60' || s.includes('1 hora') || s === '1h') return 60;
    const n = Number(s);
    if (n === 30 || n === 60) return n;
    return null;
}

function parseWeekDaysInput(raw) {
    if (!raw || String(raw).trim() === '' || String(raw).trim().toLowerCase() === 'todos') return null;
    const parts = String(raw)
        .split(/[,;|]/)
        .map((p) => parseWeekdayInput(p.trim()))
        .filter((d) => d != null);
    if (!parts.length) return null;
    return [...new Set(parts)].sort((a, b) => a - b).join(',');
}

function parseSlotTimesInput(raw) {
    if (!raw || String(raw).trim() === '' || String(raw).trim().toLowerCase() === 'todos') return null;
    const times = String(raw)
        .split(/[,;|]/)
        .map((t) => parseTimeInput(t.trim()))
        .filter(Boolean);
    if (!times.length) return null;
    return [...new Set(times)].join(',');
}

function getRosterTemplate(section) {
    if (section === 'commitments') {
        const header = csvRow([
            'dia',
            'hora',
            'duracion_minutos',
            'frecuencia',
            'nombre',
            'apellido',
            'celular',
            'dias_extra',
            'notas',
        ]);
        const example = csvRow([
            'lunes',
            '7:00 AM',
            '60',
            'Semanal',
            'María',
            'García',
            '88881234',
            '',
            'Ejemplo — borrar o reemplazar',
        ]);
        const instructions = csvRow([
            'Instrucciones: dia=lunes..domingo; hora=7:00 AM; duracion=30 o 60; frecuencia=Semanal|Diario|Quincenal|Mensual|Una sola vez; dias_extra para Diario (ej. 1,3,5)',
        ]);
        return {
            filename: 'plantilla-turnos-adoracion.csv',
            content: `${CSV_BOM}${header}\n${example}\n${instructions}\n`,
        };
    }
    if (section === 'captains' || section === 'substitutes') {
        const header = csvRow(['nombre', 'apellido', 'celular', 'correo', 'dias', 'horas', 'notas']);
        const example = csvRow([
            section === 'captains' ? 'Juan' : 'Ana',
            section === 'captains' ? 'Pérez' : 'López',
            '88880001',
            'correo@ejemplo.com',
            'lunes',
            '7:00 AM',
            'Ejemplo — borrar o reemplazar',
        ]);
        const instructions = csvRow([
            'Instrucciones: dias y horas vacíos = todos; varios días u horas separados por coma',
        ]);
        return {
            filename: `plantilla-${section === 'captains' ? 'capitanes' : 'sustitutos'}.csv`,
            content: `${CSV_BOM}${header}\n${example}\n${instructions}\n`,
        };
    }
    return null;
}

function parseCommitmentImportRow(row, headers) {
    const data = rowToObject(headers, row.cells);
    const weekday = parseWeekdayInput(data.dia || data.dia_semana || data.day);
    const slotTime = parseTimeInput(data.hora || data.hora_inicio || data.horario);
    const durationMinutes = parseDurationMinutes(data.duracion_minutos || data.duracion || data.duration);
    const frequency = parseFrequencyInput(data.frecuencia || data.frequency);
    const firstName = String(data.nombre || data.firstname || '').trim();
    const lastName = String(data.apellido || data.lastname || '').trim();
    const phone = normalizePhone(data.celular || data.telefono || data.phone);
    const extraDays = parseWeekDaysInput(data.dias_extra || data.dias || data.weekdays);

    if (!weekday) return { error: 'Día de la semana inválido (fila ' + row.rowNumber + ').' };
    if (!slotTime) return { error: 'Hora inválida en fila ' + row.rowNumber + '.' };
    if (!durationMinutes) return { error: 'Duración inválida (use 30 o 60) en fila ' + row.rowNumber + '.' };
    if (!frequency) return { error: 'Frecuencia inválida en fila ' + row.rowNumber + '.' };
    if (!firstName) return { error: 'Nombre requerido en fila ' + row.rowNumber + '.' };
    if (!isValidPhone(phone)) return { error: 'Celular inválido (8 dígitos) en fila ' + row.rowNumber + '.' };

    let weekDays = null;
    if (frequency === COMMITMENT_FREQUENCY.DAILY) {
        weekDays = extraDays || String(weekday);
        if (!parseWeekDays(weekDays).length) {
            return { error: 'Para frecuencia Diario indique dias_extra (ej. 1,3,5) en fila ' + row.rowNumber + '.' };
        }
    } else if (frequency === COMMITMENT_FREQUENCY.WEEKLY) {
        weekDays = String(weekday);
    }

    return {
        weekday,
        slotTime,
        durationMinutes,
        startTimeOffset: 0,
        frequency,
        weekDays,
        biweeklyWeeks: frequency === COMMITMENT_FREQUENCY.BIWEEKLY ? '1,3' : null,
        firstName,
        lastName,
        phone,
        date: dateForWeekday(weekday),
        rowNumber: row.rowNumber,
    };
}

function parseMemberImportRow(row, headers, role) {
    const data = rowToObject(headers, row.cells);
    const firstName = String(data.nombre || data.firstname || '').trim();
    const lastName = String(data.apellido || data.lastname || '').trim();
    const phone = normalizePhone(data.celular || data.telefono || data.phone);
    const email = String(data.correo || data.email || '').trim() || null;
    const weekDays = parseWeekDaysInput(data.dias || data.days);
    const slotTimes = parseSlotTimesInput(data.horas || data.horarios || data.hora);
    const internalNotes = String(data.notas || data.notas_internas || '').trim() || null;

    if (!firstName) return { error: 'Nombre requerido en fila ' + row.rowNumber + '.' };
    if (!isValidPhone(phone)) return { error: 'Celular inválido en fila ' + row.rowNumber + '.' };

    return {
        role,
        firstName,
        lastName,
        phone,
        email,
        weekDays,
        slotTimes,
        internalNotes,
        rowNumber: row.rowNumber,
    };
}

function isInstructionRow(headers, cells) {
    const first = (cells[0] || '').toLowerCase();
    return first.startsWith('instrucciones') || headers[0] === 'instrucciones';
}

function findCsvHeaderIndex(lines) {
    for (let i = 0; i < lines.length; i += 1) {
        const cells = parseCsvLine(lines[i]).map((h) => h.toLowerCase());
        if (cells.includes('dia') && cells.includes('hora')) return i;
        if (cells.includes('nombre') && cells.includes('celular')) return i;
    }
    return 0;
}

function shouldSkipImportRow(headers, cells) {
    if (isInstructionRow(headers, cells)) return true;
    if (cells.every((c) => !String(c).trim())) return true;
    const joined = cells.join(' ').toLowerCase();
    if (joined.includes('instrucciones:')) return true;
    const notesIdx = headers.indexOf('notas');
    const notes = notesIdx >= 0 ? String(cells[notesIdx] || '').toLowerCase() : '';
    if (notes.includes('ejemplo') && (notes.includes('borrar') || notes.includes('reemplazar') || notes.includes('no modificar'))) {
        return true;
    }
    const first = String(cells[0] || '').toLowerCase();
    if (first.includes('ejemplo') && notes.includes('ejemplo')) return true;
    return false;
}

module.exports = {
    CSV_BOM,
    WEEKDAY_NAMES,
    escapeCsvCell,
    csvRow,
    parseCsvText,
    getRosterTemplate,
    parseCommitmentImportRow,
    parseMemberImportRow,
    parseWeekdayInput,
    parseFrequencyInput,
    parseDurationMinutes,
    parseWeekDaysInput,
    parseSlotTimesInput,
    isInstructionRow,
    findCsvHeaderIndex,
    shouldSkipImportRow,
};
