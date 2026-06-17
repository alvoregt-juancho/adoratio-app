require('dotenv').config();

const config = {
    port: parseInt(process.env.PORT, 10) || 3000,
    baseUrl: process.env.BASE_URL || 'http://localhost:3000',
    scanEndpoint: process.env.SCAN_ENDPOINT || '/scan.html',
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
};

config.smtpEnabled = Boolean(config.smtp.host && config.smtp.user && config.smtp.pass);

module.exports = config;
