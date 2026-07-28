#!/usr/bin/env bash

set -euo pipefail

PROJECT_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
TEMP_ROOT="$(mktemp -d "${TMPDIR:-/tmp}/ai-solopreneur-phase6.XXXXXX")"
COPY_ROOT="${TEMP_ROOT}/template-copy"
COMPOSE_PROJECT_NAME="ai-solopreneur-phase6-smoke"
CHAT_PORT="3340"
N8N_PORT="5718"
TEST_ENCRYPTION_KEY="abcdef0123456789abcdef0123456789abcdef0123456789abcdef0123456789"
SESSION_ID="66666666-6666-4666-8666-666666666666"
KEEP_SMOKE="${KEEP_PHASE6_SMOKE:-0}"

fail() {
  printf 'Phase 6 smoke test failed: %s\n' "$1" >&2
  exit 1
}

expect_contains() {
  local value="$1"
  local expected="$2"
  local label="$3"
  [[ "${value}" == *"${expected}"* ]] ||
    fail "${label} did not contain ${expected}"
}

expect_not_contains() {
  local value="$1"
  local unexpected="$2"
  local label="$3"
  [[ "${value}" != *"${unexpected}"* ]] ||
    fail "${label} unexpectedly contained ${unexpected}"
}

compose() {
  docker compose \
    --project-directory "${COPY_ROOT}" \
    --env-file "${COPY_ROOT}/.env" \
    -f "${COPY_ROOT}/compose.yaml" \
    "$@"
}

cleanup() {
  if [[ "${KEEP_SMOKE}" == "1" ]]; then
    printf '\nKeeping the isolated Phase 6 stack and template copy for visual inspection.\n'
    printf '  Chat:         http://localhost:%s\n' "${CHAT_PORT}"
    printf '  n8n:          http://localhost:%s\n' "${N8N_PORT}"
    printf '  Template copy: %s\n' "${COPY_ROOT}"
    return
  fi

  if [[ -f "${COPY_ROOT}/.env" ]]; then
    compose down --volumes --remove-orphans >/dev/null 2>&1 || true
  fi
  if [[ -n "${TEMP_ROOT}" && "${TEMP_ROOT}" == "${TMPDIR:-/tmp}/ai-solopreneur-phase6."* ]]; then
    find "${TEMP_ROOT}" -depth -mindepth 1 -delete >/dev/null 2>&1 || true
    rmdir "${TEMP_ROOT}" >/dev/null 2>&1 || true
  fi
}

trap cleanup EXIT INT TERM

if ! docker info >/dev/null 2>&1; then
  fail "Docker Desktop is not running"
fi

printf 'Validating the template package and canonical workflows...\n'
docker run --rm \
  -v "${PROJECT_ROOT}:/workspace:ro" \
  -w /workspace \
  node:24.16.0-alpine3.22@sha256:191c9f0080fcbbc6547a85dc0ff7988072214a355aabdc1d2ec55a7dae5eea8a \
  node scripts/validate-template-readiness.mjs
docker run --rm \
  -v "${PROJECT_ROOT}:/workspace:ro" \
  -w /workspace \
  node:24.16.0-alpine3.22@sha256:191c9f0080fcbbc6547a85dc0ff7988072214a355aabdc1d2ec55a7dae5eea8a \
  node scripts/validate-workflows.mjs

printf 'Creating a fresh template-style project copy...\n'
mkdir -p "${COPY_ROOT}"
tar \
  -C "${PROJECT_ROOT}" \
  --exclude='./.git' \
  --exclude='./.env' \
  --exclude='./backups/*' \
  --exclude='./n8n/exports/*' \
  -cf - . | tar -C "${COPY_ROOT}" -xf -

{
  printf 'COMPOSE_PROJECT_NAME=%s\n' "${COMPOSE_PROJECT_NAME}"
  printf 'CHAT_PORT=%s\n' "${CHAT_PORT}"
  printf 'N8N_PORT=%s\n' "${N8N_PORT}"
  printf 'GENERIC_TIMEZONE=Australia/Melbourne\n'
  printf 'N8N_ENCRYPTION_KEY=%s\n' "${TEST_ENCRYPTION_KEY}"
} >"${COPY_ROOT}/.env"
chmod 600 "${COPY_ROOT}/.env"

printf 'Running the same one-click setup a learner uses...\n'
first_setup_output="$("${COPY_ROOT}/scripts/setup.sh" 2>&1)"
expect_contains "${first_setup_output}" \
  "Installing the reviewed workflows, sample data, and enabled skills" \
  "first setup output"
expect_contains "${first_setup_output}" \
  "Local stack is healthy" \
  "first setup output"
expect_contains "${first_setup_output}" \
  "01 - START HERE - Learner Checklist" \
  "first setup output"

curl --fail --silent --show-error \
  "http://127.0.0.1:${CHAT_PORT}/health" >/dev/null
curl --fail --silent --show-error \
  "http://127.0.0.1:${N8N_PORT}/healthz" >/dev/null

workflow_list="$(compose exec -T n8n n8n list:workflow)"
for workflow in \
  "phase3StartHere|00 - START HERE - Project Partner" \
  "phase6LearnerChecklist|01 - START HERE - Learner Checklist" \
  "phase4TaskSetup|10 - SETUP - Local Task Data" \
  "phase5SyncEnabledSkills|11 - SETUP - Sync Enabled Skills" \
  "phase4ListTasks|20 - TOOL - list_tasks" \
  "phase4CreateTask|21 - TOOL - create_task" \
  "phase4UpdateTaskStatus|22 - TOOL - update_task_status" \
  "phase5ProposeCreateTask|30 - TOOL - Propose create_task" \
  "phase5ProposeTaskStatus|31 - TOOL - Propose update_task_status" \
  "phase5ConfirmTaskWrite|40 - CONFIRM - Task Write" \
  "phase3AgentHealth|90 - DEBUG - Agent Health"; do
  expect_contains "${workflow_list}" "${workflow}" "automatic workflow import"
done

compose exec -T n8n \
  n8n export:workflow \
  --all \
  --output=/tmp/phase6-all-workflows.json >/dev/null
compose exec -T n8n node -e "
const fs = require('fs');
const workflows = JSON.parse(fs.readFileSync('/tmp/phase6-all-workflows.json', 'utf8'));
const canonical = workflows.filter((workflow) => /^phase[3456]/.test(workflow.id));
const active = canonical.filter((workflow) => workflow.active).map((workflow) => workflow.id).sort();
const expectedActive = [
  'phase4CreateTask',
  'phase4ListTasks',
  'phase4UpdateTaskStatus',
  'phase5ConfirmTaskWrite',
  'phase5ProposeCreateTask',
  'phase5ProposeTaskStatus',
].sort();
if (canonical.length !== 11 || JSON.stringify(active) !== JSON.stringify(expectedActive)) {
  console.error({canonical: canonical.length, active});
  process.exit(1);
}
"
compose exec -T n8n \
  sh -c "rm -f -- /tmp/phase6-all-workflows.json" >/dev/null

printf 'Inspecting automatically created tasks and enabled skills...\n'
n8n_container="$(compose ps -q n8n)"
docker cp \
  "${COPY_ROOT}/tests/phase4/workflows/phase4-tool-harness.json" \
  "${n8n_container}:/tmp/phase4-tool-harness.json"
docker cp \
  "${COPY_ROOT}/tests/phase5/workflows/phase5-confirmation-harness.json" \
  "${n8n_container}:/tmp/phase5-confirmation-harness.json"
compose exec -T n8n \
  n8n import:workflow --input=/tmp/phase4-tool-harness.json >/dev/null
compose exec -T n8n \
  n8n import:workflow --input=/tmp/phase5-confirmation-harness.json >/dev/null
compose exec -T n8n \
  n8n publish:workflow --id=phase4TestHarness >/dev/null
compose exec -T n8n \
  n8n publish:workflow --id=phase5TestHarness >/dev/null
compose restart n8n >/dev/null
compose up -d --wait --wait-timeout 240 n8n >/dev/null

task_list="$(
  curl \
    --retry 30 \
    --retry-delay 1 \
    --retry-all-errors \
    --fail \
    --silent \
    --show-error \
    -X POST "http://127.0.0.1:${N8N_PORT}/webhook/phase4-test-list" \
    -H 'Content-Type: application/json' \
    --data "{\"sessionId\":\"${SESSION_ID}\",\"status\":\"all\",\"priority\":\"all\"}"
)"
expect_contains "${task_list}" '"count":3' "automatic sample data"
skill_config="$(
  curl --fail --silent --show-error \
    "http://127.0.0.1:${N8N_PORT}/webhook/phase5-test-config"
)"
expect_contains "${skill_config}" '"count":1' "automatic enabled skills"
expect_contains "${skill_config}" 'project-assistant' "automatic enabled skills"

printf 'Proving the manual import fallback is repeatable...\n'
"${COPY_ROOT}/scripts/import-workflows.sh" >/dev/null
task_list_after_import="$(
  curl \
    --retry 30 \
    --retry-delay 1 \
    --retry-all-errors \
    --fail \
    --silent \
    --show-error \
    -X POST "http://127.0.0.1:${N8N_PORT}/webhook/phase4-test-list" \
    -H 'Content-Type: application/json' \
    --data "{\"sessionId\":\"${SESSION_ID}\",\"status\":\"all\",\"priority\":\"all\"}"
)"
expect_contains "${task_list_after_import}" '"count":3' "repeat manual import"

printf 'Proving a later setup run preserves local workflow edits...\n'
sed \
  's/01 - START HERE - Learner Checklist/01 - START HERE - Learner Checklist [LOCAL EDIT]/' \
  "${COPY_ROOT}/n8n/workflows/01-start-here-learner-checklist.json" \
  >"${TEMP_ROOT}/custom-checklist.json"
docker cp \
  "${TEMP_ROOT}/custom-checklist.json" \
  "${n8n_container}:/tmp/custom-checklist.json"
compose exec -T n8n \
  n8n import:workflow --input=/tmp/custom-checklist.json >/dev/null

second_setup_output="$("${COPY_ROOT}/scripts/setup.sh" 2>&1)"
expect_contains "${second_setup_output}" \
  "already installed; keeping local edits unchanged" \
  "repeated setup output"
workflow_list_after_setup="$(compose exec -T n8n n8n list:workflow)"
expect_contains "${workflow_list_after_setup}" \
  "phase6LearnerChecklist|01 - START HERE - Learner Checklist [LOCAL EDIT]" \
  "preserved local workflow"

printf 'Exporting normalised workflow copies for Git review...\n'
"${COPY_ROOT}/scripts/export-workflows.sh" >/dev/null
latest_export_directory="$(
  find "${COPY_ROOT}/n8n/exports" \
    -mindepth 1 \
    -maxdepth 1 \
    -type d \
    | sort \
    | tail -n 1
)"
[[ -n "${latest_export_directory}" ]] ||
  fail "workflow export directory was not created"
docker run --rm \
  -v "${latest_export_directory}:/exports:ro" \
  node:24.16.0-alpine3.22@sha256:191c9f0080fcbbc6547a85dc0ff7988072214a355aabdc1d2ec55a7dae5eea8a \
  node -e "
const fs = require('fs');
const files = fs.readdirSync('/exports').filter((file) => file.endsWith('.json'));
if (files.length !== 11) process.exit(1);
for (const file of files) {
  const workflow = JSON.parse(fs.readFileSync('/exports/' + file, 'utf8'));
  if (Array.isArray(workflow) || workflow.active !== false) process.exit(1);
  for (const key of ['activeVersionId','createdAt','shared','updatedAt','versionCounter']) {
    if (Object.hasOwn(workflow, key)) process.exit(1);
  }
}
const main = JSON.parse(fs.readFileSync('/exports/00-start-here-project-partner.json', 'utf8'));
const credential = main.nodes.find((node) => node.name === 'Claude - Sonnet 4.6').credentials.anthropicApi;
if (credential.id !== 'phase3Anthropic' || credential.name !== 'Anthropic account') process.exit(1);
"

printf 'Checking friendly diagnostics before and after agent configuration...\n'
set +e
diagnostic_before="$("${COPY_ROOT}/scripts/diagnose.sh" 2>&1)"
diagnostic_status=$?
set -e
[[ "${diagnostic_status}" -ne 0 ]] ||
  fail "diagnostics unexpectedly passed before credential and publication"
expect_contains "${diagnostic_before}" \
  "[ok]   The learner checklist is installed" \
  "pre-configuration diagnostics"
expect_contains "${diagnostic_before}" \
  "[next] Create an Anthropic credential" \
  "pre-configuration diagnostics"
expect_contains "${diagnostic_before}" \
  "[next] Open 00 - START HERE - Project Partner" \
  "pre-configuration diagnostics"

docker cp \
  "${COPY_ROOT}/tests/phase3/fixtures/mock-anthropic-credential.json" \
  "${n8n_container}:/tmp/mock-anthropic-credential.json"
compose exec -T n8n \
  n8n import:credentials --input=/tmp/mock-anthropic-credential.json >/dev/null
compose exec -T n8n \
  n8n publish:workflow --id=phase3StartHere >/dev/null
compose exec -T n8n \
  n8n publish:workflow --id=phase3AgentHealth >/dev/null
compose restart n8n >/dev/null
compose up -d --wait --wait-timeout 240 n8n >/dev/null

curl \
  --retry 30 \
  --retry-delay 1 \
  --retry-all-errors \
  --fail \
  --silent \
  --show-error \
  "http://127.0.0.1:${N8N_PORT}/webhook/agent-health" >/dev/null
diagnostic_after="$("${COPY_ROOT}/scripts/diagnose.sh" 2>&1)"
expect_contains "${diagnostic_after}" \
  "Anthropic credential exists and is selected" \
  "configured diagnostics"
expect_contains "${diagnostic_after}" \
  "published chat webhook safely rejected" \
  "configured diagnostics"
expect_contains "${diagnostic_after}" \
  "All checks are green" \
  "configured diagnostics"
expect_not_contains "${diagnostic_after}" \
  "test-anthropic-key" \
  "configured diagnostics"
expect_not_contains "${diagnostic_after}" \
  "${TEST_ENCRYPTION_KEY}" \
  "configured diagnostics"

printf 'Testing private backup, confirmed reset, and restore...\n'
"${COPY_ROOT}/scripts/backup.sh" >/dev/null
backup_directory="$(
  find "${COPY_ROOT}/backups" \
    -mindepth 1 \
    -maxdepth 1 \
    -type d \
    | sort \
    | tail -n 1
)"
[[ -n "${backup_directory}" ]] || fail "backup directory was not created"
[[ -s "${backup_directory}/n8n-data.tar.gz" ]] ||
  fail "backup archive is missing"
[[ -s "${backup_directory}/env.backup" ]] ||
  fail "backup environment file is missing"

"${COPY_ROOT}/scripts/reset.sh" --yes >/dev/null
if docker volume inspect "${COMPOSE_PROJECT_NAME}_n8n_data" >/dev/null 2>&1; then
  fail "reset did not remove the isolated n8n volume"
fi

"${COPY_ROOT}/scripts/start.sh" >/dev/null
fresh_workflow_list="$(compose exec -T n8n n8n list:workflow)"
[[ "${fresh_workflow_list}" != *"phase6LearnerChecklist"* ]] ||
  fail "fresh post-reset instance retained workflow data"

printf 'RESTORE\n' | \
  "${COPY_ROOT}/scripts/restore.sh" "${backup_directory}" >/dev/null
restored_workflow_list="$(compose exec -T n8n n8n list:workflow)"
expect_contains "${restored_workflow_list}" \
  "phase6LearnerChecklist|01 - START HERE - Learner Checklist [LOCAL EDIT]" \
  "restored workflow state"
restored_diagnostics="$("${COPY_ROOT}/scripts/diagnose.sh" 2>&1)"
expect_contains "${restored_diagnostics}" \
  "All checks are green" \
  "restored diagnostics"
expect_not_contains "${restored_diagnostics}" \
  "test-anthropic-key" \
  "restored diagnostics"
expect_not_contains "${restored_diagnostics}" \
  "${TEST_ENCRYPTION_KEY}" \
  "restored diagnostics"

if compose logs n8n chat | grep -qE \
  "test-anthropic-key|${TEST_ENCRYPTION_KEY}"; then
  fail "a test credential or encryption key appeared in container logs"
fi

printf 'Restoring the canonical checklist for optional visual inspection...\n'
n8n_container="$(compose ps -q n8n)"
docker cp \
  "${COPY_ROOT}/n8n/workflows/01-start-here-learner-checklist.json" \
  "${n8n_container}:/tmp/canonical-checklist.json"
compose exec -T n8n \
  n8n import:workflow --input=/tmp/canonical-checklist.json >/dev/null

printf '\nPhase 6 smoke test passed.\n'
printf '  Fresh-copy one-click setup:       ok\n'
printf '  Eleven-workflow automatic import: ok\n'
printf '  Sample data and enabled skills:   ok\n'
printf '  Repeatable manual fallback:       ok\n'
printf '  Local edits preserved on setup:   ok\n'
printf '  Git-ready workflow exports:       11 normalised copies\n'
printf '  Readiness diagnostics:            action and all-green states\n'
printf '  Diagnostic and log secret safety: ok\n'
printf '  Backup, reset, and restore:       ok\n'
