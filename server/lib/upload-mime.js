// MIME allowlist + magic-byte check for artifact and blob uploads.
// Moved out of server.js so the upload route and the artistry blob route
// share one checker, and so tests can call it without booting the monolith.

const ALLOWED_MIME_TYPES = new Set([
  "image/jpeg", "image/png", "image/gif", "image/webp", "image/svg+xml",
  "audio/mpeg", "audio/wav", "audio/ogg", "audio/flac", "audio/aac",
  "video/mp4", "video/webm",
  "application/pdf",
  "text/plain", "text/markdown", "text/csv",
  "application/json",
  "application/octet-stream",
]);

const MAGIC_BYTES = {
  "image/jpeg": [[0xFF, 0xD8, 0xFF]],
  "image/png": [[0x89, 0x50, 0x4E, 0x47]],
  "image/gif": [[0x47, 0x49, 0x46, 0x38]],
  "image/webp": [[0x52, 0x49, 0x46, 0x46]],
  "audio/mpeg": [[0xFF, 0xFB], [0xFF, 0xF3], [0xFF, 0xF2], [0x49, 0x44, 0x33]],
  "audio/ogg": [[0x4F, 0x67, 0x67, 0x53]],
  "audio/flac": [[0x66, 0x4C, 0x61, 0x43]],
  "video/mp4": [[0x00, 0x00, 0x00], [0x66, 0x74, 0x79, 0x70]],
  "application/pdf": [[0x25, 0x50, 0x44, 0x46]],
};

export function validateMimeType(mimeType, dataOrBuffer) {
  const mime = String(mimeType || "").split(";")[0].trim().toLowerCase();
  if (!ALLOWED_MIME_TYPES.has(mime)) {
    return { ok: false, error: `File type not allowed: ${mime || mimeType || "unknown"}` };
  }
  const rules = MAGIC_BYTES[mime];
  if (rules && dataOrBuffer) {
    const buf = typeof dataOrBuffer === "string"
      ? Buffer.from(dataOrBuffer.slice(0, 100), "base64")
      : (Buffer.isBuffer(dataOrBuffer) ? dataOrBuffer.subarray(0, 100) : null);
    if (buf && buf.length >= 2) {
      const matches = rules.some((magic) => magic.every((byte, i) => i < buf.length && buf[i] === byte));
      if (!matches) {
        return { ok: false, error: "File content does not match declared type" };
      }
    }
  }
  return { ok: true };
}
