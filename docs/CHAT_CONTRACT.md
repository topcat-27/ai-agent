# Local Chat Contract

## Purpose

This contract separates the learner-owned browser interface from the n8n agent. It allows either side to evolve without requiring teams to rewrite the other.

The local release uses synchronous request and response processing. Provider webhooks and asynchronous jobs are deferred.

Phase 2 implements the browser-facing side of this contract in the TypeScript chat gateway. Phase 3 supplies the n8n workflow behind the private webhook.

## Endpoints

### Browser-facing health check

```http
GET /health
```

Successful response:

```json
{
  "status": "ok"
}
```

The health endpoint confirms that the chat service is running. It does not claim that n8n, the workflow, or Claude is ready.

### Browser-facing chat endpoint

```http
POST /api/chat
Content-Type: application/json
```

Request:

```json
{
  "sessionId": "9d4482cf-f720-4f70-98af-e337db1a9d53",
  "message": "Show me my open tasks"
}
```

Successful response:

```json
{
  "sessionId": "9d4482cf-f720-4f70-98af-e337db1a9d53",
  "reply": "You have three open tasks.",
  "runId": "68c58560-19e4-49ea-aa6f-8b62e18329a0"
}
```

`runId` is optional in the first workflow but reserved for diagnostics and future asynchronous processing.

### Gateway-to-n8n endpoint

The gateway sends the validated request over the private Docker network:

```http
POST http://n8n:5678/webhook/chat
Content-Type: application/json
```

The n8n workflow independently validates the same fields, sends only valid input to the agent, and returns the same successful response shape.

The browser must never call the n8n webhook directly.

## Request validation

The gateway must enforce:

| Field | Rule |
| --- | --- |
| `sessionId` | Required UUID string |
| `message` | Required string after trimming |
| `message` length | 1 to 4,000 characters after trimming |
| Unknown fields | Ignored in version 1 |
| Request body | JSON only |

The gateway trims the message before forwarding it. It does not alter the session identifier.

Malformed requests must not reach n8n or Claude.

## Successful response validation

The gateway accepts an n8n success response only when:

- `sessionId` is the same value supplied in the request.
- `reply` is a non-empty string.
- `runId`, when supplied, is a string.

An invalid upstream response becomes an `AGENT_ERROR`; it is never forwarded to the browser unchanged.

## Error format

All browser-facing errors use:

```json
{
  "error": {
    "code": "AGENT_UNAVAILABLE",
    "message": "The local agent is not ready. Check that n8n is running and the chat workflow is active."
  }
}
```

Supported error codes:

| HTTP status | Code | Meaning |
| --- | --- | --- |
| 400 | `INVALID_REQUEST` | JSON or required fields are invalid |
| 413 | `MESSAGE_TOO_LONG` | Trimmed message exceeds 4,000 characters |
| 429 | `RATE_LIMITED` | Claude or a future local limiter rejected the request |
| 502 | `AGENT_ERROR` | n8n returned an invalid response or the agent failed |
| 503 | `AGENT_UNAVAILABLE` | n8n or the active workflow cannot be reached |
| 504 | `AGENT_TIMEOUT` | The local workflow did not complete before the gateway timeout |

Browser-facing messages should tell the learner what to check. They must not contain:

- Claude API keys.
- n8n credentials.
- Container environment values.
- Raw stack traces.
- Unfiltered upstream response bodies.

## Timeout

The local gateway timeout is 60 seconds.

The n8n workflow has a 50-second execution timeout so it normally fails before the gateway reaches its own ceiling. The Claude node requests at most 900 output tokens, the AI Agent may take at most four iterations, and the final `reply` is capped at 8,000 characters.

Technical contributors may change `CHAT_REQUEST_TIMEOUT_MS` in `compose.yaml`, but the learner-facing gateway default and tests remain 60 seconds unless this contract is versioned.

## Session behaviour

- The browser creates a UUID session identifier.
- The identifier is stored in browser local storage.
- Every message in the active conversation reuses that identifier.
- New conversation creates a new identifier.
- The identifier is not an authenticated user identity.
- Conversation history must not be shared across session identifiers.
- The supplied Simple Memory node retains six interactions for each session while n8n is running.
- Restarting or stopping n8n clears this process-local memory.

## Browser rendering

The browser treats `reply` as untrusted text.

Version 1 may render plain text. If Markdown rendering is added, generated HTML must be sanitised before insertion into the page. Scripts, inline event handlers, and arbitrary HTML are not permitted.

## Security boundary

- The browser receives no Claude credential.
- The gateway receives no Claude credential.
- The n8n credential store owns the Claude API key.
- n8n is accessible on localhost for editing, but the gateway uses its Docker-network address.
- The chat endpoint uses same-origin browser requests in the local release.
- Authentication and public ingress are deferred until cloud deployment.

## Compatibility

Changes are backward-compatible when they:

- Add optional response fields.
- Add ignored request fields.
- Improve error prose without changing error codes.

Changes require a versioned contract when they:

- Rename or remove required fields.
- Change validation limits.
- Change session semantics.
- Make the workflow asynchronous.
- Require browser authentication.

## Contract acceptance tests

The Phase 2 contract suite proves:

- A valid request is forwarded and returned.
- Whitespace is trimmed.
- Missing, invalid, empty, and oversized inputs are rejected.
- n8n is not called for invalid input.
- An unavailable n8n service returns `AGENT_UNAVAILABLE`.
- A timed-out n8n request returns `AGENT_TIMEOUT`.
- A malformed n8n response returns `AGENT_ERROR`.
- Raw upstream errors and secrets are not returned.
- The response session identifier must match the request.

The Phase 3 agent smoke test additionally proves:

- Both exported workflows import and publish in the pinned n8n image.
- A malformed direct webhook request returns a safe error without calling the model.
- A valid browser request travels through the gateway and workflow.
- A session recalls its own conversation while a different session remains isolated.
- Agent output is capped.
- Restarting n8n clears the documented Simple Memory state.
