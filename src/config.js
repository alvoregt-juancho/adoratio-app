require('dotenv').config();

const config = {
    port: parseInt(process.env.PORT, 10) || 3000,
    baseUrl: process.env.BASE_URL || 'http://localhost:3000',
    scanEndpoint: process.env.SCAN_ENDPOINT || '/scan.html',
    kioskPagePath: process.env.KIOSK_PAGE_PATH || '/chapel-registro-7f3c2a1b.html',
    kioskMaskUrl: process.env.KIOSK_MASK_URL || 'https://adorahora.com',
    jwtSecret: process.env.JWT_SECRET || 'dev-secret-no-usar-en-produccion',
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
        accessToken: process.env.WHATSAPP_ACCESS_TOKEN,
        verifyToken: process.env.WHATSAPP_VERIFY_TOKEN || 'adoratio-verify',
        apiVersion: process.env.WHATSAPP_API_VERSION || 'v25.0',
        countryCode: process.env.WHATSAPP_COUNTRY_CODE || '506',
        chapelName: process.env.CHAPEL_NAME || 'Capilla del Santísimo — Parroquia Cristo Rey',
    },
};

config.smtpEnabled = Boolean(config.smtp.host && config.smtp.user && config.smtp.pass);
config.whatsappEnabled = Boolean(
    config.whatsapp.enabled && config.whatsapp.phoneNumberId && config.whatsapp.accessToken
);

module.exports = config;
