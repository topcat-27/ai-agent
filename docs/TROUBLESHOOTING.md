# Local Troubleshooting

## Start with this table

Run `diagnose.command` on macOS or `diagnose-windows.cmd` on Windows first. It does not call Claude or display credential values.

| What you see | Most likely cause | First action |
| --- | --- | --- |
| `docker: command not found` | Docker Desktop is missing or not on PATH | Install Docker Desktop, restart if requested, then rerun setup |
| Docker is installed but diagnostics show `[!!]` | Docker's engine is not ready | Open Docker Desktop and wait until it reports Ready |
| Port 3000 or 5678 is in use | Another local app owns the port | Close that app or change the matching `.env` value |
| Chat opens but says the agent is not ready | Workflow `00` is not published | Follow the yellow diagnostic action and publish workflow `00` |
| Diagnostic says the Anthropic credential is missing | The Claude node still references a nonexistent placeholder | Create `Anthropic account`, select it in the Claude node, save, and publish |
| n8n Overview has no learner checklist | Automatic import was interrupted | Run the platform's `import-workflows` fallback |
| Claude returns an authentication error | API key is invalid or revoked | Replace only the n8n credential; never put the key in a file |
| Claude returns a credit/rate error | API billing or workspace limit | Check the Anthropic Console balance and limits |
| Plain `yes` does not create a task | Expected safety behaviour | Send the exact, current `CONFIRM XXXXXXXX` phrase |
| A skill edit has no effect | Bundle was not synced or conversation memory is old | Run the skill-sync helper and start a new conversation |
| Data vanished after reset | Reset removed the Docker volume | Restore the latest complete private backup |
| `.command` is blocked on macOS | Gatekeeper has not approved that local script | Control-click it, choose **Open**, then confirm |
| A `.cmd` window closes or reports an execution error | Docker/PowerShell prerequisite or script failure | Rerun it and read the first red or `[!!]` line |

## Docker command not found

Docker Desktop is not installed, has not finished installing, or its command is not on the system path.

Install Docker Desktop, restart the computer if requested, then rerun setup.

## Docker engine is not running

Open Docker Desktop and wait until it reports that the engine is running. The Docker application being installed is not enough; its engine must be active.

Then rerun:

- `setup.command` on macOS.
- `setup-windows.cmd` on Windows.

## Port 3000 or 5678 is already in use

Another application is listening on the required local port.

Either close that application or change the matching value in `.env`:

```dotenv
CHAT_PORT=3000
N8N_PORT=5678
```

After changing a port, use the new localhost address in the browser.

## The chat app does not open

1. Open [http://localhost:3000/health](http://localhost:3000/health).
2. Run the start script again.
3. Check that Docker Desktop is running.
4. Run `docker compose ps` if comfortable using a terminal.

The chat service starts only after n8n reports healthy.

## The chat says the local agent is not ready

The page and chat gateway are working, but n8n does not yet have an active `/webhook/chat` workflow.

1. Run the workflow import command for the computer.
2. Open n8n and confirm `00 - START HERE - Project Partner` is published.
3. Confirm its production webhook path is exactly `chat`.
4. Check the workflow's most recent execution for a failed node.
5. Restart the local stack and try again.

The browser intentionally does not show raw workflow errors or credentials.

## A workflow does not appear after import

1. Confirm the terminal reported `Workflows imported successfully`.
2. Refresh the n8n Overview.
3. Check that the local n8n owner account has been created.
4. Run the import fallback again; the fixed workflow IDs prevent duplicate copies.
5. Ask a technical helper to run `docker compose logs --tail 100 n8n`.

First setup normally imports all eleven workflows automatically. The main agent, health workflow, learner checklist, and temporary setup workflows remain inactive until viewed, run manually, or deliberately published. The import helper publishes the six reviewed runtime dependencies automatically.

## Claude credential is missing or invalid

Open `00 - START HERE - Project Partner`, then open **Claude - Sonnet 4.6**.

1. Select a credential named `Anthropic account`, or create it if it does not exist.
2. Paste only an Anthropic Console API key into the **API Key** field.
3. Leave **Base URL** at its default for real Claude use.
4. Save the credential, save the workflow, and publish it again.

An Anthropic web-chat subscription is separate from API access. Follow [N8N_AGENT_SETUP.md](N8N_AGENT_SETUP.md) for the supported credential steps.

## Claude reports a credit or rate-limit error

Anthropic API use requires API billing and available usage credit. Open the Anthropic Console to check the workspace's usage, limits, and billing. Add only a small workshop budget and keep the supplied response and iteration limits.

If billing is available, wait briefly and retry. Persistent 429 responses can also mean a workspace rate limit has been reached.

## The agent health endpoint does not work

Open [http://localhost:5678/webhook/agent-health](http://localhost:5678/webhook/agent-health).

- A small JSON response with `"status":"ok"` proves the debug workflow is published.
- An n8n 404 usually means `90 - DEBUG - Agent Health` has not been published.
- A failed n8n health check means the service itself needs attention.

This endpoint intentionally does not test Claude. Use an ordinary chat message for an end-to-end test.

## The agent forgot an earlier message

This is expected after n8n restarts or stops. The first release uses Simple Memory, which is process-local and keeps the latest six interactions for each browser session.

If n8n did not restart:

1. Confirm the browser was not reset or its site data cleared.
2. Confirm the same browser tab still has the same conversation.
3. Check that **Conversation Memory** remains connected to the agent in the workflow.

Durable conversation history is deferred from the local beginner release.

## The agent says local task data is not ready

Run the workflow import command again. It safely recreates missing table schemas and adds only missing sample rows.

Then:

1. Open **Data tables** in n8n.
2. Confirm `tasks`, `tool_audit`, `pending_actions`, and `agent_config` exist.
3. Confirm `20 - TOOL - list_tasks` is published.
4. Publish `00 - START HERE - Project Partner` again if the import refreshed its draft.

Do not create a replacement table with different column names; the reviewed tools intentionally expect the documented schema.

## The agent will not create or update a task

The first message only prepares a proposal. It must say that no task changed and show an exact phrase such as `CONFIRM A1B2C3D4`.

Check the proposed fields, then send the complete phrase as a separate message in the same browser conversation within five minutes.

- Plain `yes` is deliberately insufficient.
- A phrase from another browser conversation cannot work.
- A newer proposal supersedes the older phrase.
- An expired or already-used phrase requires a new proposal.

If a correct new phrase still fails, confirm workflows `30`, `31`, `40`, `21`, and `22` are published and rerun workflow import. Do not connect write workers `21` or `22` directly to the AI Agent.

See [SAFE_WRITE_CONFIRMATION.md](SAFE_WRITE_CONFIRMATION.md).

## A skill change did not appear

1. Save both `skill.yaml` and `SKILL.md`.
2. Confirm the skill ID appears exactly once in `skills/enabled.txt`.
3. Double-click `sync-skills.command` on macOS or `sync-skills-windows.cmd` on Windows.
4. Wait for **Enabled skills synced successfully**.
5. Start a new browser conversation.

If validation fails, correct the file and rerun the helper. The previously valid bundle stays active. See [CUSTOMISE_SKILLS.md](CUSTOMISE_SKILLS.md).

## A task tool reports an invalid input

The task tools reject:

- Empty or longer-than-120-character titles.
- Descriptions longer than 2,000 characters.
- Unknown statuses or priorities.
- Invalid dates and task IDs.
- Reused request IDs containing different details.

Correct the specific field named in the response and retry. Every rejected attempt is also visible in `tool_audit`; it does not create or update a task.

## Chat customisation did not appear

1. Save `apps/chat/public/agent.config.js`.
2. Refresh the chat page.
3. Confirm the edited words remain inside quotes and prompts remain comma-separated.
4. Open the browser developer console only if a technical helper is available; a syntax error in the config file causes the safe default settings to load.

Normal changes to the agent name, subtitle, welcome message, colour, and example prompts do not require rebuilding Docker.

## n8n does not open

1. Open [http://localhost:5678/healthz](http://localhost:5678/healthz).
2. Wait another minute on the first start.
3. Run the start script again.
4. Check Docker Desktop for a stopped or unhealthy n8n container.

## Log says the Python task runner is unavailable

The pinned standard n8n image starts its JavaScript task runner but does not include Python 3. It records a warning that the optional internal Python runner could not start.

This does not make the service unhealthy and does not affect the visual agent, Claude integration, or JavaScript workflow nodes used by this project. Python Code nodes are outside the local-first release.

## Compose reports a missing encryption key

The private `.env` file is missing or incomplete.

Run the setup script rather than invoking Compose directly. Setup generates the key and protects it from Git.

## A browser warns about secure cookies

The local stack explicitly disables n8n secure cookies because it uses local HTTP rather than public HTTPS. Confirm that the address begins with `http://localhost`, not a public hostname.

Public deployments require HTTPS and a different security configuration.

## Data disappeared

Stopping and starting preserves data. Data is removed only when the Docker volume is deleted or the reset script is confirmed.

Look for a recent private backup below `backups/`. Follow [LOCAL_OPERATIONS.md](LOCAL_OPERATIONS.md) to restore it.

## Backup or restore fails

Check:

- Docker Desktop is running.
- `.env` exists.
- The selected backup contains both `n8n-data.tar.gz` and `env.backup`.
- The backup path is local and accessible to Docker Desktop.
- There is enough disk space.

Restore requires the matching encryption-key backup. A data archive alone cannot reliably restore encrypted credentials.

## Windows script execution error

Use the supplied `.cmd` wrappers for setup, start, and stop. They invoke the repository's PowerShell scripts without changing the computer's permanent execution policy.

For backup, restore, or reset, open PowerShell in the repository directory and run the documented command.

## macOS blocks a command file

Control-click the `.command` file, choose **Open**, then confirm. This allows the specific local script without broadly disabling macOS protections.

## Get diagnostic status

Learners should first double-click `diagnose.command` or `diagnose-windows.cmd`. Technical contributors can run:

```bash
./scripts/diagnose.sh
./scripts/preflight.sh
docker compose ps
docker compose logs --tail 100 n8n
docker compose logs --tail 100 chat
```

Do not paste `.env`, credential exports, full backups, or logs containing secrets into a public issue.
