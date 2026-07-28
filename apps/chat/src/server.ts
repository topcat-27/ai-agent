import { fileURLToPath } from "node:url";
import { createChatServer } from "./app.js";

const DEFAULT_PORT = 3_000;
const DEFAULT_TIMEOUT_MS = 60_000;
const DEFAULT_UPSTREAM_URL = "http://n8n:5678/webhook/chat";

function positiveInteger(value: string | undefined, fallback: number): number {
  if (value === undefined) {
    return fallback;
  }
  const parsed = Number(value);
  return Number.isSafeInteger(parsed) && parsed > 0 ? parsed : fallback;
}

const port = positiveInteger(process.env.PORT, DEFAULT_PORT);
const timeoutMs = positiveInteger(
  process.env.CHAT_REQUEST_TIMEOUT_MS,
  DEFAULT_TIMEOUT_MS,
);
const upstreamUrl = process.env.N8N_CHAT_WEBHOOK_URL ?? DEFAULT_UPSTREAM_URL;
const publicDirectory = fileURLToPath(new URL("../public", import.meta.url));

try {
  new URL(upstreamUrl);
} catch {
  console.error("N8N_CHAT_WEBHOOK_URL must be a valid URL.");
  process.exit(1);
}

const server = createChatServer({
  publicDirectory,
  upstreamUrl,
  timeoutMs,
  logError: (message, error) => console.error(message, error),
});

server.listen(port, "0.0.0.0", () => {
  console.log(`Chat gateway listening on http://0.0.0.0:${port}`);
});

function shutdown(signal: string): void {
  console.log(`${signal} received; closing the chat gateway.`);
  server.close((error) => {
    if (error) {
      console.error("Could not close the chat gateway cleanly.", error);
      process.exitCode = 1;
    }
  });
}

process.on("SIGINT", () => shutdown("SIGINT"));
process.on("SIGTERM", () => shutdown("SIGTERM"));
