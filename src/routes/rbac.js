const express = require('express');
const bcrypt = require('bcryptjs');
const prisma = require('../db');
const {
    attachPrivileges,
    requirePermission,
    PRIV,
    ALL_PRIVILEGES,
} = require('../middleware/auth');
const { PERMISSION_NODES, decodePrivileges } = require('../constants/permissions');
const { writeAudit } = require('../utils/audit');

const router = express.Router();

function slugify(name) {
    return String(name)
        .toLowerCase()
        .normalize('NFD')
        .replace(/[\u0300-\u036f]/g, '')
        .replace(/[^a-z0-9]+/g, '-')
        .replace(/^-|-$/g, '')
        .slice(0, 48) || 'rol';
}

// ── SESIÓN RBAC ───────────────────────────────────────────────────────
router.get('/session', attachPrivileges, (req, res) => {
    res.json({
        user: req.user,
        permissionNodes: PERMISSION_NODES,
    });
});

router.get('/permissions/nodes', attachPrivileges, requirePermission(PRIV.ROLES_VIEW), (req, res) => {
    res.json({ nodes: PERMISSION_NODES });
});

// ── PERFILES (ROLES) ──────────────────────────────────────────────────
router.get('/roles', attachPrivileges, requirePermission(PRIV.ROLES_VIEW), async (req, res) => {
    try {
        const roles = await prisma.adminRole.findMany({
            orderBy: [{ isSystem: 'desc' }, { name: 'asc' }],
            include: { _count: { select: { users: true } } },
        });
        res.json({
            roles: roles.map((r) => ({
                id: r.id,
                name: r.name,
                slug: r.slug,
                description: r.description,
                privileges: r.privileges,
                permissionKeys: decodePrivileges(r.privileges),
                isSystem: r.isSystem,
                userCount: r._count.users,
                createdAt: r.createdAt,
                updatedAt: r.updatedAt,
            })),
        });
    } catch (e) {
        console.error(e);
        res.status(500).json({ error: 'Error al obtener perfiles.' });
    }
});

router.post('/roles', attachPrivileges, requirePermission(PRIV.ROLES_MANAGE), async (req, res) => {
    try {
        const { name, description, privileges } = req.body || {};
        if (!name?.trim()) {
            return res.status(400).json({ error: 'El nombre del perfil es requerido.' });
        }
        const privInt = Number(privileges) || 0;
        if (privInt < 0 || privInt > ALL_PRIVILEGES) {
            return res.status(400).json({ error: 'Privilegios inválidos.' });
        }
        const baseSlug = slugify(name);
        let slug = baseSlug;
        let n = 1;
        while (await prisma.adminRole.findUnique({ where: { slug } })) {
            slug = `${baseSlug}-${++n}`;
        }
        const role = await prisma.adminRole.create({
            data: {
                name: name.trim(),
                slug,
                description: description?.trim() || null,
                privileges: privInt,
                createdById: req.user.id,
            },
        });
        await writeAudit({
            action: 'role.create',
            entity: 'admin_role',
            entityId: role.id,
            meta: { name: role.name, privileges: role.privileges },
            req,
        });
        res.status(201).json({ role });
    } catch (e) {
        console.error(e);
        if (e.code === 'P2002') return res.status(409).json({ error: 'Ya existe un perfil con ese nombre.' });
        res.status(500).json({ error: 'Error al crear el perfil.' });
    }
});

router.put('/roles/:id', attachPrivileges, requirePermission(PRIV.ROLES_MANAGE), async (req, res) => {
    try {
        const id = Number(req.params.id);
        const existing = await prisma.adminRole.findUnique({ where: { id } });
        if (!existing) return res.status(404).json({ error: 'Perfil no encontrado.' });
        if (existing.isSystem && existing.slug === 'super-admin') {
            return res.status(403).json({ error: 'El perfil Super Admin no puede modificarse.' });
        }
        const { name, description, privileges } = req.body || {};
        const data = {};
        if (name !== undefined) data.name = name.trim();
        if (description !== undefined) data.description = description?.trim() || null;
        if (privileges !== undefined) {
            const privInt = Number(privileges);
            if (privInt < 0 || privInt > ALL_PRIVILEGES) {
                return res.status(400).json({ error: 'Privilegios inválidos.' });
            }
            data.privileges = privInt;
        }
        const role = await prisma.adminRole.update({ where: { id }, data });
        await writeAudit({
            action: 'role.update',
            entity: 'admin_role',
            entityId: role.id,
            meta: { name: role.name, privileges: role.privileges, previous: existing.privileges },
            req,
        });
        res.json({ role });
    } catch (e) {
        console.error(e);
        res.status(500).json({ error: 'Error al actualizar el perfil.' });
    }
});

router.delete('/roles/:id', attachPrivileges, requirePermission(PRIV.ROLES_MANAGE), async (req, res) => {
    try {
        const id = Number(req.params.id);
        const existing = await prisma.adminRole.findUnique({
            where: { id },
            include: { _count: { select: { users: true } } },
        });
        if (!existing) return res.status(404).json({ error: 'Perfil no encontrado.' });
        if (existing.slug === 'super-admin') {
            return res.status(403).json({ error: 'El perfil Super Admin no puede eliminarse.' });
        }
        const reassignToRoleId = Number(req.body?.reassignToRoleId) || null;
        if (existing._count.users > 0) {
            if (!reassignToRoleId) {
                return res.status(409).json({
                    error: `Hay ${existing._count.users} administrador(es) con este perfil. Reasígnalos o indica otro perfil al eliminar.`,
                    userCount: existing._count.users,
                });
            }
            if (reassignToRoleId === id) {
                return res.status(400).json({ error: 'El perfil de reasignación debe ser distinto.' });
            }
            const targetRole = await prisma.adminRole.findUnique({ where: { id: reassignToRoleId } });
            if (!targetRole) return res.status(404).json({ error: 'Perfil de reasignación no encontrado.' });
            const legacyRole = targetRole.slug === 'super-admin' ? 'superadmin'
                : targetRole.privileges & PRIV.ROLES_MANAGE ? 'admin' : 'lector';
            await prisma.user.updateMany({
                where: { adminRoleId: id },
                data: { adminRoleId: reassignToRoleId, role: legacyRole },
            });
        }
        await prisma.adminRole.delete({ where: { id } });
        await writeAudit({
            action: 'role.delete',
            entity: 'admin_role',
            entityId: id,
            meta: { name: existing.name },
            req,
        });
        res.json({ message: 'Perfil eliminado.' });
    } catch (e) {
        console.error(e);
        res.status(500).json({ error: 'Error al eliminar el perfil.' });
    }
});

// ── ADMINISTRADORES ───────────────────────────────────────────────────
router.get('/users', attachPrivileges, requirePermission(PRIV.USERS_VIEW), async (req, res) => {
    try {
        const users = await prisma.user.findMany({
            where: {
                OR: [
                    { adminRoleId: { not: null } },
                    { role: { in: ['lector', 'admin', 'superadmin'] } },
                ],
            },
            include: { adminRole: true },
            orderBy: { name: 'asc' },
            take: 200,
        });
        res.json({
            users: users.map((u) => ({
                id: u.id,
                name: u.name,
                email: u.email,
                role: u.role,
                adminRoleId: u.adminRoleId,
                adminRoleName: u.adminRole?.name ?? null,
                createdAt: u.createdAt,
            })),
        });
    } catch (e) {
        console.error(e);
        res.status(500).json({ error: 'Error al obtener administradores.' });
    }
});

router.post('/users', attachPrivileges, requirePermission(PRIV.USERS_MANAGE), async (req, res) => {
    try {
        const { name, email, password, adminRoleId } = req.body || {};
        if (!name?.trim() || !email?.trim() || !password) {
            return res.status(400).json({ error: 'Nombre, correo y contraseña son requeridos.' });
        }
        const roleId = Number(adminRoleId);
        if (!roleId) return res.status(400).json({ error: 'Selecciona un perfil RBAC.' });
        const adminRole = await prisma.adminRole.findUnique({ where: { id: roleId } });
        if (!adminRole) return res.status(404).json({ error: 'Perfil no encontrado.' });

        const existing = await prisma.user.findUnique({ where: { email: email.trim() } });
        if (existing) {
            return res.status(409).json({ error: 'Ya existe un usuario con ese correo.' });
        }

        const passwordHash = await bcrypt.hash(password, 10);
        const legacyRole = adminRole.slug === 'super-admin' ? 'superadmin'
            : adminRole.privileges & PRIV.ROLES_MANAGE ? 'admin' : 'lector';

        const user = await prisma.user.create({
            data: {
                name: name.trim(),
                email: email.trim().toLowerCase(),
                passwordHash,
                role: legacyRole,
                adminRoleId: roleId,
                emailVerified: true,
            },
            include: { adminRole: true },
        });

        await writeAudit({
            action: 'user.create',
            entity: 'user',
            entityId: user.id,
            targetUserId: user.id,
            meta: { email: user.email, adminRoleId: roleId, adminRoleName: adminRole.name },
            req,
        });

        res.status(201).json({ user });
    } catch (e) {
        console.error(e);
        res.status(500).json({ error: 'Error al crear administrador.' });
    }
});

router.put('/users/:id/role', attachPrivileges, requirePermission(PRIV.USERS_MANAGE), async (req, res) => {
    try {
        const id = Number(req.params.id);
        const { adminRoleId } = req.body || {};
        const roleId = Number(adminRoleId);
        if (!roleId) return res.status(400).json({ error: 'adminRoleId requerido.' });

        const [user, adminRole] = await Promise.all([
            prisma.user.findUnique({ where: { id } }),
            prisma.adminRole.findUnique({ where: { id: roleId } }),
        ]);
        if (!user) return res.status(404).json({ error: 'Usuario no encontrado.' });
        if (!adminRole) return res.status(404).json({ error: 'Perfil no encontrado.' });

        const legacyRole = adminRole.slug === 'super-admin' ? 'superadmin'
            : adminRole.privileges & PRIV.ROLES_MANAGE ? 'admin' : 'lector';

        const updated = await prisma.user.update({
            where: { id },
            data: { adminRoleId: roleId, role: legacyRole },
            include: { adminRole: true },
        });

        await writeAudit({
            action: 'user.role.assign',
            entity: 'user',
            entityId: id,
            targetUserId: id,
            meta: {
                email: user.email,
                previousRoleId: user.adminRoleId,
                newRoleId: roleId,
                newRoleName: adminRole.name,
            },
            req,
        });

        res.json({ user: updated });
    } catch (e) {
        console.error(e);
        res.status(500).json({ error: 'Error al asignar perfil.' });
    }
});

// ── AUDITORÍA ─────────────────────────────────────────────────────────
router.get('/audit-logs', attachPrivileges, requirePermission(PRIV.AUDIT_VIEW), async (req, res) => {
    try {
        const limit = Math.min(Math.max(parseInt(req.query.limit, 10) || 50, 1), 200);
        const offset = Math.max(parseInt(req.query.offset, 10) || 0, 0);
        const action = req.query.action?.trim();
        const where = action ? { action: { contains: action } } : {};

        const [logs, total] = await Promise.all([
            prisma.auditLog.findMany({
                where,
                include: {
                    user: { select: { id: true, name: true, email: true } },
                    targetUser: { select: { id: true, name: true, email: true } },
                },
                orderBy: { createdAt: 'desc' },
                take: limit,
                skip: offset,
            }),
            prisma.auditLog.count({ where }),
        ]);

        res.json({
            logs: logs.map((l) => ({
                id: l.id,
                action: l.action,
                entity: l.entity,
                entityId: l.entityId,
                actor: l.user ? { id: l.user.id, name: l.user.name, email: l.user.email } : null,
                target: l.targetUser ? { id: l.targetUser.id, name: l.targetUser.name, email: l.targetUser.email } : null,
                meta: l.meta ? JSON.parse(l.meta) : null,
                ipAddress: l.ipAddress,
                createdAt: l.createdAt,
            })),
            total,
            limit,
            offset,
        });
    } catch (e) {
        console.error(e);
        res.status(500).json({ error: 'Error al obtener auditoría.' });
    }
});

// ── ZONA TEMPORAL: reset datos de demostración ───────────────────────
const { runDemoSeed } = require('../../prisma/demoData');
const {
    DEMO_WIPE_CATEGORIES,
    OPERATIONAL_CATEGORY_IDS,
    normalizeCategoryIds,
    expandCategoryDependencies,
} = require('../utils/demoWipe');

function requireSuperAdmin(req, res) {
    if (!req.user.isSuperAdmin && req.user.adminRoleSlug !== 'super-admin') {
        res.status(403).json({ error: 'Solo Super Admin puede gestionar los datos de demostración.' });
        return false;
    }
    return true;
}

router.get('/demo/categories', attachPrivileges, requirePermission(PRIV.AUDIT_VIEW), (req, res) => {
    if (!requireSuperAdmin(req, res)) return;
    res.json({
        categories: DEMO_WIPE_CATEGORIES,
        operationalIds: OPERATIONAL_CATEGORY_IDS,
    });
});

router.post('/demo/reset', attachPrivileges, requirePermission(PRIV.AUDIT_VIEW), async (req, res) => {
    try {
        if (!requireSuperAdmin(req, res)) return;
        if (String(req.body?.confirm || '').trim() !== 'BORRAR') {
            return res.status(400).json({ error: 'Escribe BORRAR en el campo de confirmación.' });
        }

        const categories = normalizeCategoryIds(req.body?.categories);
        if (categories.length === 0) {
            return res.status(400).json({ error: 'Selecciona al menos una categoría para borrar.' });
        }

        const reloadDemo = req.body?.reloadDemo !== false;
        const expanded = expandCategoryDependencies(categories);
        const counts = await runDemoSeed({
            adminId: req.user.id,
            wipeFirst: true,
            categories: expanded,
            reloadDemo,
        });

        await writeAudit({
            action: 'demo.reset.partial',
            entity: 'database',
            userId: req.user.id,
            meta: { categories: expanded, reloadDemo, ...counts },
            req,
        });

        const message = reloadDemo
            ? 'Datos seleccionados borrados y datos de demostración cargados donde correspondía.'
            : 'Datos seleccionados borrados.';

        res.json({ message, counts });
    } catch (e) {
        console.error(e);
        const status = e.status || 500;
        res.status(status).json({
            error: status === 500 ? 'Error al resetear los datos de demostración.' : e.message,
        });
    }
});

module.exports = router;
