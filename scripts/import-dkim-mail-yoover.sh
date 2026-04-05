#!/usr/bin/env bash
set -euo pipefail

PROJECT_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
KEY_FILE="${PROJECT_ROOT}/certs/dkim-mail-yoover-com.key"
PLUGIN_FILE="${PROJECT_ROOT}/config/zone-mta/plugins/file-dkim.toml"

cat <<EOF
WildDuck API import is no longer needed for Yoover DKIM.

This project now signs mail directly from:
  ${KEY_FILE}

ZoneMTA plugin config:
  ${PLUGIN_FILE}

Next steps on the VPS:
  1. Keep ${KEY_FILE} present
  2. Rebuild/restart ZoneMTA:
     docker compose up -d --build zonemta
  3. Check logs:
     docker compose logs --tail=80 zonemta

You should see:
  Initialized File DKIM Signer

Then send a test email to Gmail and inspect "signed-by".
EOF
