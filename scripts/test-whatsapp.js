#!/usr/bin/env node
/**
 * Prueba de envío vía Meta WhatsApp Cloud API (modo test).
 *
 * Uso:
 *   1. En Meta for Developers → WhatsApp → API Setup → "Generate token"
 *   2. Agrega el token a .env como WHATSAPP_ACCESS_TOKEN
 *   3. node scripts/test-whatsapp.js
 *
 * Opciones:
 *   --to 50242015748          Destinatario (código país + número, sin +)
 *   --template hello_world    Plantilla (hello_world viene pre-aprobada en test)
 *   --text "Hola"             Mensaje de texto libre (solo dentro de ventana 24h)
 */

require('dotenv').config();

const PHONE_NUMBER_ID = process.env.WHATSAPP_PHONE_NUMBER_ID || '1236770116181669';
const ACCESS_TOKEN = process.env.WHATSAPP_ACCESS_TOKEN;
const API_VERSION = process.env.WHATSAPP_API_VERSION || 'v25.0';

function parseArgs() {
    const args = process.argv.slice(2);
    const opts = {
        to: process.env.WHATSAPP_TEST_TO || '50242015748',
        template: process.env.WHATSAPP_TEST_TEMPLATE || 'hello_world',
        language: process.env.WHATSAPP_TEMPLATE_LANGUAGE || 'en_US',
        text: null,
    };
    for (let i = 0; i < args.length; i++) {
        if (args[i] === '--to' && args[i + 1]) opts.to = args[++i].replace(/\D/g, '');
        else if (args[i] === '--template' && args[i + 1]) opts.template = args[++i];
        else if (args[i] === '--language' && args[i + 1]) opts.language = args[++i];
        else if (args[i] === '--text' && args[i + 1]) opts.text = args[++i];
    }
    return opts;
}

async function sendMessage(payload) {
    const url = `https://graph.facebook.com/${API_VERSION}/${PHONE_NUMBER_ID}/messages`;
    const res = await fetch(url, {
        method: 'POST',
        headers: {
            Authorization: `Bearer ${ACCESS_TOKEN}`,
            'Content-Type': 'application/json',
        },
        body: JSON.stringify({ messaging_product: 'whatsapp', ...payload }),
    });
    const data = await res.json().catch(() => ({}));
    return { ok: res.ok, status: res.status, data };
}

async function main() {
    const opts = parseArgs();

    console.log('── Prueba WhatsApp Cloud API (Meta test) ──');
    console.log('Phone Number ID:', PHONE_NUMBER_ID);
    console.log('API Version:    ', API_VERSION);
    console.log('Destinatario:   ', opts.to);
    console.log('Test number:    ', '+1 555 159-4664 (número de envío Meta)');

    if (!ACCESS_TOKEN) {
        console.error('\n❌ Falta WHATSAPP_ACCESS_TOKEN en .env');
        console.error('   Ve a Meta for Developers → WhatsApp → API Setup');
        console.error('   Haz clic en "Generate token" y pega el token en .env\n');
        process.exit(1);
    }

    let payload;
    if (opts.text) {
        console.log('Modo:           texto libre');
        payload = { to: opts.to, type: 'text', text: { body: opts.text } };
    } else {
        console.log('Modo:           plantilla', opts.template);
        payload = {
            to: opts.to,
            type: 'template',
            template: {
                name: opts.template,
                language: { code: opts.language },
            },
        };
        // Plantilla de ejemplo del dashboard Meta (order confirmation)
        if (opts.template === 'jaspers_market_order_confirmation_v1') {
            payload.template.components = [
                {
                    type: 'body',
                    parameters: [{ type: 'text', text: 'Juan' }],
                },
            ];
        }
    }

    console.log('\nEnviando…\n');
    const result = await sendMessage(payload);

    if (result.ok) {
        console.log('✅ Mensaje enviado correctamente');
        console.log(JSON.stringify(result.data, null, 2));
        console.log('\nRevisa el WhatsApp del destinatario (+', opts.to, ')');
        console.log('En Meta → "Check test webhooks" debería aparecer el evento.');
    } else {
        console.error('❌ Error', result.status);
        console.error(JSON.stringify(result.data, null, 2));
        const err = result.data?.error;
        if (err?.code === 190) {
            console.error('\n→ Token inválido o expirado. Genera uno nuevo en Meta.');
        }
        if (err?.code === 131030) {
            console.error('\n→ El número destino no está en la lista de prueba de Meta.');
            console.error('  Agrega +502-4201-5748 en API Setup → "To" field.');
        }
        if (err?.code === 132001) {
            console.error('\n→ Plantilla no encontrada. Prueba: --template hello_world');
        }
        process.exit(1);
    }
}

main().catch((e) => {
    console.error(e);
    process.exit(1);
});
