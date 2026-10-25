#!/usr/bin/env bash
# Ship Agent Depot to a Vultr Cloud Compute instance and bring the stack up.
#
# Prereqs on the Vultr instance (Ubuntu): Docker + Compose plugin installed,
# and /opt/agent-depot/.env.production present (copy from .env.vultr.example).
#
# Usage:
#   VULTR_HOST=root@203.0.113.10 ./scripts/deploy-vultr.sh
set -euo pipefail

: "${VULTR_HOST:?Set VULTR_HOST, e.g. VULTR_HOST=root@YOUR_VULTR_IP}"
REMOTE_DIR="${REMOTE_DIR:-/opt/agent-depot}"

echo "==> Syncing source to ${VULTR_HOST}:${REMOTE_DIR}"
rsync -az --delete \
  --exclude node_modules \
  --exclude .next \
  --exclude .git \
  --exclude generated \
  --exclude '.env*' \
  --exclude .playwright-mcp \
  ./ "${VULTR_HOST}:${REMOTE_DIR}/"

echo "==> Building and starting the stack on the instance"
ssh "${VULTR_HOST}" bash -s <<REMOTE
set -euo pipefail
cd "${REMOTE_DIR}"
if [ ! -f .env.production ]; then
  echo "Missing ${REMOTE_DIR}/.env.production (copy from .env.vultr.example)" >&2
  exit 1
fi
docker compose -f compose.prod.yaml --env-file .env.production up -d --build
docker compose -f compose.prod.yaml ps
REMOTE

echo "==> Deployed. App is on port 80 of ${VULTR_HOST#*@}"
