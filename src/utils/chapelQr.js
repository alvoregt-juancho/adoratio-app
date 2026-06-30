const prisma = require('../db');
const config = require('../config');
const { generateQrCodeId } = require('./qr');

const CHAPEL_QR_NAME = 'Capilla — Tótem de ingreso';
const CHAPEL_QR_LOCATION = 'Entrada de la capilla';

async function getChapelQr() {
    return prisma.physicalQR.findFirst({
        where: { isChapelTotem: true, isActive: true },
        include: { _count: { select: { scans: true } } },
    });
}

async function ensureChapelQr(generatedBy = null) {
    const existing = await getChapelQr();
    if (existing) return existing;

    await prisma.physicalQR.updateMany({
        where: { isChapelTotem: true },
        data: { isChapelTotem: false },
    });

    return prisma.physicalQR.create({
        data: {
            qrCode: generateQrCodeId(),
            displayName: CHAPEL_QR_NAME,
            location: CHAPEL_QR_LOCATION,
            isActive: true,
            isChapelTotem: true,
            generatedBy,
        },
        include: { _count: { select: { scans: true } } },
    });
}

async function replaceChapelQr(generatedBy = null) {
    await prisma.physicalQR.updateMany({
        where: { isChapelTotem: true },
        data: { isChapelTotem: false, isActive: false },
    });

    return prisma.physicalQR.create({
        data: {
            qrCode: generateQrCodeId(),
            displayName: CHAPEL_QR_NAME,
            location: CHAPEL_QR_LOCATION,
            isActive: true,
            isChapelTotem: true,
            generatedBy,
        },
        include: { _count: { select: { scans: true } } },
    });
}

function buildKioskUrl() {
    const base = (config.kioskMaskUrl || config.baseUrl).replace(/\/$/, '');
    const path = config.kioskPagePath.startsWith('/')
        ? config.kioskPagePath
        : `/${config.kioskPagePath}`;
    return `${base}${path}`;
}

function formatChapelQrPayload(qr, qrUtil) {
    if (!qr) return null;
    return {
        id: qr.id,
        qrCode: qr.qrCode,
        displayName: qr.displayName,
        location: qr.location,
        isActive: qr.isActive,
        isChapelTotem: true,
        lastUsedAt: qr.lastUsedAt,
        uses: qr._count?.scans ?? 0,
        scanUrl: qrUtil.buildScanUrl(qr.qrCode),
        kioskUrl: buildKioskUrl(),
    };
}

module.exports = {
    CHAPEL_QR_NAME,
    CHAPEL_QR_LOCATION,
    getChapelQr,
    ensureChapelQr,
    replaceChapelQr,
    buildKioskUrl,
    formatChapelQrPayload,
};
