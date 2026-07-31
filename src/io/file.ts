/**
 * File exchange with the disk: saving the document, reading a file the user
 * picked, and a generic blob download (used by the exporters
 * esportatori SVG/PNG/CSV).
 *
 * Nothing is validated here: `readDocFile` returns the raw object and cleaning
 * it up is the job of `normalizeDoc`, the one barrier of the data model.
 */
import type { HarnessDoc } from "@/core/types";

/** Characters forbidden in Windows file names; Unix systems forbid fewer. */
const FORBIDDEN = '\\/:*?"<>|';
/** Names reserved by MS-DOS: a file called this cannot be created on Windows. */
const RESERVED_NAMES = /^(con|prn|aux|nul|com[1-9]|lpt[1-9])$/i;
/** Fallback name. It is a file name, not interface text, so it skips i18n. */
const FALLBACK_NAME = "harness";
const MAX_BASE_LENGTH = 80;

/**
 * Replaces forbidden and control characters with a space. The comparison runs
 * by code point rather than through a regular expression, which keeps the
 * source free of invisible characters.
 */
function replaceForbidden(value: string): string {
  let out = "";
  for (const ch of value) {
    const code = ch.codePointAt(0) ?? 0;
    out += code < 0x20 || code === 0x7f || FORBIDDEN.includes(ch) ? " " : ch;
  }
  return out;
}

/**
 * Boils free text down to a usable file name. Returns an empty string if
 * nothing valid is left, so the caller can move on to the
 * candidato successivo.
 */
function sanitizeBase(raw: string): string {
  const cleaned = replaceForbidden(raw.normalize("NFC"))
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, MAX_BASE_LENGTH)
    // Windows rejects trailing dots and spaces, so they go after truncation.
    .replace(/[ .]+$/, "");
  if (!cleaned || RESERVED_NAMES.test(cleaned)) return "";
  return cleaned;
}

/**
 * The file name offered to the user: part number first, then the title block
 * title, then a neutral name. `extension` is accepted with or without a dot.
 */
export function documentFileName(doc: HarnessDoc, extension: string): string {
  const base =
    sanitizeBase(doc.meta?.partNumber ?? "") || sanitizeBase(doc.meta?.title ?? "") || FALLBACK_NAME;
  const ext = replaceForbidden(extension.replace(/^\.+/, "")).replace(/\s+/g, "").toLowerCase();
  return ext ? `${base}.${ext}` : base;
}

/**
 * Starts a blob download. The anchor has to be in the document because Firefox
 * ignores a click on a detached element; revoking the URL is
 * differita perché revocarlo subito interrompe i download più lenti.
 */
export function downloadBlob(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.rel = "noopener";
  a.style.display = "none";
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 10_000);
}

/**
 * Saves the document as `.json`. One-character indentation keeps the file
 * readable and diffable in version control without bloating it.
 */
export function saveDocToFile(doc: HarnessDoc): void {
  const blob = new Blob([JSON.stringify(doc, null, 1)], { type: "application/json;charset=utf-8" });
  downloadBlob(blob, documentFileName(doc, "json"));
}

/**
 * Reads a file the user picked and returns its JSON as a raw object. Errors
 * carry technical detail: the message actually shown is chosen by the caller
 * through i18n.
 */
export function readDocFile(file: File): Promise<unknown> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(reader.error ?? new Error(`read failed: ${file.name}`));
    reader.onabort = () => reject(new Error(`read aborted: ${file.name}`));
    reader.onload = () => {
      const text = typeof reader.result === "string" ? reader.result : "";
      try {
        resolve(JSON.parse(text));
      } catch (err) {
        reject(err instanceof Error ? err : new Error(`invalid JSON: ${file.name}`));
      }
    };
    reader.readAsText(file);
  });
}
