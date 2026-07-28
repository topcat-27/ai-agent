# Workshop Prerequisites

## Outcome

Complete this checklist before the main workshop. A learner who completes it should arrive with a working local Docker environment, access to the repository, and a usable Claude API key.

Do not use the main workshop to install or repair Docker Desktop for the first time.

## Required accounts

### GitHub

- Create or sign in to a GitHub account.
- Confirm that the learner can create a repository.
- Install GitHub Desktop as the default workshop Git workflow.
- Confirm that GitHub Desktop can sign in to the learner's account.
- Practise creating a repository from a template and cloning it.

### Anthropic Console

- Create or sign in to an Anthropic Console account.
- Add API credit or otherwise confirm API access.
- Create a Claude API key.
- Store the key in a password manager or another private location.
- Do not paste the key into a chat message, repository, screenshot, shared document, or frontend configuration.

The key will be added to n8n during the workshop.

## Required software

### macOS

- macOS 13 or newer.
- Docker Desktop installed.
- Docker Desktop opened and reporting that its engine is running.
- Current Chrome or Edge.
- GitHub Desktop installed and signed in.

Both Apple Silicon and Intel are target environments and must be represented in preflight testing when available.

Learners do not need Node.js, npm, or n8n installed on the host. The repository runs the pinned development and workflow tools inside Docker.

### Windows

- Windows 11.
- WSL2 enabled.
- Docker Desktop configured to use WSL2.
- Docker Desktop opened and reporting that its engine is running.
- Current Chrome or Edge.
- GitHub Desktop installed and signed in.

Windows learners should restart their computer after installing or enabling WSL2 and Docker Desktop.

## Network requirements

The learner's network must permit:

- Pulling Docker images.
- Accessing GitHub.
- Accessing the Anthropic API.

VPN, proxy, firewall, managed-device, or campus-network restrictions should be discovered during preflight rather than during the workshop.

## Port check

The local project uses:

- `http://localhost:3000` for the learner chat.
- `http://localhost:5678` for n8n.

Preflight must confirm that these ports are available or provide a documented resolution for applications already using them.

## Preflight exercise

Before the main workshop, every learner should:

1. Open Docker Desktop.
2. Confirm that Docker reports a running engine.
3. Create a private repository from the released template and clone it with GitHub Desktop.
4. Start the supplied preflight Compose service.
5. Open its documented localhost page.
6. Stop the service.
7. Sign in to GitHub Desktop.
8. Confirm possession of a private Claude API key with available credit.

Use `setup.command` on macOS or `setup-windows.cmd` on Windows for the full local preflight, automatic workflow import, and first start.

## Instructor preparation

The instructor should use [INSTRUCTOR_CHECKLIST.md](INSTRUCTOR_CHECKLIST.md) and prepare:

- At least one tested macOS machine.
- At least one tested Windows 11 and WSL2 machine.
- Screenshots for every setup step.
- A small number of preconfigured backup machines where practical.
- A downloaded copy of required Docker images when workshop connectivity is uncertain.
- A repository archive and exported n8n workflows.
- A process for helping learners without viewing or copying their API keys.

## Readiness record

Record for each learner:

| Check | Result |
| --- | --- |
| Supported operating system | Pass / needs help |
| Docker Desktop installed | Pass / needs help |
| Docker engine running | Pass / needs help |
| Ports 3000 and 5678 available | Pass / needs help |
| GitHub access | Pass / needs help |
| GitHub Desktop access | Pass / needs help |
| Anthropic Console access | Pass / needs help |
| Claude API key and credit | Pass / needs help |
| Preflight local page opened | Pass / needs help |

Learners with unresolved Docker, account, or network failures should receive support before the main build session.

## Security reminder

API keys are secrets.

- Never commit a key.
- Never add a key to `agent.config.js`.
- Never put a key into browser code.
- Never share a key between teams.
- Rotate a key immediately if it is exposed.

The local architecture is designed so that Claude credentials live only in n8n's encrypted credential store.
