#!/usr/bin/env node
/**
 * Servidor mínimo solo para verificar el webhook de Meta.
 * Uso: node scripts/whatsapp-webhook-server.js
 * Luego expón con: npx localtunnel --port 3000
 */
require('dotenv').config();

const express = require('express');
const config = require('../src/config');
const whatsappRoutes = require('../src/routes/whatsapp');

const PORT = parseInt(process.env.PORT, 10) || 3000;
const app = express();

app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use('/api/whatsapp', whatsappRoutes);

app.get('/api/health', (req, res) => {
    res.json({ status: 'OK', webhook: '/api/whatsapp/webhook' });
});

app.listen(PORT, () => {
    console.log(`Webhook WhatsApp listo en http://localhost:${PORT}/api/whatsapp/webhook`);
    console.log(`Verify token: ${config.whatsapp.verifyToken}`);
});
