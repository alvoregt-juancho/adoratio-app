const nodemailer = require('nodemailer');
const config = require('../config');

let transporter = null;
if (config.smtpEnabled) {
    transporter = nodemailer.createTransport({
        host: config.smtp.host,
        port: config.smtp.port,
        secure: config.smtp.port === 465,
        auth: { user: config.smtp.user, pass: config.smtp.pass },
    });
}

async function sendMail({ to, subject, text, html }) {
    if (!transporter) {
        // Modo desarrollo: se imprime el correo en consola.
        console.log('\n────────── EMAIL (modo consola) ──────────');
        console.log(`Para:    ${to}`);
        console.log(`Asunto:  ${subject}`);
        console.log(`Mensaje:\n${text}`);
        console.log('──────────────────────────────────────────\n');
        return { mocked: true };
    }
    return transporter.sendMail({ from: config.smtp.from, to, subject, text, html });
}

function sendReservationConfirmation({ to, name, slot, date }) {
    const subject = 'Confirmación de tu turno de adoración';
    const text =
        `Hola ${name},\n\n` +
        `Has reservado tu turno de adoración:\n` +
        `  Fecha: ${date}\n` +
        `  Horario: ${slot.startTime} - ${slot.endTime}\n\n` +
        `Al llegar a la capilla, escanea el QR de la entrada y confirma tu asistencia ` +
        `con este mismo correo.\n\n` +
        `Capilla del Santísimo Sacramento — Cristo Rey`;
    return sendMail({ to, subject, text });
}

function sendVerification({ to, name, code }) {
    const subject = 'Verifica tu correo — Adoratio';
    const text =
        `Hola ${name},\n\n` +
        `Tu código de verificación es: ${code}\n\n` +
        `Capilla del Santísimo Sacramento — Cristo Rey`;
    return sendMail({ to, subject, text });
}

module.exports = { sendMail, sendReservationConfirmation, sendVerification };
