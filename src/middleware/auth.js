const jwt = require('jsonwebtoken');
const config = require('../config');
const prisma = require('../db');
const {
    PRIV,
    ALL_PRIVILEGES,
    LEGACY_ROLE_PRIVILEGES,
    hasPermission,
    PERMISSION_NODES,
} = require('../constants/permissions');

const ROLE_RANK = { feligres: 0, lector: 1, admin: 2, superadmin: 3 };

function resolvePrivileges(user) {
    if (user.adminRole) return user.adminRole.privileges;
    return LEGACY_ROLE_PRIVILEGES[user.role] ?? 0;
}

function signToken(user, privileges) {
    const privs = privileges ?? resolvePrivileges(user);
    return jwt.sign(
        {
            id: user.id,
            email: user.email,
            role: user.role,
            name: user.name,
            adminRoleId: user.adminRoleId ?? null,
            privileges: privs,
        },
        config.jwtSecret,
        { expiresIn: config.jwtExpiresIn }
    );
}

function requireAuth(req, res, next) {
    const header = req.headers.authorization || '';
    const token = header.startsWith('Bearer ') ? header.slice(7) : null;
    if (!token) {
        return res.status(401).json({ error: 'No autenticado. Inicia sesión.' });
    }
    try {
        req.user = jwt.verify(token, config.jwtSecret);
        next();
    } catch (e) {
        return res.status(401).json({ error: 'Sesión inválida o expirada.' });
    }
}

/** Carga privilegios frescos desde BD (evita JWT obsoleto tras cambio de rol). */
async function attachPrivileges(req, res, next) {
    if (!req.user?.id) {
        return res.status(401).json({ error: 'No autenticado.' });
    }
    try {
        const user = await prisma.user.findUnique({
            where: { id: req.user.id },
            include: { adminRole: true },
        });
        if (!user) {
            return res.status(401).json({ error: 'Usuario no encontrado.' });
        }
        const privileges = resolvePrivileges(user);
        req.user = {
            id: user.id,
            email: user.email,
            name: user.name,
            role: user.role,
            adminRoleId: user.adminRoleId,
            adminRoleName: user.adminRole?.name ?? null,
            adminRoleSlug: user.adminRole?.slug ?? null,
            privileges,
            isSuperAdmin: hasPermission(privileges, ALL_PRIVILEGES),
        };
        next();
    } catch (e) {
        console.error(e);
        return res.status(500).json({ error: 'Error al verificar permisos.' });
    }
}

function requireAdminAccess(req, res, next) {
    if (!req.user) {
        return res.status(401).json({ error: 'No autenticado.' });
    }
    const privs = req.user.privileges ?? 0;
    const canEnter =
        hasPermission(privs, PRIV.DASHBOARD_VIEW) || hasPermission(privs, PRIV.CAPTAIN_VIEW);
    if (!canEnter && privs === 0) {
        return res.status(403).json({ error: 'No tienes acceso al panel de administración.' });
    }
    next();
}

function requirePermission(requiredBit) {
    return (req, res, next) => {
        if (!req.user) {
            return res.status(401).json({ error: 'No autenticado.' });
        }
        const privs = req.user.privileges ?? 0;
        if (!hasPermission(privs, requiredBit)) {
            return res.status(403).json({ error: 'No tienes permisos para esta acción.' });
        }
        next();
    };
}

// Compatibilidad: jerarquía legacy por rol string.
function requireRole(minRole) {
    return (req, res, next) => {
        if (!req.user) {
            return res.status(401).json({ error: 'No autenticado.' });
        }
        const userRank = ROLE_RANK[req.user.role] ?? -1;
        const needed = ROLE_RANK[minRole] ?? 99;
        if (userRank < needed) {
            return res.status(403).json({ error: 'No tienes permisos para esta acción.' });
        }
        next();
    };
}

async function buildSessionPayload(userId) {
    const user = await prisma.user.findUnique({
        where: { id: userId },
        include: { adminRole: true },
    });
    if (!user) return null;
    const privileges = resolvePrivileges(user);
    const captainRangeCount = await prisma.captainRange.count({
        where: { userId, isActive: true },
    });
    return {
        user: {
            id: user.id,
            name: user.name,
            email: user.email,
            role: user.role,
            adminRoleId: user.adminRoleId,
            adminRoleName: user.adminRole?.name ?? null,
            privileges,
            isSuperAdmin: hasPermission(privileges, ALL_PRIVILEGES),
            captainRangeCount,
            isScopedCaptain:
                captainRangeCount > 0 &&
                !hasPermission(privileges, PRIV.SLOTS_EDIT) &&
                !hasPermission(privileges, PRIV.USERS_MANAGE),
        },
        permissionNodes: PERMISSION_NODES,
    };
}

module.exports = {
    signToken,
    requireAuth,
    attachPrivileges,
    requireAdminAccess,
    requirePermission,
    requireRole,
    resolvePrivileges,
    buildSessionPayload,
    ROLE_RANK,
    PRIV,
};
