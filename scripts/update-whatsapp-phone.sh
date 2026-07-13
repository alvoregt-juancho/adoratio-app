#!/usr/bin/env bash
# Actualiza Phone Number ID y país en .env local y producción.
# Uso: ./scripts/update-whatsapp-phone.sh 1180706915133298 502
set -euo pipefail

PHONE_ID="${1:-1180706915133298}"
COUNTRY="${2:-502}"
HOST="${DEPLOY_HOST:-adoratio}"
APP_DIR="${APP_DIR:-/var/www/adoratio-app}"
ROOT="$(cd "$(dirname "$0")/.." && pwd)"

update_file() {
    local file="$1"
    for pair in "WHATSAPP_PHONE_NUMBER_ID=${PHONE_ID}" "WHATSAPP_COUNTRY_CODE=${COUNTRY}"; do
        key="${pair%%=*}"
        val="${pair#*=}"
        if grep -q "^${key}=" "$file"; then
            if [[ "$(uname)" == Darwin ]]; then
                sed -i '' "s|^${key}=.*|${key}=${val}|" "$file"
            else
                sed -i "s|^${key}=.*|${key}=${val}|" "$file"
            fi
        else
            echo "${key}=${val}" >> "$file"
        fi
    done
}

echo "==> Actualizando Phone Number ID: ${PHONE_ID} (país ${COUNTRY})"
update_file "$ROOT/.env"

ssh -o BatchMode=yes "$HOST" bash -s <<REMOTE
set -euo pipefail
ENV="$APP_DIR/.env"
sed -i "s|^WHATSAPP_PHONE_NUMBER_ID=.*|WHATSAPP_PHONE_NUMBER_ID=${PHONE_ID}|" "\$ENV"
sed -i "s|^WHATSAPP_COUNTRY_CODE=.*|WHATSAPP_COUNTRY_CODE=${COUNTRY}|" "\$ENV"
grep -q '^WHATSAPP_PHONE_NUMBER_ID=' "\$ENV" || echo 'WHATSAPP_PHONE_NUMBER_ID=${PHONE_ID}' >> "\$ENV"
grep -q '^WHATSAPP_COUNTRY_CODE=' "\$ENV" || echo 'WHATSAPP_COUNTRY_CODE=${COUNTRY}' >> "\$ENV"
pm2 restart adoratio --update-env
echo "✔ Producción actualizada"
REMOTE

echo "✔ Listo. Verifica con: npm run test:whatsapp"
