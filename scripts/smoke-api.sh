#!/usr/bin/env bash
# Verificación rápida de endpoints públicos de Adoratio.
set -euo pipefail

BASE="${1:-http://127.0.0.1:3000}"

check_get() {
    local path="$1" expected="$2"
    local code
    code=$(curl -s -o /dev/null -w "%{http_code}" "$BASE$path")
    if [[ "$code" != "$expected" ]]; then
        echo "FAIL GET $path -> $code (expected $expected)"
        exit 1
    fi
    echo "OK   GET $path -> $code"
}

check_get "/api/health" 200
check_get "/api/settings" 200
check_get "/api/muro" 200
check_get "/api/slots?date=$(date +%Y-%m-%d)" 200

code=$(curl -s -o /dev/null -w "%{http_code}" -X POST "$BASE/api/muro" \
    -H "Content-Type: application/json" \
    -d '{"text":"smoke test","privacy":"anonymous"}')
if [[ "$code" != "201" ]]; then
    echo "FAIL POST /api/muro -> $code (expected 201)"
    exit 1
fi
echo "OK   POST /api/muro -> 201"

code=$(curl -s -o /dev/null -w "%{http_code}" -X POST "$BASE/api/kiosk/check-in" \
    -H "Content-Type: application/json" \
    -d '{"phone_number":"00000000"}')
if [[ "$code" != "404" ]]; then
    echo "FAIL POST /api/kiosk/check-in (unknown) -> $code (expected 404)"
    exit 1
fi
echo "OK   POST /api/kiosk/check-in (unknown) -> 404"

check_get "/chapel-registro-7f3c2a1b.html" 200

echo "Smoke tests passed for $BASE"
