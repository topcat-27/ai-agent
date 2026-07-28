#!/usr/bin/env bash

set -euo pipefail

PROJECT_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
PROJECT_NAME="ai-solopreneur-phase4-smoke"
CHAT_PORT="3320"
N8N_PORT="5698"
TEST_ENCRYPTION_KEY="fedcba9876543210fedcba9876543210fedcba9876543210fedcba9876543210"
SESSION_ID="11111111-1111-4111-8111-111111111111"

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
    -f "${PROJECT_ROOT}/tests/phase4/compose.mock.yaml" \
    "$@"
}

cleanup() {
  if [[ "${KEEP_PHASE4_SMOKE:-0}" == "1" ]]; then
    printf '\nKeeping the isolated Phase 4 smoke stack running for inspection.\n'
    printf '  Chat: http://localhost:%s\n' "${CHAT_PORT}"
    printf '  n8n:  http://localhost:%s\n' "${N8N_PORT}"
    return
  fi
  compose down --volumes --remove-orphans >/dev/null 2>&1 || true
}

fail() {
  printf 'Phase 4 smoke test failed: %s\n' "$1" >&2
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

expect_not_contains() {
  local actual="$1"
  local unexpected="$2"
  local label="$3"
  if [[ "${actual}" == *"${unexpected}"* ]]; then
    printf 'Expected %s not to contain:\n  %s\nActual:\n  %s\n' \
      "${label}" "${unexpected}" "${actual}" >&2
    exit 1
  fi
}

post_tool() {
  local path="$1"
  local body="$2"
  curl --fail --silent --show-error \
    -X POST "http://127.0.0.1:${N8N_PORT}/webhook/${path}" \
    -H 'Content-Type: application/json' \
    --data "${body}"
}

publish_workflow() {
  compose exec -T n8n n8n publish:workflow --id="$1" >/dev/null
}

trap cleanup EXIT INT TERM

if ! docker info >/dev/null 2>&1; then
  fail "Docker Desktop is not running."
fi

printf 'Resetting the isolated Phase 4 smoke project...\n'
compose down --volumes --remove-orphans >/dev/null 2>&1 || true

printf 'Validating all canonical workflow boundaries...\n'
docker run --rm \
  -v "${PROJECT_ROOT}:/workspace:ro" \
  -w /workspace \
  node:24.16.0-alpine3.22@sha256:191c9f0080fcbbc6547a85dc0ff7988072214a355aabdc1d2ec55a7dae5eea8a \
  node scripts/validate-workflows.mjs

printf 'Starting isolated n8n and the Anthropic API mock...\n'
compose up -d --wait --wait-timeout 240 anthropic-mock n8n

printf 'Importing the test credential, canonical workflows, and test harness...\n'
compose exec -T n8n \
  n8n import:credentials \
  --input=/opt/phase3-test/fixtures/mock-anthropic-credential.json >/dev/null
compose exec -T n8n \
  n8n import:workflow \
  --separate \
  --input=/opt/ai-solopreneur/workflows >/dev/null
compose exec -T n8n \
  n8n import:workflow \
  --separate \
  --input=/opt/phase4-test/workflows >/dev/null

workflow_list="$(compose exec -T n8n n8n list:workflow)"
for expected_workflow in \
  "phase3StartHere|00 - START HERE - Project Partner" \
  "phase4TaskSetup|10 - SETUP - Local Task Data" \
  "phase4ListTasks|20 - TOOL - list_tasks" \
  "phase4CreateTask|21 - TOOL - create_task" \
  "phase4UpdateTaskStatus|22 - TOOL - update_task_status" \
  "phase4TestHarness|PHASE 4 TEST HARNESS"; do
  expect_contains "${workflow_list}" "${expected_workflow}" "imported workflow list"
done

printf 'Publishing the isolated entry points and tool subworkflows...\n'
for workflow_id in \
  phase4TaskSetup \
  phase4ListTasks \
  phase4CreateTask \
  phase4UpdateTaskStatus \
  phase4TestHarness \
  phase3StartHere; do
  publish_workflow "${workflow_id}"
done
compose restart n8n >/dev/null
compose up -d --wait --wait-timeout 240 n8n >/dev/null

printf 'Creating the local tables and proving setup is repeatable...\n'
setup_response="$(
  curl \
    --retry 30 \
    --retry-delay 1 \
    --retry-all-errors \
    --fail \
    --silent \
    --show-error \
    -X POST "http://127.0.0.1:${N8N_PORT}/webhook/setup-task-data"
)"
expect_contains "${setup_response}" '"ok":true' "task setup response"
repeat_setup_response="$(
  curl --fail --silent --show-error \
    -X POST "http://127.0.0.1:${N8N_PORT}/webhook/setup-task-data"
)"
expect_contains "${repeat_setup_response}" '"ok":true' "repeated task setup response"

compose exec -T n8n \
  n8n unpublish:workflow --id=phase4TaskSetup >/dev/null
compose restart n8n >/dev/null
compose up -d --wait --wait-timeout 240 n8n >/dev/null
setup_status="$(
  curl --silent --output /dev/null --write-out '%{http_code}' \
    -X POST "http://127.0.0.1:${N8N_PORT}/webhook/setup-task-data"
)"
[[ "${setup_status}" == "404" ]] ||
  fail "temporary setup webhook remained available (${setup_status})"

printf 'Starting the chat gateway and checking the seeded source of truth...\n'
compose up -d --build --wait --wait-timeout 240 chat >/dev/null
initial_list="$(
  post_tool \
    "phase4-test-list" \
    "{\"sessionId\":\"${SESSION_ID}\",\"status\":\"all\",\"priority\":\"all\"}"
)"
expect_contains "${initial_list}" '"count":3' "initial task list"
expect_contains "${initial_list}" '"title":"Confirm the project outcome"' "initial task list"
expect_contains "${initial_list}" '"title":"Prepare the first-week plan"' "initial task list"
expect_contains "${initial_list}" '"title":"Review the launch checklist"' "initial task list"

printf 'Rejecting invalid list and create inputs without task writes...\n'
invalid_list="$(
  post_tool \
    "phase4-test-list" \
    "{\"sessionId\":\"${SESSION_ID}\",\"status\":\"nonsense\",\"priority\":\"all\"}"
)"
expect_contains "${invalid_list}" '"code":"INVALID_STATUS"' "invalid list response"
expect_not_contains "${invalid_list}" 'auditWarning' "invalid list response"

empty_title="$(
  post_tool \
    "phase4-test-create" \
    "{\"sessionId\":\"${SESSION_ID}\",\"requestId\":\"44444444-4444-4444-8444-444444444444\",\"title\":\"\",\"description\":\"Invalid\",\"status\":\"todo\",\"priority\":\"high\",\"dueDate\":\"\"}"
)"
expect_contains "${empty_title}" '"code":"EMPTY_TITLE"' "empty-title response"
expect_not_contains "${empty_title}" 'auditWarning' "empty-title response"

oversized_description="$(
  compose exec -T chat node -e "
const description = 'x'.repeat(2001);
fetch('http://n8n:5678/webhook/phase4-test-create', {
  method: 'POST',
  headers: {'Content-Type': 'application/json'},
  body: JSON.stringify({
    sessionId: '${SESSION_ID}',
    requestId: '45454545-4545-4454-8454-454545454545',
    title: 'Oversized description test',
    description,
    status: 'todo',
    priority: 'medium',
    dueDate: ''
  })
}).then((response) => response.text()).then(console.log);
"
)"
expect_contains \
  "${oversized_description}" \
  '"code":"DESCRIPTION_TOO_LONG"' \
  "oversized-description response"

printf 'Creating exactly one task across a repeated request...\n'
create_body="{\"sessionId\":\"${SESSION_ID}\",\"requestId\":\"55555555-5555-4555-8555-555555555555\",\"title\":\"Interview three pilot users\",\"description\":\"Ask each pilot about setup friction.\",\"status\":\"todo\",\"priority\":\"high\",\"dueDate\":\"\"}"
created="$(
  post_tool "phase4-test-create" "${create_body}"
)"
expect_contains "${created}" '"created":true' "created task response"
expect_contains "${created}" '"title":"Interview three pilot users"' "created task response"
created_id="$(
  printf '%s' "${created}" |
    sed -n 's/.*"task":{"id":\([0-9][0-9]*\).*/\1/p'
)"
[[ -n "${created_id}" ]] || fail "could not read the created task ID"

repeated_create="$(
  post_tool "phase4-test-create" "${create_body}"
)"
expect_contains "${repeated_create}" '"created":false' "repeated create response"
expect_contains "${repeated_create}" '"idempotent":true' "repeated create response"
expect_contains "${repeated_create}" "\"id\":${created_id}" "repeated create response"

conflicting_create="$(
  post_tool \
    "phase4-test-create" \
    "{\"sessionId\":\"${SESSION_ID}\",\"requestId\":\"55555555-5555-4555-8555-555555555555\",\"title\":\"Different task\",\"description\":\"Ask each pilot about setup friction.\",\"status\":\"todo\",\"priority\":\"high\",\"dueDate\":\"\"}"
)"
expect_contains \
  "${conflicting_create}" \
  '"code":"IDEMPOTENCY_CONFLICT"' \
  "conflicting create response"

after_create="$(
  post_tool \
    "phase4-test-list" \
    "{\"sessionId\":\"${SESSION_ID}\",\"status\":\"all\",\"priority\":\"all\"}"
)"
expect_contains "${after_create}" '"count":4' "task list after repeated create"

printf 'Rejecting invalid updates and applying one narrow status change...\n'
invalid_update="$(
  post_tool \
    "phase4-test-update" \
    "{\"sessionId\":\"${SESSION_ID}\",\"requestId\":\"66666666-6666-4666-8666-666666666666\",\"taskId\":${created_id},\"status\":\"not-valid\"}"
)"
expect_contains "${invalid_update}" '"code":"INVALID_STATUS"' "invalid update response"

missing_update="$(
  post_tool \
    "phase4-test-update" \
    "{\"sessionId\":\"${SESSION_ID}\",\"requestId\":\"67676767-6767-4676-8676-676767676767\",\"taskId\":99999,\"status\":\"done\"}"
)"
expect_contains "${missing_update}" '"code":"TASK_NOT_FOUND"' "missing task response"

update_body="{\"sessionId\":\"${SESSION_ID}\",\"requestId\":\"77777777-7777-4777-8777-777777777777\",\"taskId\":${created_id},\"status\":\"done\"}"
updated="$(
  post_tool "phase4-test-update" "${update_body}"
)"
expect_contains "${updated}" '"updated":true' "updated task response"
expect_contains "${updated}" '"status":"done"' "updated task response"

repeated_update="$(
  post_tool "phase4-test-update" "${update_body}"
)"
expect_contains "${repeated_update}" '"updated":false' "repeated update response"
expect_contains "${repeated_update}" '"idempotent":true' "repeated update response"

filtered_list="$(
  post_tool \
    "phase4-test-list" \
    "{\"sessionId\":\"${SESSION_ID}\",\"status\":\"done\",\"priority\":\"high\"}"
)"
expect_contains "${filtered_list}" '"count":1' "filtered task list"
expect_contains "${filtered_list}" '"title":"Interview three pilot users"' "filtered task list"

printf 'Checking complete, understandable tool audit records...\n'
audit_response="$(
  curl --fail --silent --show-error \
    "http://127.0.0.1:${N8N_PORT}/webhook/phase4-test-audit"
)"
expect_contains "${audit_response}" '"count":13' "tool audit response"
expect_contains "${audit_response}" '"toolName":"list_tasks"' "tool audit response"
expect_contains "${audit_response}" '"toolName":"create_task"' "tool audit response"
expect_contains "${audit_response}" '"toolName":"update_task_status"' "tool audit response"
expect_contains "${audit_response}" '"proposedInput":"' "tool audit response"
expect_contains "${audit_response}" '"result":"' "tool audit response"
expect_contains "${audit_response}" '"error":"Task title cannot be empty."' "tool audit response"

printf 'Exercising the agent read tool through the learner chat...\n'
agent_response="$(
  curl --fail --silent --show-error \
    -X POST "http://127.0.0.1:${CHAT_PORT}/api/chat" \
    -H 'Content-Type: application/json' \
    --data '{"sessionId":"88888888-8888-4888-8888-888888888888","message":"What tasks exist in my local project?"}'
)"
expect_contains "${agent_response}" 'I found 4 local tasks' "agent task response"
expect_contains "${agent_response}" 'Interview three pilot users' "agent task response"

mock_metrics="$(
  compose exec -T anthropic-mock \
    node -e "fetch('http://127.0.0.1:3401/metrics').then(r=>r.text()).then(console.log)"
)"
expect_contains "${mock_metrics}" '"toolUseResponses":1' "mock tool metrics"
expect_contains "${mock_metrics}" '"list_tasks"' "model-visible tools"
expect_contains "${mock_metrics}" '"create_task"' "model-visible tools"
expect_contains "${mock_metrics}" '"update_task_status"' "model-visible tools"

if compose logs anthropic-mock n8n chat | grep -q "${TEST_ENCRYPTION_KEY}"; then
  fail "a test encryption key appeared in container logs"
fi

printf '\nPhase 4 smoke test passed.\n'
printf '  Repeatable table setup:        ok\n'
printf '  Seeded source-of-truth tasks:  3\n'
printf '  Invalid input rejection:       ok\n'
printf '  Idempotent task creation:      ok\n'
printf '  Narrow status update:          ok\n'
printf '  Tool audit records:            13\n'
printf '  Agent read path:               list_tasks\n'
printf '  Chat-to-tool-to-task response: ok\n'
