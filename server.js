const express = require('express');
const path = require('path');
const config = require('./src/config');
const { initDatabase } = require('./src/initDb');

const authRoutes = require('./src/routes/auth');
const slotRoutes = require('./src/routes/slots');
const reservationRoutes = require('./src/routes/reservations');
const checkinRoutes = require('./src/routes/checkin');
const adminRoutes = require('./src/routes/admin');
const settingsRoutes = require('./src/routes/settings');
const muroRoutes = require('./src/routes/muro');

const app = express();

app.set('trust proxy', true);
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// API
app.get('/api/health', (req, res) => {
    res.json({ status: 'OK', message: 'Servidor Adoratio operativo', smtp: config.smtpEnabled });
});
app.use('/api/auth', authRoutes);
app.use('/api/slots', slotRoutes);
app.use('/api/reservations', reservationRoutes);
app.use('/api/settings', settingsRoutes);
app.use('/api/check-in', checkinRoutes);
app.use('/api/muro', muroRoutes);
app.use('/api/admin', adminRoutes);

// Estáticos
app.use(express.static(path.join(__dirname, 'public')));

// 404 para rutas /api desconocidas
app.use('/api', (req, res) => res.status(404).json({ error: 'Endpoint no encontrado.' }));

async function start() {
    await initDatabase();

    app.listen(config.port, () => {
        console.log(`Servidor Adoratio corriendo en ${config.baseUrl} (puerto ${config.port})`);
        if (!config.smtpEnabled) {
            console.log('ℹ SMTP no configurado: los correos se imprimirán en consola.');
        }
    });
}

start().catch((err) => {
    console.error('Error al iniciar el servidor:', err);
    process.exit(1);
});
