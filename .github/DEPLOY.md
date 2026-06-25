# Publicar Adoratio en producción

## Método principal (desde tu Mac o Cursor)

```bash
npm run publish
```

Usa la clave SSH `~/.ssh/adoratio_do` y el host `adoratio` (ver `~/.ssh/config`).

No necesitas Git en el servidor: copia los archivos por rsync y reinicia PM2.

## Servidor

- **Host:** `68.183.112.115` (alias SSH: `adoratio`)
- **Ruta:** `/var/www/adoratio-app`
- **URL:** https://adorahora.com

## GitHub (código fuente)

```bash
git push origin main
```

> Nota: si el push falla por permiso `workflow`, es por archivos de GitHub Actions. El deploy en vivo no depende de eso; usa `npm run publish`.

## GitHub Actions (opcional)

Si más adelante quieres deploy automático al hacer push, crea los secretos `SSH_HOST`, `SSH_USER`, `SSH_PRIVATE_KEY` y habilita el workflow. Requiere un token de GitHub con scope `workflow`.
