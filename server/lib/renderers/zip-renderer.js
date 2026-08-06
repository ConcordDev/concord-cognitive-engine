/**
 * ZIP Renderer — wraps adm-zip (already an installed server dependency,
 * previously declared but never actually wired anywhere in this codebase —
 * verified by grep before writing this file) into the same
 * {buffer, mimeType, filename} shape the other renderers in this directory
 * (pdf-renderer.js, csv-renderer.js, midi-renderer.js, ...) already use.
 */

import AdmZip from "adm-zip";

/**
 * Build a ZIP archive from an array of files.
 * @param {Array<{name: string, content: string|Buffer}>} files
 * @returns {Buffer} ZIP file buffer
 */
export function renderZip(files) {
  const zip = new AdmZip();
  for (const f of files || []) {
    if (!f?.name) continue;
    const data = Buffer.isBuffer(f.content) ? f.content : Buffer.from(String(f.content ?? ""), "utf-8");
    zip.addFile(f.name, data);
  }
  return zip.toBuffer();
}

/**
 * List entries in a ZIP archive without extracting — for "open and see"
 * (a caller decides which entries, if any, to read the text content of).
 * @param {Buffer} buffer
 * @returns {Array<{name: string, sizeBytes: number, isDirectory: boolean}>}
 */
export function listZipEntries(buffer) {
  const zip = new AdmZip(buffer);
  return zip.getEntries().map((e) => ({
    name: e.entryName,
    sizeBytes: e.header.size,
    isDirectory: e.isDirectory,
  }));
}

/**
 * Read one entry's content as UTF-8 text (for "open and see" on a text-shaped
 * file inside a zip — markdown, JSON, plain text, code). Returns null if the
 * entry doesn't exist; never throws on binary content (best-effort decode).
 * @param {Buffer} buffer
 * @param {string} entryName
 * @returns {string|null}
 */
export function readZipEntryText(buffer, entryName) {
  const zip = new AdmZip(buffer);
  const entry = zip.getEntry(entryName);
  if (!entry) return null;
  return zip.readAsText(entry);
}
