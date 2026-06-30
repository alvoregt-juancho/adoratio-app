/**
 * Borrado selectivo de datos para la zona de demostración en Auditoría.
 */

const prisma = require('../db');

const DEMO_WIPE_CATEGORIES = [
    {
        id: 'reservations',
        label: 'Reservas y compromisos',
        group: 'operativo',
        description: 'Compromisos de adoración y reservas puntuales.',
    },
    {
        id: 'substitutions',
        label: 'Solicitudes de sustitución',
        group: 'operativo',
        description: 'Peticiones de sustituto pendientes o revisadas.',
    },
    {
        id: 'slots',
        label: 'Turnos (franjas horarias)',
        group: 'operativo',
        description: 'Franjas del calendario. Requiere borrar reservas primero.',
        requires: ['reservations'],
    },
    {
        id: 'roster',
        label: 'Directorio roster',
        group: 'operativo',
        description: 'Contactos de capitanes y sustitutos del directorio.',
    },
    {
        id: 'intentions',
        label: 'Muro de intenciones',
        group: 'operativo',
        description: 'Intenciones de oración publicadas o archivadas.',
    },
    {
        id: 'qrs',
        label: 'Códigos QR físicos',
        group: 'operativo',
        description: 'QR de capilla y registros de escaneo.',
    },
    {
        id: 'audit',
        label: 'Registros de auditoría',
        group: 'operativo',
        description: 'Historial de acciones en el back-office.',
    },
    {
        id: 'captains',
        label: 'Capitanes (franjas y alertas)',
        group: 'acceso',
        description: 'Asignaciones de capitán y notificaciones del bloque.',
    },
    {
        id: 'attendance',
        label: 'Asistencia kiosk',
        group: 'operativo',
        description: 'Entradas y salidas registradas en el quiosco.',
    },
    {
        id: 'admins',
        label: 'Usuarios administradores',
        group: 'acceso',
        description: 'Cuentas con perfil RBAC. No borra tu sesión ni super-admin.',
    },
    {
        id: 'profiles',
        label: 'Perfiles RBAC personalizados',
        group: 'acceso',
        description: 'Perfiles creados a mano. Conserva perfiles de sistema.',
    },
    {
        id: 'feligres',
        label: 'Usuarios feligreses',
        group: 'acceso',
        description: 'Cuentas sin rol de administración (kiosk / registro).',
    },
];

const CATEGORY_IDS = new Set(DEMO_WIPE_CATEGORIES.map((c) => c.id));

const OPERATIONAL_CATEGORY_IDS = DEMO_WIPE_CATEGORIES
    .filter((c) => c.group === 'operativo')
    .map((c) => c.id);

function normalizeCategoryIds(raw) {
    if (!Array.isArray(raw)) return [];
    return [...new Set(raw.map((id) => String(id).trim()).filter((id) => CATEGORY_IDS.has(id)))];
}

function expandCategoryDependencies(categoryIds) {
    const expanded = new Set(categoryIds);
    for (const cat of DEMO_WIPE_CATEGORIES) {
        if (!expanded.has(cat.id) || !cat.requires?.length) continue;
        for (const dep of cat.requires) expanded.add(dep);
    }
    return [...expanded];
}

async function clearUserReferences(userId, { clearAuditRefs = true } = {}) {
    await prisma.captainNotification.deleteMany({ where: { captainUserId: userId } });
    await prisma.captainRange.deleteMany({ where: { OR: [{ userId }, { createdById: userId }, { updatedById: userId }] } });
    await prisma.attendanceLog.deleteMany({ where: { userId } });
    await prisma.substitutionRequest.updateMany({ where: { captainUserId: userId }, data: { captainUserId: null } });
    await prisma.physicalQR.updateMany({ where: { generatedBy: userId }, data: { generatedBy: null } });
    await prisma.reservation.updateMany({ where: { userId }, data: { userId: null } });
    await prisma.adminRole.updateMany({ where: { createdById: userId }, data: { createdById: null } });
    if (clearAuditRefs) {
        await prisma.auditLog.updateMany({ where: { userId }, data: { userId: null } });
        await prisma.auditLog.updateMany({ where: { targetUserId: userId }, data: { targetUserId: null } });
    }
}

async function deleteUserById(userId) {
    await clearUserReferences(userId);
    await prisma.user.delete({ where: { id: userId } });
}

async function wipeSelectedCategories(rawCategoryIds, { excludeUserId } = {}) {
    const categoryIds = expandCategoryDependencies(normalizeCategoryIds(rawCategoryIds));
    if (categoryIds.length === 0) {
        const err = new Error('Selecciona al menos una categoría para borrar.');
        err.status = 400;
        throw err;
    }

    const selected = new Set(categoryIds);
    const deleted = {};

    const count = (key, result) => {
        deleted[key] = (deleted[key] || 0) + (result?.count ?? 0);
    };

    if (selected.has('substitutions') || selected.has('reservations')) {
        count('substitutions', await prisma.substitutionRequest.deleteMany());
    }

    if (selected.has('intentions')) {
        count('intentions', await prisma.prayerIntention.deleteMany());
    } else if (selected.has('reservations')) {
        await prisma.prayerIntention.updateMany({
            data: { assignedToReservationId: null, reservationId: null },
        });
    }

    if (selected.has('attendance')) {
        count('attendance', await prisma.attendanceLog.deleteMany());
    }

    if (selected.has('captains')) {
        count('captainNotifications', await prisma.captainNotification.deleteMany());
        count('captains', await prisma.captainRange.deleteMany());
    }

    if (selected.has('qrs')) {
        count('scanLogs', await prisma.scanLog.deleteMany());
        await prisma.reservation.updateMany({ data: { checkedInViaQrId: null } });
        count('qrs', await prisma.physicalQR.deleteMany());
    } else if (selected.has('reservations')) {
        count('scanLogs', await prisma.scanLog.deleteMany({ where: { reservationId: { not: null } } }));
    }

    if (selected.has('reservations')) {
        if (!selected.has('audit')) {
            await prisma.auditLog.updateMany({
                where: { reservationId: { not: null } },
                data: { reservationId: null },
            });
        }
        count('reservations', await prisma.reservation.deleteMany());
    }

    if (selected.has('slots')) {
        const remainingReservations = await prisma.reservation.count();
        if (remainingReservations > 0) {
            const err = new Error('No se pueden borrar turnos mientras existan reservas. Incluye «Reservas y compromisos».');
            err.status = 400;
            throw err;
        }
        count('slots', await prisma.slot.deleteMany());
    }

    if (selected.has('roster')) {
        count('roster', await prisma.rosterMember.deleteMany());
    }

    if (selected.has('audit')) {
        count('audit', await prisma.auditLog.deleteMany());
    }

    if (selected.has('feligres')) {
        const users = await prisma.user.findMany({
            where: {
                adminRoleId: null,
                id: excludeUserId ? { not: excludeUserId } : undefined,
            },
            select: { id: true },
        });
        for (const u of users) {
            await deleteUserById(u.id);
        }
        deleted.feligres = users.length;
    }

    if (selected.has('admins')) {
        const superRole = await prisma.adminRole.findUnique({ where: { slug: 'super-admin' } });
        const admins = await prisma.user.findMany({
            where: {
                adminRoleId: { not: null },
                ...(excludeUserId ? { id: { not: excludeUserId } } : {}),
                ...(superRole ? { NOT: { adminRoleId: superRole.id } } : {}),
            },
            select: { id: true },
        });
        for (const u of admins) {
            await deleteUserById(u.id);
        }
        deleted.admins = admins.length;
    }

    if (selected.has('profiles')) {
        const customRoles = await prisma.adminRole.findMany({
            where: { isSystem: false },
            select: { id: true },
        });
        const customRoleIds = customRoles.map((r) => r.id);
        if (customRoleIds.length) {
            const superRole = await prisma.adminRole.findUnique({ where: { slug: 'super-admin' } });
            await prisma.user.updateMany({
                where: {
                    adminRoleId: { in: customRoleIds },
                    ...(excludeUserId ? { id: { not: excludeUserId } } : {}),
                    ...(superRole ? { NOT: { adminRoleId: superRole.id } } : {}),
                },
                data: { adminRoleId: null, role: 'feligres' },
            });
            count('profiles', await prisma.adminRole.deleteMany({ where: { isSystem: false } }));
        } else {
            deleted.profiles = 0;
        }
    }

    return { categoryIds, deleted };
}

module.exports = {
    DEMO_WIPE_CATEGORIES,
    OPERATIONAL_CATEGORY_IDS,
    CATEGORY_IDS,
    normalizeCategoryIds,
    expandCategoryDependencies,
    wipeSelectedCategories,
};
