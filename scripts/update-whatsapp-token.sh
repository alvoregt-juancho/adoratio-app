#!/usr/bin/env bash
# Actualiza WHATSAPP_ACCESS_TOKEN en .env local y en producción (adorahora.com).
#
# Uso:
#   ./scripts/update-whatsapp-token.sh EAAxxxx...
#   WHATSAPP_ACCESS_TOKEN=EAAxxxx... ./scripts/update-whatsapp-token.sh
#
# El token permanente se genera en Meta Business Suite → Usuarios del sistema
# (no expira). NO uses el token temporal de "Generate token" en API Setup.
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
TOKEN="${1:-${WHATSAPP_ACCESS_TOKEN:-}}"
ENV_LOCAL="$ROOT/.env"
HOST="${DEPLOY_HOST:-adoratio}"
APP_DIR="${APP_DIR:-/var/www/adoratio-app}"

if [[ -z "$TOKEN" ]]; then
    echo "❌ Falta el token."
    echo ""
    echo "Uso: ./scripts/update-whatsapp-token.sh EAAxxxx..."
    echo ""
    echo "Obtener token permanente en Meta:"
    echo "  1. business.facebook.com → Configuración → Usuarios del sistema"
    echo "  2. Crear usuario del sistema → Asignar app WhatsApp + cuenta WABA"
    echo "  3. Generar token → permisos: whatsapp_business_messaging, whatsapp_business_management"
    echo "  4. Expiración: Nunca"
    exit 1
fi

if [[ ! "$TOKEN" =~ ^EAA ]]; then
    echo "⚠ El token suele empezar con EAA. Verifica que sea correcto."
fi

update_env_file() {
    local file="$1"
    if [[ ! -f "$file" ]]; then
        echo "❌ No existe: $file"
        return 1
    fi
    if grep -q '^WHATSAPP_ACCESS_TOKEN=' "$file"; then
        if [[ "$(uname)" == Darwin ]]; then
            sed -i '' "s|^WHATSAPP_ACCESS_TOKEN=.*|WHATSAPP_ACCESS_TOKEN=${TOKEN}|" "$file"
        else
            sed -i "s|^WHATSAPP_ACCESS_TOKEN=.*|WHATSAPP_ACCESS_TOKEN=${TOKEN}|" "$file"
        fi
    else
        echo "WHATSAPP_ACCESS_TOKEN=${TOKEN}" >> "$file"
    fi
    if ! grep -q '^WHATSAPP_ENABLED=true' "$file"; then
        echo "WHATSAPP_ENABLED=true" >> "$file"
    fi
    echo "✔ Actualizado: $file"
}

echo "==> Actualizando token en .env local…"
update_env_file "$ENV_LOCAL"

echo "==> Actualizando token en producción ($HOST)…"
ssh -o BatchMode=yes -o ConnectTimeout=15 "$HOST" bash -s <<REMOTE
set -euo pipefail
ENV="$APP_DIR/.env"
if grep -q '^WHATSAPP_ACCESS_TOKEN=' "\$ENV"; then
    sed -i "s|^WHATSAPP_ACCESS_TOKEN=.*|WHATSAPP_ACCESS_TOKEN=${TOKEN}|" "\$ENV"
else
    echo "WHATSAPP_ACCESS_TOKEN=${TOKEN}" >> "\$ENV"
fi
grep -q '^WHATSAPP_ENABLED=true' "\$ENV" || echo 'WHATSAPP_ENABLED=true' >> "\$ENV"
pm2 restart adoratio --update-env
echo "✔ PM2 reiniciado"
REMOTE

echo ""
echo "==> Probando API desde producción…"
sleep 8
ssh -o BatchMode=yes "$HOST" "cd $APP_DIR && node scripts/test-whatsapp.js" 2>&1 || {
    echo "⚠ Prueba de envío falló. Verifica Phone Number ID y destinatario de test."
}

echo ""
echo "✔ Token permanente configurado en local y producción."
