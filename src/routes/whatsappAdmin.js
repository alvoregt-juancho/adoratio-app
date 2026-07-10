const express = require('express');
const prisma = require('../db');
const { requirePermission, PRIV } = require('../middleware/auth');
const { normalizePhone } = require('../utils/phone');
const config = require('../config');

const router = express.Router();

function serializeMessage(row) {
    let meta = null;
    if (row.meta) {
        try {
            meta = JSON.parse(row.meta);
        } catch {
            meta = row.meta;
        }
    }
    return {
        id: row.id,
        direction: row.direction,
        phone: row.phone,
        waMessageId: row.waMessageId,
        messageType: row.messageType,
        body: row.body,
        meta,
        status: row.status,
        contactName: row.contactName,
        createdAt: row.createdAt,
    };
}

router.get('/stats', requirePermission(PRIV.WHATSAPP_VIEW), async (req, res) => {
    try {
        const today = new Date();
        today.setHours(0, 0, 0, 0);

        const [inboundToday, outboundToday, total, uniquePhones] = await Promise.all([
            prisma.whatsAppMessageLog.count({
                where: { direction: 'inbound', createdAt: { gte: today } },
            }),
            prisma.whatsAppMessageLog.count({
                where: { direction: 'outbound', createdAt: { gte: today } },
            }),
            prisma.whatsAppMessageLog.count(),
            prisma.whatsAppMessageLog.findMany({
                distinct: ['phone'],
                select: { phone: true },
            }),
        ]);

        res.json({
            enabled: config.whatsapp.enabled,
            apiConnected: config.whatsappEnabled,
            inboundToday,
            outboundToday,
            totalMessages: total,
            uniqueContacts: uniquePhones.length,
        });
    } catch (e) {
        console.error(e);
        res.status(500).json({ error: 'Error al obtener estadísticas de WhatsApp.' });
    }
});

router.get('/messages', requirePermission(PRIV.WHATSAPP_VIEW), async (req, res) => {
    try {
        const limit = Math.min(100, Math.max(1, Number(req.query.limit) || 50));
        const offset = Math.max(0, Number(req.query.offset) || 0);
        const direction = req.query.direction;
        const phone = normalizePhone(req.query.phone);
        const q = String(req.query.q || '').trim();

        const where = {};
        if (direction === 'inbound' || direction === 'outbound') {
            where.direction = direction;
        }
        if (phone) {
            where.phone = phone;
        }
        if (q) {
            where.body = { contains: q };
        }

        const [messages, total] = await Promise.all([
            prisma.whatsAppMessageLog.findMany({
                where,
                orderBy: { createdAt: 'desc' },
                skip: offset,
                take: limit,
            }),
            prisma.whatsAppMessageLog.count({ where }),
        ]);

        res.json({
            messages: messages.map(serializeMessage),
            total,
            limit,
            offset,
        });
    } catch (e) {
        console.error(e);
        res.status(500).json({ error: 'Error al listar mensajes de WhatsApp.' });
    }
});

router.get('/conversations', requirePermission(PRIV.WHATSAPP_VIEW), async (req, res) => {
    try {
        const limit = Math.min(50, Math.max(1, Number(req.query.limit) || 30));
        const rows = await prisma.whatsAppMessageLog.findMany({
            orderBy: { createdAt: 'desc' },
            take: 500,
        });

        const byPhone = new Map();
        for (const row of rows) {
            if (byPhone.has(row.phone)) continue;
            byPhone.set(row.phone, serializeMessage(row));
            if (byPhone.size >= limit) break;
        }

        res.json({ conversations: [...byPhone.values()] });
    } catch (e) {
        console.error(e);
        res.status(500).json({ error: 'Error al listar conversaciones.' });
    }
});

module.exports = router;
