const prisma = require('../db');

/**
 * Registro centralizado de auditoría (fricción cero — fire-and-forget).
 */
async function writeAudit({ action, entity, entityId, userId, reservationId, targetUserId, meta, req }) {
    try {
        await prisma.auditLog.create({
            data: {
                action,
                entity,
                entityId: entityId ?? null,
                userId: userId ?? req?.user?.id ?? null,
                reservationId: reservationId ?? null,
                targetUserId: targetUserId ?? null,
                meta: meta ? JSON.stringify(meta) : null,
                ipAddress: req?.ip || req?.headers?.['x-forwarded-for'] || null,
                userAgent: req?.headers?.['user-agent']?.slice(0, 512) || null,
            },
        });
    } catch (e) {
        console.error('[audit]', action, e.message);
    }
}

module.exports = { writeAudit };
