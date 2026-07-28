#!/usr/bin/env bash

set -euo pipefail

PROJECT_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
PROJECT_NAME="ai-solopreneur-phase3-smoke"
CHAT_PORT="3310"
N8N_PORT="5688"
TEST_ENCRYPTION_KEY="0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef"

export COMPOSE_PROJECT_NAME="${PROJECT_NAME}"
export CHAT_PORT
export N8N_PORT
export GENERIC_TIMEZONE="Australia/Melbourne"
export N8N_ENCRYPTION_KEY="${TEST_ENCRYPTION_KEY}"

compose() {
  docker compose \
    --project-directory "${PROJECT_ROOT}" \
    -p "${PROJECT_NAME}" \
    -f "${PROJECT_ROOT}/compose.yaml" \
    -f "${PROJECT_ROOT}/tests/phase3/compose.mock.yaml" \
    "$@"
}

cleanup() {
  if [[ "${KEEP_PHASE3_SMOKE:-0}" == "1" ]]; then
    printf '\nKeeping the isolated smoke stack running for inspection.\n'
    printf '  Chat: http://localhost:%s\n' "${CHAT_PORT}"
    printf '  n8n:  http://localhost:%s\n' "${N8N_PORT}"
    return
  fi
  compose down --volumes --remove-orphans >/dev/null 2>&1 || true
}

fail() {
  printf 'Phase 3 smoke test failed: %s\n' "$1" >&2
  exit 1
}

expect_contains() {
  local actual="$1"
  local expected="$2"
  local label="$3"
  if [[ "${actual}" != *"${expected}"* ]]; then
    printf 'Expected %s to contain:\n  %s\nActual:\n  %s\n' \
      "${label}" "${expected}" "${actual}" >&2
    exit 1
  fi
}

post_chat() {
  local session_id="$1"
  local message="$2"
  curl --fail --silent --show-error \
    -X POST "http://127.0.0.1:${CHAT_PORT}/api/chat" \
    -H 'Content-Type: application/json' \
    --data "$(printf '{"sessionId":"%s","message":"%s"}' "${session_id}" "${message}")"
}

trap cleanup EXIT INT TERM

if ! docker info >/dev/null 2>&1; then
  fail "Docker Desktop is not running."
fi

printf 'Resetting the isolated Phase 3 smoke project...\n'
compose down --volumes --remove-orphans >/dev/null 2>&1 || true

printf 'Validating committed workflow structure...\n'
docker run --rm \
  -v "${PROJECT_ROOT}:/workspace:ro" \
  -w /workspace \
  node:24.16.0-alpine3.22@sha256:191c9f0080fcbbc6547a85dc0ff7988072214a355aabdc1d2ec55a7dae5eea8a \
  node scripts/validate-workflows.mjs

printf 'Starting isolated n8n and the Anthropic API mock...\n'
compose up -d --wait --wait-timeout 240 anthropic-mock n8n

printf 'Importing the test credential and workflow exports...\n'
compose exec -T n8n \
  n8n import:credentials \
  --input=/opt/phase3-test/fixtures/mock-anthropic-credential.json >/dev/null
compose exec -T n8n \
  n8n import:workflow \
  --separate \
  --input=/opt/ai-solopreneur/workflows >/dev/null

workflow_list="$(compose exec -T n8n n8n list:workflow)"
expect_contains "${workflow_list}" \
  "phase3StartHere|00 - START HERE - Project Partner" \
  "imported workflow list"
expect_contains "${workflow_list}" \
  "phase3AgentHealth|90 - DEBUG - Agent Health" \
  "imported workflow list"

printf 'Publishing test workflow versions and restarting n8n...\n'
compose exec -T n8n n8n publish:workflow --id=phase3StartHere >/dev/null
compose exec -T n8n n8n publish:workflow --id=phase3AgentHealth >/dev/null
compose restart n8n >/dev/null
compose up -d --wait --wait-timeout 240 n8n >/dev/null

health_response="$(
  curl \
    --retry 30 \
    --retry-delay 1 \
    --retry-all-errors \
    --fail \
    --silent \
    --show-error \
    "http://127.0.0.1:${N8N_PORT}/webhook/agent-health"
)"
expect_contains "${health_response}" '"status":"ok"' "safe health response"
expect_contains "${health_response}" '"workflow":"agent-health"' "safe health response"

printf 'Proving malformed input cannot reach the model...\n'
invalid_response="$(
  curl --silent --show-error --write-out $'\n%{http_code}' \
    -X POST "http://127.0.0.1:${N8N_PORT}/webhook/chat" \
    -H 'Content-Type: application/json' \
    --data '{"sessionId":"not-a-uuid","message":"This must not reach Claude"}'
)"
invalid_status="${invalid_response##*$'\n'}"
invalid_body="${invalid_response%$'\n'*}"
[[ "${invalid_status}" == "400" ]] || fail "invalid request returned ${invalid_status}, not 400"
expect_contains "${invalid_body}" '"code":"INVALID_REQUEST"' "invalid response"

mock_metrics="$(
  compose exec -T anthropic-mock \
    node -e "fetch('http://127.0.0.1:3401/metrics').then(r=>r.text()).then(console.log)"
)"
expect_contains "${mock_metrics}" '"messageCalls":0' "mock metrics after invalid input"

printf 'Starting the chat gateway and exercising a successful reply...\n'
compose up -d --build --wait --wait-timeout 240 chat >/dev/null

basic_response="$(
  post_chat \
    "9d4482cf-f720-4f70-98af-e337db1a9d53" \
    "Help me plan this project"
)"
expect_contains "${basic_response}" \
  '"reply":"Mock Claude reply: Help me plan this project"' \
  "basic agent response"
expect_contains "${basic_response}" '"runId":"' "basic agent response"

printf 'Checking session memory and isolation...\n'
memory_session="11111111-1111-4111-8111-111111111111"
other_session="22222222-2222-4222-8222-222222222222"
post_chat "${memory_session}" "My launch is called Lantern." >/dev/null

remembered_response="$(
  post_chat "${memory_session}" "What is my launch called?"
)"
expect_contains "${remembered_response}" \
  '"reply":"Your launch is called Lantern."' \
  "same-session memory response"

isolated_response="$(
  post_chat "${other_session}" "What is my launch called?"
)"
expect_contains "${isolated_response}" \
  '"reply":"I do not know the launch name yet."' \
  "different-session response"

printf 'Checking the provider-output ceiling...\n'
compose exec -T chat node -e "
fetch('http://127.0.0.1:3000/api/chat', {
  method: 'POST',
  headers: {'Content-Type': 'application/json'},
  body: JSON.stringify({
    sessionId: '33333333-3333-4333-8333-333333333333',
    message: 'Give me a long response'
  })
}).then(async (response) => ({
  status: response.status,
  body: await response.json()
})).then(({status, body}) => {
  if (status !== 200 || body.reply?.length !== 8000) process.exit(1);
  console.log('Output capped at 8000 characters.');
});
"

printf 'Checking documented in-memory restart behaviour...\n'
compose restart n8n >/dev/null
compose up -d --wait --wait-timeout 240 n8n chat >/dev/null
curl \
  --retry 30 \
  --retry-delay 1 \
  --retry-all-errors \
  --fail \
  --silent \
  --show-error \
  "http://127.0.0.1:${N8N_PORT}/webhook/agent-health" >/dev/null
forgotten_response="$(
  post_chat "${memory_session}" "What is my launch called?"
)"
expect_contains "${forgotten_response}" \
  '"reply":"I do not know the launch name yet."' \
  "post-restart memory response"

if compose logs anthropic-mock n8n chat | grep -q "${TEST_ENCRYPTION_KEY}"; then
  fail "a test encryption key appeared in container logs"
fi

printf '\nPhase 3 smoke test passed.\n'
printf '  Workflow import and publication: ok\n'
printf '  Malformed request model calls:    0\n'
printf '  Chat-to-agent response:           ok\n'
printf '  Same-session memory:              ok\n'
printf '  Cross-session isolation:          ok\n'
printf '  Output ceiling:                   8000 characters\n'
printf '  Restart clears Simple Memory:     confirmed\n'
