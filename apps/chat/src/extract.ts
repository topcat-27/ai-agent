import mammoth from "mammoth";
import { extractText, getDocumentProxy } from "unpdf";

/**
 * Text extraction for uploaded transcripts.
 *
 * Everything here is pure JavaScript so it runs inside the pinned Alpine image
 * without native build tools. The gateway calls {@link extractTranscript} with
 * the raw file bytes and gets back plain, normalised text — never HTML, never
 * anything the browser will execute.
 */

export const SUPPORTED_EXTENSIONS = [".pdf", ".docx", ".txt", ".md"] as const;
export type SupportedExtension = (typeof SUPPORTED_EXTENSIONS)[number];

/** The file extension is not one we can read. */
export class UnsupportedFileError extends Error {}

/** The file was a supported type but no readable text could be recovered. */
export class ExtractionError extends Error {}

/** Returns the lowercased extension, including the dot, or "" when there is none. */
export function extensionFor(filename: string): string {
  const match = /\.[^.\\/]+$/.exec(filename.toLowerCase());
  return match ? match[0] : "";
}

export function isSupportedExtension(
  extension: string,
): extension is SupportedExtension {
  return (SUPPORTED_EXTENSIONS as readonly string[]).includes(extension);
}

async function extractPdf(buffer: Buffer): Promise<string> {
  const document = await getDocumentProxy(new Uint8Array(buffer));
  const { text } = await extractText(document, { mergePages: true });
  return Array.isArray(text) ? text.join("\n") : text;
}

async function extractDocx(buffer: Buffer): Promise<string> {
  const { value } = await mammoth.extractRawText({ buffer });
  return value;
}

function decodePlainText(buffer: Buffer): string {
  return buffer.toString("utf8");
}

/**
 * Collapses carriage returns, trailing spaces, and runs of blank lines so the
 * transcript reads cleanly in the composer and stays within a predictable size.
 */
export function normaliseTranscript(raw: string): string {
  return raw
    .replace(/\r\n?/g, "\n")
    .replace(/[ \t]+\n/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .replace(/[ \t]{2,}/g, " ")
    .trim();
}

export async function extractTranscript(
  filename: string,
  buffer: Buffer,
): Promise<string> {
  const extension = extensionFor(filename);
  if (!isSupportedExtension(extension)) {
    throw new UnsupportedFileError(
      `Unsupported file extension: ${extension || "none"}`,
    );
  }

  let raw: string;
  try {
    if (extension === ".pdf") {
      raw = await extractPdf(buffer);
    } else if (extension === ".docx") {
      raw = await extractDocx(buffer);
    } else {
      raw = decodePlainText(buffer);
    }
  } catch {
    // Never surface the parser's internal error; it can contain file paths or
    // stack traces. The caller turns this into a safe, learner-facing message.
    throw new ExtractionError(`Could not read text from ${extension} file.`);
  }

  return normaliseTranscript(raw);
}
