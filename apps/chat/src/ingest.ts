import { normaliseTranscript } from "./extract.js";

/**
 * Fetches meeting transcripts / notes from supported share links.
 *
 * Everything runs server-side in the gateway. The browser only ever sends a URL;
 * the gateway fetches it, extracts plain text, and returns it for the learner to
 * review before sending. To keep this safe:
 *
 *   - Only the exact hosts below are ever contacted (SSRF guard).
 *   - Redirects are followed manually, re-checking the host on every hop.
 *   - Responses are size- and time-capped.
 *
 * Both services expose the meeting content publicly to anyone holding the share
 * link, so no API key or login is required.
 */

const ALLOWED_HOSTS: Readonly<Record<string, "fathom" | "granola">> = {
  "fathom.video": "fathom",
  "notes.granola.ai": "granola",
};

const BROWSER_USER_AGENT =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36";

const MAX_FETCH_BYTES = 8 * 1_024 * 1_024;
const MAX_REDIRECTS = 4;

export type IngestSource = "fathom" | "granola";

export interface IngestResult {
  source: IngestSource;
  title: string;
  text: string;
}

export interface IngestOptions {
  fetchImplementation?: typeof fetch;
  timeoutMs?: number;
}

/** The link is not one of the supported meeting services. */
export class UnsupportedSourceError extends Error {}

/** The link was supported, but the transcript could not be fetched or parsed. */
export class FetchError extends Error {}

/** Returns the service for a supported URL, or null when it is not supported. */
export function detectSource(rawUrl: string): IngestSource | null {
  let url: URL;
  try {
    url = new URL(rawUrl);
  } catch {
    return null;
  }
  if (url.protocol !== "https:") {
    return null;
  }
  const service = ALLOWED_HOSTS[url.hostname];
  if (service === "fathom") {
    return url.pathname.startsWith("/share/") ? "fathom" : null;
  }
  if (service === "granola") {
    return /^\/[td]\//.test(url.pathname) ? "granola" : null;
  }
  return null;
}

function assertAllowedHost(rawUrl: string): void {
  let url: URL;
  try {
    url = new URL(rawUrl);
  } catch {
    throw new FetchError("Invalid redirect target.");
  }
  if (url.protocol !== "https:" || !(url.hostname in ALLOWED_HOSTS)) {
    throw new FetchError("Refusing to follow a link off the supported services.");
  }
}

/**
 * Fetches a URL, following redirects manually so the host allowlist is enforced
 * on every hop. Returns the final response body as text.
 */
async function guardedFetch(
  startUrl: string,
  fetchImplementation: typeof fetch,
  timeoutMs: number,
): Promise<string> {
  let current = startUrl;

  for (let hop = 0; hop <= MAX_REDIRECTS; hop += 1) {
    assertAllowedHost(current);

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    let response: Response;
    try {
      response = await fetchImplementation(current, {
        redirect: "manual",
        headers: { "User-Agent": BROWSER_USER_AGENT, Accept: "*/*" },
        signal: controller.signal,
      });
    } catch (error) {
      if (controller.signal.aborted) {
        throw new FetchError("The link took too long to respond.");
      }
      throw new FetchError("Could not reach that link.");
    } finally {
      clearTimeout(timer);
    }

    if (
      response.status >= 300 &&
      response.status < 400 &&
      response.headers.has("location")
    ) {
      current = new URL(response.headers.get("location") ?? "", current).toString();
      continue;
    }

    if (!response.ok) {
      throw new FetchError(`The link returned status ${response.status}.`);
    }

    const buffer = Buffer.from(await response.arrayBuffer());
    if (buffer.length > MAX_FETCH_BYTES) {
      throw new FetchError("That link returned more data than we can process.");
    }
    return buffer.toString("utf8");
  }

  throw new FetchError("That link redirected too many times.");
}

const NAMED_ENTITIES: Readonly<Record<string, string>> = {
  amp: "&",
  lt: "<",
  gt: ">",
  quot: '"',
  apos: "'",
  nbsp: " ",
  "#39": "'",
};

function decodeEntities(value: string): string {
  return value.replace(/&(#x?[0-9a-f]+|[a-z]+);/gi, (match, entity: string) => {
    const key = entity.toLowerCase();
    if (key in NAMED_ENTITIES) {
      return NAMED_ENTITIES[key] ?? match;
    }
    if (entity[0] === "#") {
      const codePoint =
        entity[1] === "x" || entity[1] === "X"
          ? Number.parseInt(entity.slice(2), 16)
          : Number.parseInt(entity.slice(1), 10);
      return Number.isFinite(codePoint) ? String.fromCodePoint(codePoint) : match;
    }
    return match;
  });
}

/** Converts a fragment of HTML into readable plain text with line structure. */
export function htmlToText(html: string): string {
  const withBreaks = html
    .replace(/<\s*br\s*\/?\s*>/gi, "\n")
    .replace(/<\s*li[^>]*>/gi, "\n- ")
    .replace(/<\/\s*(p|div|li|h[1-6]|tr|ul|ol|blockquote)\s*>/gi, "\n")
    .replace(/<[^>]+>/g, "");
  return normaliseTranscript(decodeEntities(withBreaks));
}

async function fetchFathom(
  shareUrl: string,
  fetchImplementation: typeof fetch,
  timeoutMs: number,
): Promise<IngestResult> {
  const sharePage = await guardedFetch(shareUrl, fetchImplementation, timeoutMs);

  const match = /\/calls\/(\d+)\/copy_transcript\?token=([A-Za-z0-9_\-]+)/.exec(
    sharePage,
  );
  if (!match) {
    throw new FetchError(
      "We couldn't find a transcript on that Fathom link. Make sure sharing is enabled.",
    );
  }

  const transcriptUrl = `https://fathom.video/calls/${match[1]}/copy_transcript?token=${match[2]}`;
  const raw = await guardedFetch(transcriptUrl, fetchImplementation, timeoutMs);

  let html = "";
  try {
    const payload = JSON.parse(raw) as { html?: unknown };
    html = typeof payload.html === "string" ? payload.html : "";
  } catch {
    throw new FetchError("Fathom returned an unexpected transcript format.");
  }

  const titleMatch = /<h1[^>]*>([^<]*)<\/h1>/i.exec(html);
  const title = titleMatch ? decodeEntities(titleMatch[1] ?? "").trim() : "Fathom meeting";

  return { source: "fathom", title, text: htmlToText(html) };
}

/**
 * Reconstructs the Next.js RSC stream from the page, then extracts text from the
 * embedded ProseMirror document — the canonical source of the shared notes.
 */
function extractGranolaDoc(pageHtml: string): { title: string; text: string } {
  const pushPattern = /self\.__next_f\.push\(\[1,"((?:[^"\\]|\\.)*)"\]\)/g;
  let stream = "";
  let push: RegExpExecArray | null;
  while ((push = pushPattern.exec(pageHtml)) !== null) {
    try {
      stream += JSON.parse(`"${push[1]}"`);
    } catch {
      // Skip any chunk that is not a decodable string literal.
    }
  }

  const docIndex = stream.indexOf('"type":"doc"');
  if (docIndex < 0) {
    throw new FetchError("We couldn't find notes on that Granola link.");
  }

  const start = stream.lastIndexOf("{", docIndex);
  let depth = 0;
  let inString = false;
  let escaped = false;
  let end = -1;
  for (let index = start; index < stream.length; index += 1) {
    const character = stream[index];
    if (inString) {
      if (escaped) {
        escaped = false;
      } else if (character === "\\") {
        escaped = true;
      } else if (character === '"') {
        inString = false;
      }
    } else if (character === '"') {
      inString = true;
    } else if (character === "{") {
      depth += 1;
    } else if (character === "}") {
      depth -= 1;
      if (depth === 0) {
        end = index + 1;
        break;
      }
    }
  }

  if (end < 0) {
    throw new FetchError("Granola returned an unexpected notes format.");
  }

  let doc: unknown;
  try {
    doc = JSON.parse(stream.slice(start, end));
  } catch {
    throw new FetchError("Granola returned an unexpected notes format.");
  }

  const lines: string[] = [];
  let current: string[] = [];
  const BLOCK_TYPES = new Set([
    "paragraph",
    "heading",
    "listItem",
    "blockquote",
    "codeBlock",
  ]);

  const walk = (node: unknown): void => {
    if (!node || typeof node !== "object") {
      return;
    }
    const typed = node as { type?: string; text?: string; content?: unknown[] };
    if (typed.type === "text" && typeof typed.text === "string") {
      current.push(typed.text);
      return;
    }
    const isBlock = typeof typed.type === "string" && BLOCK_TYPES.has(typed.type);
    if (isBlock) {
      current = [];
    }
    if (Array.isArray(typed.content)) {
      for (const child of typed.content) {
        walk(child);
      }
    }
    if (isBlock) {
      const line = current.join("").trim();
      if (line) {
        const prefix =
          typed.type === "heading" ? "# " : typed.type === "listItem" ? "- " : "";
        lines.push(prefix + line);
      }
      current = [];
    }
  };
  walk(doc);

  const text = normaliseTranscript(lines.join("\n"));
  const firstHeading = lines.find((line) => line.startsWith("# "));
  const title = firstHeading ? firstHeading.slice(2).trim() : "Granola notes";
  return { title, text };
}

async function fetchGranola(
  noteUrl: string,
  fetchImplementation: typeof fetch,
  timeoutMs: number,
): Promise<IngestResult> {
  const page = await guardedFetch(noteUrl, fetchImplementation, timeoutMs);
  const { title, text } = extractGranolaDoc(page);
  return { source: "granola", title, text };
}

export async function ingestUrl(
  rawUrl: string,
  options: IngestOptions = {},
): Promise<IngestResult> {
  const source = detectSource(rawUrl);
  if (source === null) {
    throw new UnsupportedSourceError(
      "That link is not supported. Paste a Fathom share link or a Granola notes link.",
    );
  }

  const fetchImplementation = options.fetchImplementation ?? fetch;
  const timeoutMs = options.timeoutMs ?? 20_000;

  const result =
    source === "fathom"
      ? await fetchFathom(rawUrl, fetchImplementation, timeoutMs)
      : await fetchGranola(rawUrl, fetchImplementation, timeoutMs);

  if (result.text.trim().length === 0) {
    throw new FetchError("That link did not contain any readable text.");
  }
  return result;
}
