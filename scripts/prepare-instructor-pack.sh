#!/usr/bin/env bash

set -euo pipefail

PROJECT_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
VERSION="$(tr -d '[:space:]' <"${PROJECT_ROOT}/VERSION")"
OUTPUT_ROOT="${PROJECT_ROOT}/instructor-pack"
METADATA_ONLY=false
N8N_IMAGE="docker.n8n.io/n8nio/n8n:2.30.5@sha256:450853cd21a2ce36587c4c860eb26927c1ceba9496bf55f4c213b5d3a6dc8c6f"
NODE_IMAGE="node:24.16.0-alpine3.22@sha256:191c9f0080fcbbc6547a85dc0ff7988072214a355aabdc1d2ec55a7dae5eea8a"
CHAT_IMAGE="ai-solopreneur-chat:${VERSION}"

usage() {
  printf 'Usage: ./scripts/prepare-instructor-pack.sh [--output DIRECTORY] [--metadata-only]\n'
}

while [[ "$#" -gt 0 ]]; do
  case "$1" in
    --output)
      [[ "$#" -ge 2 ]] || {
        usage >&2
        exit 2
      }
      OUTPUT_ROOT="$2"
      shift 2
      ;;
    --metadata-only)
      METADATA_ONLY=true
      shift
      ;;
    --help|-h)
      usage
      exit 0
      ;;
    *)
      printf 'Unknown option: %s\n' "$1" >&2
      usage >&2
      exit 2
      ;;
  esac
done

if [[ "${METADATA_ONLY}" == "true" ]]; then
  PLATFORM="metadata-test"
  COMMIT="uncommitted-validation"
else
  if [[ -n "$(git -C "${PROJECT_ROOT}" status --porcelain)" ]]; then
    printf 'The Git worktree has uncommitted changes.\n' >&2
    printf 'Commit or discard them before creating a release kit so its source and commit agree.\n' >&2
    exit 1
  fi
  if ! docker info >/dev/null 2>&1; then
    printf 'Docker Desktop is not running. Open it, wait until ready, and try again.\n' >&2
    exit 1
  fi
  PLATFORM="$(
    docker info --format '{{.OSType}}-{{.Architecture}}' |
      tr '[:upper:]/' '[:lower:]-'
  )"
  COMMIT="$(git -C "${PROJECT_ROOT}" rev-parse HEAD)"
fi

PACK_DIR="${OUTPUT_ROOT}/v${VERSION}-${PLATFORM}"
if [[ -e "${PACK_DIR}" ]]; then
  printf 'Instructor pack already exists:\n  %s\n' "${PACK_DIR}" >&2
  printf 'Move or remove that specific folder before creating it again.\n' >&2
  exit 1
fi

mkdir -p "${PACK_DIR}/workflows"

if [[ "${METADATA_ONLY}" == "true" ]]; then
  node "${PROJECT_ROOT}/scripts/validate-release.mjs"
  node "${PROJECT_ROOT}/scripts/validate-workflows.mjs"
else
  docker run --rm \
    -v "${PROJECT_ROOT}:/workspace:ro" \
    -w /workspace \
    "${NODE_IMAGE}" \
    node scripts/validate-release.mjs
  docker run --rm \
    -v "${PROJECT_ROOT}:/workspace:ro" \
    -w /workspace \
    "${NODE_IMAGE}" \
    node scripts/validate-workflows.mjs
fi

cp "${PROJECT_ROOT}"/n8n/workflows/*.json "${PACK_DIR}/workflows/"

{
  printf 'AI Solopreneur instructor kit\n'
  printf 'Version: %s\n' "${VERSION}"
  printf 'Commit: %s\n' "${COMMIT}"
  printf 'Platform: %s\n' "${PLATFORM}"
  printf 'n8n image: %s\n' "${N8N_IMAGE}"
  printf 'Node image: %s\n' "${NODE_IMAGE}"
  printf 'Chat image: %s\n' "${CHAT_IMAGE}"
  printf 'Generated UTC: %s\n' "$(date -u '+%Y-%m-%dT%H:%M:%SZ')"
} >"${PACK_DIR}/RELEASE-METADATA.txt"

cat >"${PACK_DIR}/LOAD_IMAGES.md" <<EOF
# Load the workshop images

This kit is for **${PLATFORM}** and AI Solopreneur **v${VERSION}**.

1. Install and open Docker Desktop.
2. Wait until its engine reports ready.
3. Open a terminal in this folder.
4. Load the archive:

\`\`\`bash
gunzip -c docker-images-${PLATFORM}.tar.gz | docker load
\`\`\`

5. Confirm these images appear:

- \`${N8N_IMAGE}\`
- \`${CHAT_IMAGE}\`

The archive reduces workshop downloads. Real Claude messages still require
internet access and each learner's private Anthropic API key.
EOF

if [[ "${METADATA_ONLY}" == "false" ]]; then
  printf 'Pulling locked images...\n'
  docker pull "${N8N_IMAGE}"
  docker pull "${NODE_IMAGE}"

  printf 'Building the versioned chat image...\n'
  docker build \
    --tag "${CHAT_IMAGE}" \
    "${PROJECT_ROOT}/apps/chat"

  printf 'Saving runtime images for %s...\n' "${PLATFORM}"
  docker image save \
    "${N8N_IMAGE}" \
    "${NODE_IMAGE}" \
    "${CHAT_IMAGE}" |
    gzip -9 >"${PACK_DIR}/docker-images-${PLATFORM}.tar.gz"

  git -C "${PROJECT_ROOT}" archive \
    --format=tar.gz \
    --prefix="ai-solopreneur-v${VERSION}/" \
    --output="${PACK_DIR}/ai-solopreneur-v${VERSION}-source.tar.gz" \
    HEAD
fi

(
  cd "${PACK_DIR}"
  find . -type f ! -name SHA256SUMS -print |
    LC_ALL=C sort |
    while IFS= read -r file; do
      shasum -a 256 "${file#./}"
    done >SHA256SUMS
)

printf '\nInstructor kit created at:\n  %s\n' "${PACK_DIR}"
if [[ "${METADATA_ONLY}" == "true" ]]; then
  printf 'Metadata-only mode did not save Docker images or the Git source archive.\n'
else
  printf 'Keep the kit private until you have checked it and copied it securely.\n'
fi
