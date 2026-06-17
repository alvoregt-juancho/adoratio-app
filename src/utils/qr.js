const QRCode = require('qrcode');
const config = require('../config');

// Genera un identificador unico legible, ej: CAP2026-A1B2C3
function generateQrCodeId() {
    const year = new Date().getFullYear();
    const rand = Math.random().toString(36).substring(2, 8).toUpperCase();
    return `CAP${year}-${rand}`;
}

// URL que se incrusta en el QR fisico.
function buildScanUrl(qrCode) {
    return `${config.baseUrl}${config.scanEndpoint}?code=${encodeURIComponent(qrCode)}`;
}

async function toDataURL(qrCode) {
    return QRCode.toDataURL(buildScanUrl(qrCode), { scale: 8, margin: 2 });
}

async function toBuffer(qrCode) {
    return QRCode.toBuffer(buildScanUrl(qrCode), { scale: 8, margin: 2 });
}

module.exports = { generateQrCodeId, buildScanUrl, toDataURL, toBuffer };
