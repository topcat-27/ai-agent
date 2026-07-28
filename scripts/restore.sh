#!/usr/bin/env bash

set -euo pipefail

PROJECT_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
ENV_FILE="${PROJECT_ROOT}/.env"
BACKUP_DIR="${1:-}"

compose() {
  docker compose \
    --project-directory "${PROJECT_ROOT}" \
    --env-file "${ENV_FILE}" \
    -f "${PROJECT_ROOT}/compose.yaml" \
    "$@"
}

if [[ -z "${BACKUP_DIR}" ]]; then
  printf 'Usage: ./scripts/restore.sh backups/YYYYMMDD-HHMMSS\n' >&2
  exit 1
fi

if [[ ! -f "${ENV_FILE}" ]]; then
  printf 'Run local setup once before restoring a backup.\n' >&2
  exit 1
fi

BACKUP_DIR="$(cd "${BACKUP_DIR}" 2>/dev/null && pwd)" || {
  printf 'Backup directory does not exist.\n' >&2
  exit 1
}

if [[ ! -f "${BACKUP_DIR}/n8n-data.tar.gz" || ! -f "${BACKUP_DIR}/env.backup" ]]; then
  printf 'Backup is incomplete. Expected n8n-data.tar.gz and env.backup.\n' >&2
  exit 1
fi

printf 'This replaces all current local n8n users, credentials, workflows, and history.\n'
read -r -p 'Type RESTORE to continue: ' ANSWER
if [[ "${ANSWER}" != "RESTORE" ]]; then
  printf 'Restore cancelled.\n'
  exit 0
fi

if ! docker info >/dev/null 2>&1; then
  printf 'Docker Desktop is not running.\n' >&2
  exit 1
fi

compose stop >/dev/null

cp "${BACKUP_DIR}/env.backup" "${ENV_FILE}"
chmod 600 "${ENV_FILE}"

compose run --rm --no-deps \
  --user 0:0 \
  -v "${BACKUP_DIR}:/backup:ro" \
  --entrypoint /bin/sh \
  n8n \
  -c 'find /home/node/.n8n -mindepth 1 -maxdepth 1 -exec rm -rf -- {} + && tar -xzf /backup/n8n-data.tar.gz -C /home/node/.n8n'

compose up -d --wait --wait-timeout 240

printf 'Backup restored and the local stack is healthy.\n'
