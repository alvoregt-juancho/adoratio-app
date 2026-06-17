const express = require('express');
const bcrypt = require('bcryptjs');
const prisma = require('../db');
const { signToken, requireAuth, buildSessionPayload, resolvePrivileges } = require('../middleware/auth');
const { sendVerification } = require('../utils/email');

const router = express.Router();

function genCode() {
    return String(Math.floor(100000 + Math.random() * 900000));
}

// POST /api/auth/register
router.post('/register', async (req, res) => {
    try {
        const { name, email, password } = req.body || {};
        if (!name || !email || !password) {
            return res.status(400).json({ error: 'Nombre, email y contraseña son requeridos.' });
        }
        const existing = await prisma.user.findUnique({ where: { email } });
        if (existing && existing.passwordHash) {
            return res.status(409).json({ error: 'Ya existe una cuenta con ese correo.' });
        }
        const passwordHash = await bcrypt.hash(password, 10);
        const code = genCode();
        const user = await prisma.user.upsert({
            where: { email },
            update: { name, passwordHash, verificationCode: code },
            create: { name, email, passwordHash, role: 'feligres', verificationCode: code },
        });
        await sendVerification({ to: email, name, code });
        return res.status(201).json({
            message: 'Cuenta creada. Revisa tu correo para verificarla.',
            userId: user.id,
        });
    } catch (e) {
        console.error(e);
        return res.status(500).json({ error: 'Error al registrar.' });
    }
});

// POST /api/auth/verify  { email, code }
router.post('/verify', async (req, res) => {
    try {
        const { email, code } = req.body || {};
        const user = await prisma.user.findUnique({ where: { email } });
        if (!user || user.verificationCode !== code) {
            return res.status(400).json({ error: 'Código inválido.' });
        }
        await prisma.user.update({
            where: { email },
            data: { emailVerified: true, verificationCode: null },
        });
        return res.json({ message: 'Correo verificado correctamente.' });
    } catch (e) {
        console.error(e);
        return res.status(500).json({ error: 'Error al verificar.' });
    }
});

// POST /api/auth/login  { email, password }
router.post('/login', async (req, res) => {
    try {
        const { email, password } = req.body || {};
        const user = await prisma.user.findUnique({
            where: { email },
            include: { adminRole: true },
        });
        if (!user || !user.passwordHash) {
            return res.status(401).json({ error: 'Credenciales inválidas.' });
        }
        const ok = await bcrypt.compare(password, user.passwordHash);
        if (!ok) {
            return res.status(401).json({ error: 'Credenciales inválidas.' });
        }
        const privileges = resolvePrivileges(user);
        const token = signToken(user, privileges);
        const session = await buildSessionPayload(user.id);
        return res.json({
            token,
            user: session.user,
            permissionNodes: session.permissionNodes,
        });
    } catch (e) {
        console.error(e);
        return res.status(500).json({ error: 'Error al iniciar sesión.' });
    }
});

// GET /api/auth/me
router.get('/me', requireAuth, (req, res) => {
    res.json({ user: req.user });
});

module.exports = router;
