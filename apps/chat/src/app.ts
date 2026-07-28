import { createReadStream } from "node:fs";
import { stat } from "node:fs/promises";
import {
  createServer,
  type IncomingMessage,
  type RequestListener,
  type Server,
  type ServerResponse,
} from "node:http";
import { extname, resolve, sep } from "node:path";

const MAX_MESSAGE_LENGTH = 4_000;
const MAX_REQUEST_BYTES = 32_768;
const MAX_UPSTREAM_BYTES = 65_536;
const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

const MIME_TYPES: Readonly<Record<string, string>> = {
  ".css": "text/css; charset=utf-8",
  ".html": "text/html; charset=utf-8",
  ".ico": "image/x-icon",
  ".js": "text/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".svg": "image/svg+xml",
};

const SECURITY_HEADERS: Readonly<Record<string, string>> = {
  "Content-Security-Policy":
    "default-src 'self'; base-uri 'none'; connect-src 'self'; font-src 'self'; form-action 'self'; frame-ancestors 'none'; img-src 'self' data:; object-src 'none'; script-src 'self'; style-src 'self'",
  "Referrer-Policy": "no-referrer",
  "X-Content-Type-Options": "nosniff",
  "X-Frame-Options": "DENY",
};

type ErrorCode =
  | "AGENT_ERROR"
  | "AGENT_TIMEOUT"
  | "AGENT_UNAVAILABLE"
  | "INVALID_REQUEST"
  | "MESSAGE_TOO_LONG"
  | "RATE_LIMITED";

interface ChatRequest {
  sessionId: string;
  message: string;
}

interface ChatResponse {
  sessionId: string;
  reply: string;
  runId?: string;
}

export interface ChatGatewayOptions {
  publicDirectory: string;
  upstreamUrl: string;
  timeoutMs?: number;
  fetchImplementation?: typeof fetch;
  logError?: (message: string, error?: unknown) => void;
}

class PublicError extends Error {
  constructor(
    readonly status: number,
    readonly code: ErrorCode,
    readonly publicMessage: string,
  ) {
    super(publicMessage);
  }
}

function sendJson(
  response: ServerResponse,
  status: number,
  body: unknown,
  extraHeaders: Record<string, string> = {},
): void {
  const payload = JSON.stringify(body);
  response.writeHead(status, {
    ...SECURITY_HEADERS,
    ...extraHeaders,
    "Cache-Control": "no-store",
    "Content-Length": Buffer.byteLength(payload).toString(),
    "Content-Type": "application/json; charset=utf-8",
  });
  response.end(payload);
}

function sendError(response: ServerResponse, error: PublicError): void {
  sendJson(
    response,
    error.status,
    {
      error: {
        code: error.code,
        message: error.publicMessage,
      },
    },
    error.status === 429 ? { "Retry-After": "30" } : {},
  );
}

async function readRequestBody(request: IncomingMessage): Promise<unknown> {
  const contentType = request.headers["content-type"] ?? "";
  if (!/^application\/json(?:\s*;|$)/i.test(contentType)) {
    throw new PublicError(
      400,
      "INVALID_REQUEST",
      "Send the message as JSON and try again.",
    );
  }

  const chunks: Buffer[] = [];
  let totalBytes = 0;

  for await (const rawChunk of request) {
    const chunk = Buffer.isBuffer(rawChunk) ? rawChunk : Buffer.from(rawChunk);
    totalBytes += chunk.length;
    if (totalBytes > MAX_REQUEST_BYTES) {
      throw new PublicError(
        413,
        "MESSAGE_TOO_LONG",
        "That message is too long. Keep it under 4,000 characters.",
      );
    }
    chunks.push(chunk);
  }

  try {
    return JSON.parse(Buffer.concat(chunks).toString("utf8"));
  } catch {
    throw new PublicError(
      400,
      "INVALID_REQUEST",
      "That message could not be read. Check it and try again.",
    );
  }
}

function validateChatRequest(body: unknown): ChatRequest {
  if (typeof body !== "object" || body === null || Array.isArray(body)) {
    throw new PublicError(
      400,
      "INVALID_REQUEST",
      "Enter a message and try again.",
    );
  }

  const candidate = body as Record<string, unknown>;
  const sessionId = candidate.sessionId;
  const rawMessage = candidate.message;

  if (typeof sessionId !== "string" || !UUID_PATTERN.test(sessionId)) {
    throw new PublicError(
      400,
      "INVALID_REQUEST",
      "The conversation could not be identified. Reset it and try again.",
    );
  }

  if (typeof rawMessage !== "string") {
    throw new PublicError(
      400,
      "INVALID_REQUEST",
      "Enter a message and try again.",
    );
  }

  const message = rawMessage.trim();
  if (message.length === 0) {
    throw new PublicError(
      400,
      "INVALID_REQUEST",
      "Enter a message and try again.",
    );
  }

  if (message.length > MAX_MESSAGE_LENGTH) {
    throw new PublicError(
      413,
      "MESSAGE_TOO_LONG",
      "That message is too long. Keep it under 4,000 characters.",
    );
  }

  return { sessionId, message };
}

async function readUpstreamBody(response: Response): Promise<unknown> {
  const rawBody = await response.text();
  if (Buffer.byteLength(rawBody) > MAX_UPSTREAM_BYTES) {
    throw new PublicError(
      502,
      "AGENT_ERROR",
      "The agent returned an unexpected response. Check the workflow and try again.",
    );
  }

  try {
    return JSON.parse(rawBody);
  } catch {
    throw new PublicError(
      502,
      "AGENT_ERROR",
      "The agent returned an unexpected response. Check the workflow and try again.",
    );
  }
}

function validateUpstreamResponse(
  body: unknown,
  request: ChatRequest,
): ChatResponse {
  if (typeof body !== "object" || body === null || Array.isArray(body)) {
    throw new PublicError(
      502,
      "AGENT_ERROR",
      "The agent returned an unexpected response. Check the workflow and try again.",
    );
  }

  const candidate = body as Record<string, unknown>;
  const reply =
    typeof candidate.reply === "string" ? candidate.reply.trim() : "";

  if (
    candidate.sessionId !== request.sessionId ||
    reply.length === 0 ||
    (candidate.runId !== undefined && typeof candidate.runId !== "string")
  ) {
    throw new PublicError(
      502,
      "AGENT_ERROR",
      "The agent returned an unexpected response. Check the workflow and try again.",
    );
  }

  const result: ChatResponse = {
    sessionId: request.sessionId,
    reply,
  };
  if (typeof candidate.runId === "string") {
    result.runId = candidate.runId;
  }
  return result;
}

async function callAgent(
  request: ChatRequest,
  options: Required<
    Pick<ChatGatewayOptions, "fetchImplementation" | "timeoutMs" | "upstreamUrl">
  >,
): Promise<ChatResponse> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), options.timeoutMs);
  let upstreamResponse: Response;

  try {
    upstreamResponse = await options.fetchImplementation(options.upstreamUrl, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(request),
      signal: controller.signal,
    });
  } catch (error) {
    if (controller.signal.aborted) {
      throw new PublicError(
        504,
        "AGENT_TIMEOUT",
        "The agent took too long to reply. Wait a moment and try again.",
      );
    }
    throw new PublicError(
      503,
      "AGENT_UNAVAILABLE",
      "The local agent is not ready. Check that n8n is running and the chat workflow is active.",
    );
  } finally {
    clearTimeout(timeout);
  }

  if (upstreamResponse.status === 429) {
    throw new PublicError(
      429,
      "RATE_LIMITED",
      "The agent is busy right now. Wait a moment and try again.",
    );
  }

  if (upstreamResponse.status === 404) {
    throw new PublicError(
      503,
      "AGENT_UNAVAILABLE",
      "The local agent is not ready. Check that n8n is running and the chat workflow is active.",
    );
  }

  if (!upstreamResponse.ok) {
    throw new PublicError(
      502,
      "AGENT_ERROR",
      "The agent could not complete that request. Check the n8n workflow and try again.",
    );
  }

  const responseBody = await readUpstreamBody(upstreamResponse);
  return validateUpstreamResponse(responseBody, request);
}

async function serveStaticFile(
  request: IncomingMessage,
  response: ServerResponse,
  publicDirectory: string,
  pathname: string,
): Promise<void> {
  let decodedPath: string;
  try {
    decodedPath = decodeURIComponent(pathname);
  } catch {
    response.writeHead(400, SECURITY_HEADERS);
    response.end("Bad request");
    return;
  }

  const requestedPath = decodedPath === "/" ? "/index.html" : decodedPath;
  const root = resolve(publicDirectory);
  const filePath = resolve(root, `.${requestedPath}`);

  if (filePath !== root && !filePath.startsWith(`${root}${sep}`)) {
    response.writeHead(404, SECURITY_HEADERS);
    response.end("Not found");
    return;
  }

  try {
    const fileStats = await stat(filePath);
    if (!fileStats.isFile()) {
      throw new Error("Not a file");
    }

    response.writeHead(200, {
      ...SECURITY_HEADERS,
      "Cache-Control": "no-store",
      "Content-Length": fileStats.size.toString(),
      "Content-Type":
        MIME_TYPES[extname(filePath).toLowerCase()] ??
        "application/octet-stream",
    });

    if (request.method === "HEAD") {
      response.end();
      return;
    }

    createReadStream(filePath).pipe(response);
  } catch {
    response.writeHead(404, {
      ...SECURITY_HEADERS,
      "Content-Type": "text/plain; charset=utf-8",
    });
    response.end("Not found");
  }
}

export function createChatHandler(options: ChatGatewayOptions): RequestListener {
  const timeoutMs = options.timeoutMs ?? 60_000;
  const fetchImplementation = options.fetchImplementation ?? fetch;

  return (request, response) => {
    void (async () => {
      const url = new URL(request.url ?? "/", "http://localhost");

      if (url.pathname === "/health") {
        if (request.method !== "GET" && request.method !== "HEAD") {
          sendJson(response, 405, {
            error: {
              code: "INVALID_REQUEST",
              message: "That method is not supported.",
            },
          }, { Allow: "GET, HEAD" });
          return;
        }
        sendJson(response, 200, { status: "ok" });
        return;
      }

      if (url.pathname === "/api/chat") {
        if (request.method !== "POST") {
          sendJson(response, 405, {
            error: {
              code: "INVALID_REQUEST",
              message: "Send chat messages with POST.",
            },
          }, { Allow: "POST" });
          return;
        }

        try {
          const body = await readRequestBody(request);
          const chatRequest = validateChatRequest(body);
          const chatResponse = await callAgent(chatRequest, {
            fetchImplementation,
            timeoutMs,
            upstreamUrl: options.upstreamUrl,
          });
          sendJson(response, 200, chatResponse);
        } catch (error) {
          if (error instanceof PublicError) {
            sendError(response, error);
            return;
          }
          options.logError?.("Unexpected chat gateway error", error);
          sendError(
            response,
            new PublicError(
              502,
              "AGENT_ERROR",
              "The agent could not complete that request. Check the n8n workflow and try again.",
            ),
          );
        }
        return;
      }

      if (request.method !== "GET" && request.method !== "HEAD") {
        response.writeHead(405, {
          ...SECURITY_HEADERS,
          Allow: "GET, HEAD",
        });
        response.end("Method not allowed");
        return;
      }

      await serveStaticFile(
        request,
        response,
        options.publicDirectory,
        url.pathname,
      );
    })().catch((error: unknown) => {
      options.logError?.("Unexpected request error", error);
      if (!response.headersSent) {
        sendError(
          response,
          new PublicError(
            502,
            "AGENT_ERROR",
            "The chat service hit an unexpected problem. Try again.",
          ),
        );
      } else {
        response.destroy();
      }
    });
  };
}

export function createChatServer(options: ChatGatewayOptions): Server {
  return createServer(createChatHandler(options));
}
