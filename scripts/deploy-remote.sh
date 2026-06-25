#!/usr/bin/env bash
# Despliegue remoto de Adoratio en Ubuntu 24.04 (DigitalOcean)
set -euo pipefail

APP_DIR="/var/www/adoratio-app"
PUBLIC_IP="${PUBLIC_IP:-68.183.112.115}"

echo "==> Instalando dependencias del sistema…"
export DEBIAN_FRONTEND=noninteractive
apt-get update -qq
apt-get install -y -qq curl git build-essential python3

if ! command -v node >/dev/null 2>&1 || [[ "$(node -v)" != v18* ]]; then
    echo "==> Instalando Node.js 18…"
    curl -fsSL https://deb.nodesource.com/setup_18.x | bash -
    apt-get install -y -qq nodejs
fi

if ! command -v pm2 >/dev/null 2>&1; then
    echo "==> Instalando PM2…"
    npm install -g pm2
fi

mkdir -p "$APP_DIR"
cd "$APP_DIR"

echo "==> Instalando dependencias npm…"
npm install --omit=dev
npx prisma generate

if [ ! -f .env ]; then
    echo "==> Creando .env de producción…"
    JWT_SECRET=$(openssl rand -hex 32)
    cat > .env <<EOF
DATABASE_URL="file:./adoratio.db"
PORT=3000
BASE_URL="http://${PUBLIC_IP}:3000"
SCAN_ENDPOINT="/scan.html"
KIOSK_PAGE_PATH="/chapel-registro-7f3c2a1b.html"
KIOSK_MASK_URL="https://adorahora.com"
TZ="America/Costa_Rica"
JWT_SECRET="${JWT_SECRET}"
JWT_EXPIRES_IN="7d"
ADMIN_EMAIL="admin@adoratio.com"
ADMIN_PASSWORD="adoratio2026"
ADMIN_NAME="Administrador Parroquial"
EOF
fi

echo "==> Abriendo puerto 3000 en firewall…"
if command -v ufw >/dev/null 2>&1; then
    ufw allow OpenSSH >/dev/null 2>&1 || true
    ufw allow 3000/tcp >/dev/null 2>&1 || true
    ufw --force enable >/dev/null 2>&1 || true
fi

echo "==> Iniciando con PM2…"
pm2 delete adoratio 2>/dev/null || true
pm2 start ecosystem.config.js
pm2 save
STARTUP_CMD=$(pm2 startup systemd -u root --hp /root 2>&1 | grep -E '^sudo' || true)
if [ -n "$STARTUP_CMD" ]; then eval "$STARTUP_CMD"; fi

echo ""
echo "✔ Adoratio desplegado en http://${PUBLIC_IP}:3000"
echo "  Admin: admin@adoratio.com / adoratio2026"
pm2 status
