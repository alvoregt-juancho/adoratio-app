#!/usr/bin/env node
/**
 * Lista plantillas aprobadas en Meta y compara con las configuradas en .env
 * Uso: node scripts/list-whatsapp-templates.js
 */
require('dotenv').config();

const config = require('../src/config');

const WABA_ID = process.env.WHATSAPP_BUSINESS_ACCOUNT_ID || '2555049364931863';
const TOKEN = process.env.WHATSAPP_ACCESS_TOKEN;
const API_VERSION = process.env.WHATSAPP_API_VERSION || 'v25.0';

const REQUIRED = {
    reminder24h: process.env.WHATSAPP_TEMPLATE_REMINDER_24H,
    reminder3h: process.env.WHATSAPP_TEMPLATE_REMINDER_3H,
    captainEmergency: process.env.WHATSAPP_TEMPLATE_CAPTAIN_EMERGENCY,
    bookingConfirmed: process.env.WHATSAPP_TEMPLATE_BOOKING_CONFIRMED,
};

async function main() {
    console.log('── Plantillas WhatsApp AdoraHora ──\n');

    console.log('Configuradas en .env:');
    for (const [key, val] of Object.entries(REQUIRED)) {
        console.log(`  ${val ? '✔' : '✗'} ${key}: ${val || '(no configurada)'}`);
    }
    console.log(`\nTemplates activas en código: ${config.whatsappTemplatesEnabled ? 'SÍ' : 'NO'}`);
    console.log(`(Requiere WHATSAPP_TEMPLATE_REMINDER_24H y WHATSAPP_TEMPLATE_REMINDER_3H)\n`);

    if (!TOKEN) {
        console.log('Sin WHATSAPP_ACCESS_TOKEN — no se puede consultar Meta.');
        console.log('Textos para crear plantillas: config/whatsapp-templates.example.json');
        return;
    }

    const url = `https://graph.facebook.com/${API_VERSION}/${WABA_ID}/message_templates?limit=100`;
    const res = await fetch(url, {
        headers: { Authorization: `Bearer ${TOKEN}` },
    });
    const data = await res.json();

    if (!res.ok) {
        console.error('Error Meta API:', data.error?.message || res.status);
        return;
    }

    const templates = data.data || [];
    console.log(`Plantillas en Meta (${templates.length}):\n`);

    const names = new Set(templates.map((t) => t.name));
    for (const t of templates) {
        const status = t.status || '?';
        const icon = status === 'APPROVED' ? '✔' : status === 'PENDING' ? '⏳' : '✗';
        console.log(`  ${icon} ${t.name} — ${status} (${t.language})`);
    }

    console.log('\nVerificación:');
    for (const [key, val] of Object.entries(REQUIRED)) {
        if (!val) continue;
        const found = templates.find((t) => t.name === val);
        if (!found) {
            console.log(`  ✗ ${val} — NO existe en Meta (crear plantilla)`);
        } else if (found.status !== 'APPROVED') {
            console.log(`  ⏳ ${val} — estado: ${found.status} (esperar aprobación)`);
        } else {
            console.log(`  ✔ ${val} — aprobada y lista`);
        }
    }

    const needed = Object.values(REQUIRED).filter(Boolean);
    const allApproved = needed.every((n) => {
        const t = templates.find((x) => x.name === n);
        return t && t.status === 'APPROVED';
    });
    if (needed.length >= 2 && allApproved) {
        console.log('\n✅ Recordatorios listos. Reinicia el servidor después de actualizar .env.');
    } else {
        console.log('\n📋 Siguiente paso: crear plantillas en Meta usando config/whatsapp-templates.example.json');
    }
}

main().catch(console.error);
