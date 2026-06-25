#!/usr/bin/env bash
# Publica Adoratio en producción (rsync + PM2). Usa ~/.ssh/adoratio_do o Host "adoratio".
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
HOST="${DEPLOY_HOST:-adoratio}"
APP_DIR="${APP_DIR:-/var/www/adoratio-app}"
SSH_OPTS=(-o BatchMode=yes -o ConnectTimeout=15)

cd "$ROOT"

echo "==> Sincronizando archivos → ${HOST}:${APP_DIR}"
rsync -az --delete \
    --exclude node_modules \
    --exclude .git \
    --exclude .env \
    --exclude '*.db' \
    --exclude '*.db-journal' \
    --exclude .DS_Store \
    -e "ssh ${SSH_OPTS[*]}" \
    ./ "${HOST}:${APP_DIR}/"

echo "==> Instalando dependencias y reiniciando…"
ssh "${SSH_OPTS[@]}" "$HOST" bash -s <<EOF
set -euo pipefail
cd "$APP_DIR"
if [ -f package-lock.json ]; then npm ci --omit=dev; else npm install --omit=dev; fi
npx prisma generate
if grep -q 'file:' .env 2>/dev/null; then npx prisma db push; else npx prisma migrate deploy; fi
pm2 restart adoratio
sleep 5
curl -fsS http://127.0.0.1:3000/api/health
echo ""
echo "✔ Adoratio en línea"
EOF
