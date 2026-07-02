#!/usr/bin/env bash
# Run orphaned KBZ PWA draft reconciliation (schedule every 10–15 min via cron / GitHub Actions).
#
# Required env:
#   CLOUDBASE_API_BASE_URL      e.g. https://api.example.com/make-server-16010b6f
#   KPAY_PWA_RECONCILE_SECRET   same value as CloudBase Function secret
#
# Example crontab:
#   */15 * * * * CLOUDBASE_API_BASE_URL=... KPAY_PWA_RECONCILE_SECRET=... /path/to/scripts/kpay-pwa-reconcile.sh

set -euo pipefail

API_BASE_URL="${CLOUDBASE_API_BASE_URL:?Set CLOUDBASE_API_BASE_URL}"
SECRET="${KPAY_PWA_RECONCILE_SECRET:?Set KPAY_PWA_RECONCILE_SECRET}"
MIN_AGE="${KPAY_PWA_RECONCILE_MIN_AGE_MINUTES:-10}"
LIMIT="${KPAY_PWA_RECONCILE_LIMIT:-100}"

URL="${API_BASE_URL%/}/kpay/pwa/reconcile"

curl -fsS -X POST "$URL" \
  -H "Content-Type: application/json" \
  -H "x-kpay-reconcile-secret: ${SECRET}" \
  -d "{\"minAgeMinutes\":${MIN_AGE},\"limit\":${LIMIT}}"

echo ""
