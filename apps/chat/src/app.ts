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

import {
  ExtractionError,
  UnsupportedFileError,
  extensionFor,
  extractTranscript,
  isSupportedExtension,
} from "./extract.js";
import {
  FetchError,
  UnsupportedSourceError,
  detectSource,
  ingestUrl,
} from "./ingest.js";

// The message limit is large enough to carry a meeting transcript in one send,
// so extracted transcripts (from files or links) reach the agent intact.
const MAX_MESSAGE_LENGTH = 100_000;
const MAX_REQUEST_BYTES = 1_048_576;
const MAX_UPSTREAM_BYTES = 65_536;
// Uploads are read as base64 JSON, which inflates the raw file by ~33%. The raw
// file is capped at 10 MB; the JSON body is allowed a little more for overhead.
const MAX_UPLOAD_FILE_BYTES = 10 * 1_024 * 1_024;
const MAX_UPLOAD_BODY_BYTES = 15 * 1_024 * 1_024;
// Extracted transcripts are capped at the message limit so an inserted
// transcript never exceeds what a single send can carry.
const MAX_TRANSCRIPT_LENGTH = MAX_MESSAGE_LENGTH;
const MAX_FILENAME_LENGTH = 255;
const MAX_URL_LENGTH = 2_048;
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
  | "EXTRACTION_FAILED"
  | "FETCH_FAILED"
  | "FILE_TOO_LARGE"
  | "INVALID_REQUEST"
  | "ASANA_ERROR"
  | "ASANA_UNAVAILABLE"
  | "MESSAGE_TOO_LONG"
  | "RATE_LIMITED"
  | "UNSUPPORTED_FILE"
  | "UNSUPPORTED_SOURCE";

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
  /** n8n webhook returning Asana projects and workspace members (read-only). */
  asanaLookupsUrl?: string;
  /** n8n webhook that creates Asana tasks after a person approves them. */
  asanaCreateUrl?: string;
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

interface UploadInput {
  filename: string;
  buffer: Buffer;
}

interface UploadResponse {
  filename: string;
  characters: number;
  truncated: boolean;
  text: string;
}

async function readUploadBody(request: IncomingMessage): Promise<unknown> {
  const contentType = request.headers["content-type"] ?? "";
  if (!/^application\/json(?:\s*;|$)/i.test(contentType)) {
    throw new PublicError(
      400,
      "INVALID_REQUEST",
      "Send the file as JSON and try again.",
    );
  }

  const chunks: Buffer[] = [];
  let totalBytes = 0;

  for await (const rawChunk of request) {
    const chunk = Buffer.isBuffer(rawChunk) ? rawChunk : Buffer.from(rawChunk);
    totalBytes += chunk.length;
    if (totalBytes > MAX_UPLOAD_BODY_BYTES) {
      throw new PublicError(
        413,
        "FILE_TOO_LARGE",
        "That file is too large. Choose a file under 10 MB.",
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
      "That file could not be read. Try a different file.",
    );
  }
}

function validateUploadRequest(body: unknown): UploadInput {
  if (typeof body !== "object" || body === null || Array.isArray(body)) {
    throw new PublicError(
      400,
      "INVALID_REQUEST",
      "Choose a file and try again.",
    );
  }

  const candidate = body as Record<string, unknown>;
  const filename =
    typeof candidate.filename === "string" ? candidate.filename.trim() : "";

  if (filename.length === 0 || filename.length > MAX_FILENAME_LENGTH) {
    throw new PublicError(
      400,
      "INVALID_REQUEST",
      "Choose a file and try again.",
    );
  }

  if (!isSupportedExtension(extensionFor(filename))) {
    throw new PublicError(
      415,
      "UNSUPPORTED_FILE",
      "That file type is not supported. Upload a PDF, Word (.docx), text, or Markdown file.",
    );
  }

  const dataBase64 =
    typeof candidate.dataBase64 === "string" ? candidate.dataBase64 : "";
  if (dataBase64.length === 0) {
    throw new PublicError(
      400,
      "INVALID_REQUEST",
      "That file was empty. Choose another file.",
    );
  }

  const buffer = Buffer.from(dataBase64, "base64");
  if (buffer.length === 0) {
    throw new PublicError(
      400,
      "INVALID_REQUEST",
      "That file was empty. Choose another file.",
    );
  }

  if (buffer.length > MAX_UPLOAD_FILE_BYTES) {
    throw new PublicError(
      413,
      "FILE_TOO_LARGE",
      "That file is too large. Choose a file under 10 MB.",
    );
  }

  return { filename, buffer };
}

async function buildTranscript(input: UploadInput): Promise<UploadResponse> {
  let transcript: string;
  try {
    transcript = await extractTranscript(input.filename, input.buffer);
  } catch (error) {
    if (error instanceof UnsupportedFileError) {
      throw new PublicError(
        415,
        "UNSUPPORTED_FILE",
        "That file type is not supported. Upload a PDF, Word (.docx), text, or Markdown file.",
      );
    }
    if (error instanceof ExtractionError) {
      throw new PublicError(
        422,
        "EXTRACTION_FAILED",
        "We couldn't read text from that file. Scanned or password-protected PDFs are not supported — try a text-based PDF or a .docx.",
      );
    }
    throw error;
  }

  if (transcript.length === 0) {
    throw new PublicError(
      422,
      "EXTRACTION_FAILED",
      "We couldn't find any text in that file. It may contain only scanned images. Try a text-based file.",
    );
  }

  const truncated = transcript.length > MAX_TRANSCRIPT_LENGTH;
  const text = truncated
    ? transcript.slice(0, MAX_TRANSCRIPT_LENGTH)
    : transcript;

  return {
    filename: input.filename,
    characters: text.length,
    truncated,
    text,
  };
}

interface IngestResponse {
  source: string;
  title: string;
  characters: number;
  truncated: boolean;
  text: string;
}

function validateIngestRequest(body: unknown): string {
  if (typeof body !== "object" || body === null || Array.isArray(body)) {
    throw new PublicError(400, "INVALID_REQUEST", "Paste a link and try again.");
  }

  const candidate = body as Record<string, unknown>;
  const url = typeof candidate.url === "string" ? candidate.url.trim() : "";

  if (url.length === 0 || url.length > MAX_URL_LENGTH) {
    throw new PublicError(400, "INVALID_REQUEST", "Paste a link and try again.");
  }

  if (detectSource(url) === null) {
    throw new PublicError(
      415,
      "UNSUPPORTED_SOURCE",
      "That link is not supported. Paste a Fathom share link or a Granola notes link.",
    );
  }

  return url;
}

async function buildIngestResponse(
  url: string,
  fetchImplementation: typeof fetch,
  timeoutMs: number,
): Promise<IngestResponse> {
  let result;
  try {
    result = await ingestUrl(url, { fetchImplementation, timeoutMs });
  } catch (error) {
    if (error instanceof UnsupportedSourceError) {
      throw new PublicError(415, "UNSUPPORTED_SOURCE", error.message);
    }
    if (error instanceof FetchError) {
      throw new PublicError(
        502,
        "FETCH_FAILED",
        "We couldn't get the transcript from that link. Check that it is shared and try again.",
      );
    }
    throw error;
  }

  const truncated = result.text.length > MAX_TRANSCRIPT_LENGTH;
  const text = truncated ? result.text.slice(0, MAX_TRANSCRIPT_LENGTH) : result.text;

  return {
    source: result.source,
    title: result.title,
    characters: text.length,
    truncated,
    text,
  };
}

const MAX_ASANA_TASKS = 50;
const GID_PATTERN = /^\d+$/;
const DUE_DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;

interface AsanaCreatePayload {
  mode: "flat" | "grouped";
  projectGid: string;
  meetingTitle: string;
  tasks: {
    title: string;
    notes: string;
    assigneeGid: string;
    dueOn: string;
  }[];
}

/**
 * Validates the review panel's push request before it reaches n8n. The n8n
 * workflow re-validates everything; this layer exists to reject obvious
 * mistakes with a friendly message and to keep malformed input off the wire.
 */
function validateAsanaCreateRequest(body: unknown): AsanaCreatePayload {
  if (typeof body !== "object" || body === null || Array.isArray(body)) {
    throw new PublicError(400, "INVALID_REQUEST", "Nothing to push. Select at least one task.");
  }

  const candidate = body as Record<string, unknown>;
  const projectGid =
    typeof candidate.projectGid === "string" ? candidate.projectGid.trim() : "";
  if (!GID_PATTERN.test(projectGid)) {
    throw new PublicError(400, "INVALID_REQUEST", "Choose an Asana project before pushing.");
  }

  const rawTasks = Array.isArray(candidate.tasks) ? candidate.tasks : [];
  if (rawTasks.length === 0) {
    throw new PublicError(400, "INVALID_REQUEST", "Select at least one task to push.");
  }
  if (rawTasks.length > MAX_ASANA_TASKS) {
    throw new PublicError(
      400,
      "INVALID_REQUEST",
      `Push at most ${MAX_ASANA_TASKS} tasks at a time.`,
    );
  }

  const tasks = rawTasks.map((raw) => {
    const source = typeof raw === "object" && raw !== null ? (raw as Record<string, unknown>) : {};
    const title = typeof source.title === "string" ? source.title.trim() : "";
    if (title.length === 0) {
      throw new PublicError(400, "INVALID_REQUEST", "Every task needs a title.");
    }
    const assigneeGid =
      typeof source.assigneeGid === "string" ? source.assigneeGid.trim() : "";
    if (assigneeGid && !GID_PATTERN.test(assigneeGid)) {
      throw new PublicError(400, "INVALID_REQUEST", "Pick an assignee from the list.");
    }
    const dueOn = typeof source.dueOn === "string" ? source.dueOn.trim() : "";
    if (dueOn && !DUE_DATE_PATTERN.test(dueOn)) {
      throw new PublicError(400, "INVALID_REQUEST", "Due dates must look like 2026-07-30.");
    }
    return {
      title: title.slice(0, 1_024),
      notes: typeof source.notes === "string" ? source.notes.trim().slice(0, 4_000) : "",
      assigneeGid,
      dueOn,
    };
  });

  return {
    mode: candidate.mode === "grouped" ? "grouped" : "flat",
    projectGid,
    meetingTitle:
      typeof candidate.meetingTitle === "string"
        ? candidate.meetingTitle.trim().slice(0, 1_024)
        : "",
    tasks,
  };
}

/** Calls an n8n Asana webhook and returns its parsed JSON, mapping failures safely. */
async function callAsanaWebhook(
  url: string | undefined,
  payload: unknown,
  fetchImplementation: typeof fetch,
  timeoutMs: number,
): Promise<unknown> {
  if (!url) {
    throw new PublicError(
      503,
      "ASANA_UNAVAILABLE",
      "Asana is not configured. Publish the Asana workflows in n8n and try again.",
    );
  }

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  let response: Response;
  try {
    response = await fetchImplementation(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
      signal: controller.signal,
    });
  } catch (error) {
    if (controller.signal.aborted) {
      throw new PublicError(504, "AGENT_TIMEOUT", "Asana took too long to respond. Try again.");
    }
    throw new PublicError(
      503,
      "ASANA_UNAVAILABLE",
      "Could not reach the Asana workflow. Check that n8n is running and the workflow is published.",
    );
  } finally {
    clearTimeout(timer);
  }

  if (response.status === 404) {
    throw new PublicError(
      503,
      "ASANA_UNAVAILABLE",
      "The Asana workflow is not published in n8n yet.",
    );
  }

  const rawBody = await response.text();
  let parsed: unknown;
  try {
    parsed = JSON.parse(rawBody);
  } catch {
    throw new PublicError(502, "ASANA_ERROR", "Asana returned an unexpected response.");
  }

  if (!response.ok) {
    // Surface the workflow's own validation message, never raw provider detail.
    const errorBody = parsed as { error?: { code?: unknown; message?: unknown } };
    const message =
      typeof errorBody?.error?.message === "string"
        ? errorBody.error.message
        : "Asana could not complete that request.";
    throw new PublicError(response.status === 400 ? 400 : 502, "ASANA_ERROR", message);
  }

  return parsed;
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

      if (url.pathname === "/api/upload") {
        if (request.method !== "POST") {
          sendJson(response, 405, {
            error: {
              code: "INVALID_REQUEST",
              message: "Send files with POST.",
            },
          }, { Allow: "POST" });
          return;
        }

        try {
          const body = await readUploadBody(request);
          const uploadInput = validateUploadRequest(body);
          const transcript = await buildTranscript(uploadInput);
          sendJson(response, 200, transcript);
        } catch (error) {
          if (error instanceof PublicError) {
            sendError(response, error);
            return;
          }
          options.logError?.("Unexpected file upload error", error);
          sendError(
            response,
            new PublicError(
              500,
              "EXTRACTION_FAILED",
              "We couldn't process that file. Try again.",
            ),
          );
        }
        return;
      }

      if (url.pathname === "/api/ingest-url") {
        if (request.method !== "POST") {
          sendJson(response, 405, {
            error: {
              code: "INVALID_REQUEST",
              message: "Send links with POST.",
            },
          }, { Allow: "POST" });
          return;
        }

        try {
          const body = await readRequestBody(request);
          const linkUrl = validateIngestRequest(body);
          const ingest = await buildIngestResponse(
            linkUrl,
            fetchImplementation,
            timeoutMs,
          );
          sendJson(response, 200, ingest);
        } catch (error) {
          if (error instanceof PublicError) {
            sendError(response, error);
            return;
          }
          options.logError?.("Unexpected link ingest error", error);
          sendError(
            response,
            new PublicError(
              502,
              "FETCH_FAILED",
              "We couldn't get the transcript from that link. Try again.",
            ),
          );
        }
        return;
      }

      if (url.pathname === "/api/asana/meta") {
        if (request.method !== "GET" && request.method !== "POST") {
          sendJson(response, 405, {
            error: { code: "INVALID_REQUEST", message: "Use GET for Asana lookups." },
          }, { Allow: "GET, POST" });
          return;
        }

        try {
          const meta = await callAsanaWebhook(
            options.asanaLookupsUrl,
            {},
            fetchImplementation,
            timeoutMs,
          );
          sendJson(response, 200, meta);
        } catch (error) {
          if (error instanceof PublicError) {
            sendError(response, error);
            return;
          }
          options.logError?.("Unexpected Asana lookup error", error);
          sendError(
            response,
            new PublicError(502, "ASANA_ERROR", "Could not load your Asana projects."),
          );
        }
        return;
      }

      if (url.pathname === "/api/asana/create") {
        if (request.method !== "POST") {
          sendJson(response, 405, {
            error: { code: "INVALID_REQUEST", message: "Push tasks with POST." },
          }, { Allow: "POST" });
          return;
        }

        try {
          const body = await readRequestBody(request);
          const payload = validateAsanaCreateRequest(body);
          const created = await callAsanaWebhook(
            options.asanaCreateUrl,
            payload,
            fetchImplementation,
            timeoutMs,
          );
          sendJson(response, 200, created);
        } catch (error) {
          if (error instanceof PublicError) {
            sendError(response, error);
            return;
          }
          options.logError?.("Unexpected Asana create error", error);
          sendError(
            response,
            new PublicError(502, "ASANA_ERROR", "Could not create those Asana tasks."),
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
