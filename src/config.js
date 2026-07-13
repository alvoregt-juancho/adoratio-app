require('dotenv').config();

const DEFAULT_JWT_SECRET = 'dev-secret-no-usar-en-produccion';
const isProduction = process.env.NODE_ENV === 'production';

const config = {
    port: parseInt(process.env.PORT, 10) || 3000,
    baseUrl: process.env.BASE_URL || 'http://localhost:3000',
    scanEndpoint: process.env.SCAN_ENDPOINT || '/scan.html',
    kioskPagePath: process.env.KIOSK_PAGE_PATH || '/chapel-registro-7f3c2a1b.html',
    kioskMaskUrl: process.env.KIOSK_MASK_URL || 'https://adorahora.com',
    isProduction,
    countryCode: process.env.COUNTRY_CODE || process.env.WHATSAPP_COUNTRY_CODE || '502',
    coordinatorPhone: (process.env.COORDINATOR_PHONE || '30341044').replace(/\D/g, '').slice(-8),
    appLocale: process.env.APP_LOCALE || 'es-GT',
    kioskApiSecret: process.env.KIOSK_API_SECRET || '',
    jwtSecret: process.env.JWT_SECRET || DEFAULT_JWT_SECRET,
    jwtExpiresIn: process.env.JWT_EXPIRES_IN || '7d',
    admin: {
        email: process.env.ADMIN_EMAIL || 'admin@adoratio.com',
        password: process.env.ADMIN_PASSWORD || 'adoratio2026',
        name: process.env.ADMIN_NAME || 'Administrador Parroquial',
    },
    smtp: {
        host: process.env.SMTP_HOST,
        port: parseInt(process.env.SMTP_PORT, 10) || 587,
        user: process.env.SMTP_USER,
        pass: process.env.SMTP_PASS,
        from: process.env.MAIL_FROM || 'Adoratio <no-reply@adoratio.com>',
    },
    whatsapp: {
        enabled: process.env.WHATSAPP_ENABLED === 'true',
        phoneNumberId: process.env.WHATSAPP_PHONE_NUMBER_ID,
        businessAccountId: process.env.WHATSAPP_BUSINESS_ACCOUNT_ID,
        accessToken: process.env.WHATSAPP_ACCESS_TOKEN,
        verifyToken: process.env.WHATSAPP_VERIFY_TOKEN || 'adoratio-verify',
        appSecret: process.env.WHATSAPP_APP_SECRET || '',
        apiVersion: process.env.WHATSAPP_API_VERSION || 'v25.0',
        countryCode: process.env.WHATSAPP_COUNTRY_CODE || process.env.COUNTRY_CODE || '502',
        chapelName: process.env.CHAPEL_NAME || 'Capilla del Santísimo — Parroquia Cristo Rey',
        reminderIntervalMs: parseInt(process.env.WHATSAPP_REMINDER_INTERVAL_MS, 10) || 5 * 60 * 1000,
        templates: {
            language: process.env.WHATSAPP_TEMPLATE_LANGUAGE || 'es_MX',
            reminder24h: process.env.WHATSAPP_TEMPLATE_REMINDER_24H || '',
            reminder3h: process.env.WHATSAPP_TEMPLATE_REMINDER_3H || '',
            captainEmergency: process.env.WHATSAPP_TEMPLATE_CAPTAIN_EMERGENCY || '',
            bookingConfirmed: process.env.WHATSAPP_TEMPLATE_BOOKING_CONFIRMED || '',
        },
    },
};

config.smtpEnabled = Boolean(config.smtp.host && config.smtp.user && config.smtp.pass);
config.whatsappEnabled = Boolean(
    config.whatsapp.enabled && config.whatsapp.phoneNumberId && config.whatsapp.accessToken
);
config.whatsappTemplatesEnabled = Boolean(
    config.whatsappEnabled &&
        config.whatsapp.templates.reminder24h &&
        config.whatsapp.templates.reminder3h
);

if (isProduction && config.jwtSecret === DEFAULT_JWT_SECRET) {
    console.error('❌ JWT_SECRET no configurado en producción. Define un secreto fuerte en .env');
    process.exit(1);
}

if (isProduction && !config.smtpEnabled) {
    console.warn('⚠ SMTP no configurado: verificación por correo desactivada.');
}

module.exports = config;
