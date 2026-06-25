const express = require('express');
const bcrypt = require('bcryptjs');
const prisma = require('../db');
const { signToken } = require('../middleware/auth');
const { decodePrivileges } = require('../constants/permissions');
const { writeAudit } = require('../utils/audit');
const { normalizePhone, isValidPhone } = require('../utils/phone');

const router = express.Router();

router.get('/', async (req, res) => {
    try {
        const user = await prisma.user.findUnique({
            where: { id: req.user.id },
            include: { adminRole: true },
        });
        if (!user) return res.status(404).json({ error: 'Usuario no encontrado.' });

        res.json({
            user: {
                id: user.id,
                name: user.name,
                email: user.email,
                phoneNumber: user.phoneNumber,
                adminRoleName: user.adminRole?.name ?? null,
                adminRoleDescription: user.adminRole?.description ?? null,
                privileges: req.user.privileges,
                permissionKeys: decodePrivileges(req.user.privileges),
                isScopedCaptain: req.isScopedCaptain ?? false,
            },
        });
    } catch (e) {
        console.error(e);
        res.status(500).json({ error: 'Error al cargar perfil.' });
    }
});

router.put('/', async (req, res) => {
    try {
        const name = req.body?.name ? String(req.body.name).trim() : '';
        const email = req.body?.email ? String(req.body.email).trim().toLowerCase() : '';
        const phoneRaw = req.body?.phoneNumber;

        if (!name) return res.status(400).json({ error: 'El nombre es requerido.' });
        if (!email) return res.status(400).json({ error: 'El correo es requerido.' });

        let phoneNumber = undefined;
        if (phoneRaw !== undefined && phoneRaw !== null && String(phoneRaw).trim() !== '') {
            phoneNumber = normalizePhone(phoneRaw);
            if (!isValidPhone(phoneNumber)) {
                return res.status(400).json({ error: 'El celular debe tener exactamente 8 dígitos.' });
            }
        } else if (phoneRaw === '' || phoneRaw === null) {
            phoneNumber = null;
        }

        const existing = await prisma.user.findUnique({ where: { id: req.user.id } });
        if (!existing) return res.status(404).json({ error: 'Usuario no encontrado.' });

        const emailTaken = await prisma.user.findFirst({
            where: { email, id: { not: req.user.id } },
        });
        if (emailTaken) {
            return res.status(409).json({ error: 'Ese correo ya está en uso por otra cuenta.' });
        }

        if (phoneNumber) {
            const phoneTaken = await prisma.user.findFirst({
                where: { phoneNumber, id: { not: req.user.id } },
            });
            if (phoneTaken) {
                return res.status(409).json({ error: 'Ese celular ya está registrado en otra cuenta.' });
            }
        }

        const data = { name, email };
        if (phoneNumber !== undefined) data.phoneNumber = phoneNumber;

        const updated = await prisma.user.update({
            where: { id: req.user.id },
            data,
            include: { adminRole: true },
        });

        await writeAudit({
            action: 'profile.update',
            entity: 'user',
            entityId: updated.id,
            userId: updated.id,
            meta: { name: updated.name, email: updated.email },
            req,
        });

        const token = signToken(updated, req.user.privileges);

        res.json({
            message: 'Perfil actualizado.',
            token,
            user: {
                id: updated.id,
                name: updated.name,
                email: updated.email,
                phoneNumber: updated.phoneNumber,
                adminRoleName: updated.adminRole?.name ?? null,
            },
        });
    } catch (e) {
        console.error(e);
        res.status(500).json({ error: 'Error al actualizar perfil.' });
    }
});

router.put('/password', async (req, res) => {
    try {
        const currentPassword = req.body?.currentPassword;
        const newPassword = req.body?.newPassword;

        if (!currentPassword || !newPassword) {
            return res.status(400).json({ error: 'Contraseña actual y nueva son requeridas.' });
        }
        if (String(newPassword).length < 6) {
            return res.status(400).json({ error: 'La nueva contraseña debe tener al menos 6 caracteres.' });
        }

        const user = await prisma.user.findUnique({ where: { id: req.user.id } });
        if (!user?.passwordHash) {
            return res.status(400).json({ error: 'No hay contraseña configurada en esta cuenta.' });
        }

        const ok = await bcrypt.compare(String(currentPassword), user.passwordHash);
        if (!ok) {
            return res.status(403).json({ error: 'La contraseña actual no es correcta.' });
        }

        const passwordHash = await bcrypt.hash(String(newPassword), 10);
        await prisma.user.update({
            where: { id: req.user.id },
            data: { passwordHash },
        });

        await writeAudit({
            action: 'profile.password_change',
            entity: 'user',
            entityId: user.id,
            userId: user.id,
            req,
        });

        res.json({ message: 'Contraseña actualizada correctamente.' });
    } catch (e) {
        console.error(e);
        res.status(500).json({ error: 'Error al cambiar contraseña.' });
    }
});

module.exports = router;
