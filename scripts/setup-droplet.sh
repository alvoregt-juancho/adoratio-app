#!/usr/bin/env bash
# Configuración inicial del Droplet Ubuntu 22.04 para Adoratio.
# Ejecutar como root o con sudo en el servidor.
set -euo pipefail

REPO_URL="${REPO_URL:-https://github.com/alvoregt-juancho/adoratio-app.git}"
APP_DIR="${APP_DIR:-/var/www/adoratio-app}"

echo "==> Actualizando paquetes del sistema…"
apt update && apt upgrade -y

echo "==> Instalando Node.js 18…"
curl -fsSL https://deb.nodesource.com/setup_18.x | bash -
apt install -y nodejs git

echo "==> Instalando PM2…"
npm install -g pm2

echo "==> Clonando repositorio…"
if [ -d "$APP_DIR/.git" ]; then
    cd "$APP_DIR"
    git pull
else
    git clone "$REPO_URL" "$APP_DIR"
    cd "$APP_DIR"
fi

echo "==> Instalando dependencias y generando cliente Prisma…"
npm install
npx prisma generate

if [ ! -f .env ]; then
    echo "==> Creando .env desde .env.example…"
    cp .env.example .env
    echo "⚠ Edita $APP_DIR/.env con BASE_URL, JWT_SECRET y credenciales SMTP antes de exponer el sitio."
fi

echo "==> Iniciando app con PM2…"
pm2 delete adoratio 2>/dev/null || true
pm2 start ecosystem.config.js
pm2 save
pm2 startup systemd -u "${SUDO_USER:-root}" --hp "$(eval echo ~${SUDO_USER:-root})"

echo "==> Listo. Verifica con: pm2 status && pm2 logs adoratio"
