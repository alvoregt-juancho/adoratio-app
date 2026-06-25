#!/usr/bin/env bash
# Despliegue en el servidor (manual o vía GitHub Actions).
set -euo pipefail

APP_DIR="${APP_DIR:-/var/www/adoratio-app}"
BRANCH="${BRANCH:-main}"

cd "$APP_DIR"

echo "==> Actualizando código (${BRANCH})…"
git fetch origin "$BRANCH"
git checkout "$BRANCH"
git pull --ff-only origin "$BRANCH"

echo "==> Dependencias…"
if [ -f package-lock.json ]; then
    npm ci --omit=dev
else
    npm install --omit=dev
fi

echo "==> Prisma…"
npx prisma generate
if [ -f .env ] && grep -q 'file:' .env; then
    npx prisma db push
else
    npx prisma migrate deploy
fi

echo "==> Reiniciando PM2…"
if pm2 describe adoratio >/dev/null 2>&1; then
    pm2 restart adoratio
else
    pm2 start ecosystem.config.js
fi
pm2 save

echo "==> Health check…"
sleep 2
curl -fsS "http://127.0.0.1:${PORT:-3000}/api/health"
echo ""
echo "✔ Deploy completado."
