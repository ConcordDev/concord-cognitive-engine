/**
 * safeLocalMediaUrl — the allowlist for locally-created media URLs that
 * reach an <img> src or a media element's src.
 *
 * The desks build poster URLs in-page from user-picked files:
 * `URL.createObjectURL(file)` (a `blob:` URL) or `canvas.toDataURL()`
 * (a `data:image/png;base64,…` URL). Both are safe by construction, but
 * the value that reaches the sink travels through component state, not
 * straight from the call site, so it is filtered here at the sink: only
 * `blob:` URLs and PNG/JPEG/WebP base64 data URLs pass; anything else
 * (`javascript:`, `data:text/html`, remote http(s), garbage) becomes ''
 * and the caller renders no image / treats the probe as failed.
 * Pattern precedent: safeLinkUrl in lib/safe-url.ts and sanitizeUrl in
 * app/messages/page.tsx.
 *
 * CB-1280 note: the three original sinks (PublishDesk, ReleaseDesk,
 * fo.ts probeDuration) no longer call this helper — CodeQL closed the
 * first alerts and re-raised them (#6014–6016) because it does not
 * treat a helper's return value as sanitized, so those sinks carry the
 * same allowlist as an inline guard on the sink value itself. This
 * helper keeps the policy for non-analyzer contexts, and its vitest
 * (tests/safe-media-url.test.ts) pins the policy the guards mirror.
 *
 * CB-1370 (round 3): the desks now hold the poster Blob/File itself in
 * state and mint the URL at render through safeObjectUrl below — no
 * URL string travels through state at all. fo.ts probeDuration mints
 * its object URL directly at the assignment (it probes audio/video
 * files, outside this image allowlist).
 */

const DATA_IMAGE = /^data:image\/(png|jpeg|webp);base64,/;

export function safeLocalMediaUrl(u: string): string {
  if (typeof u !== 'string' || !u) return '';
  if (DATA_IMAGE.test(u)) return u;
  try {
    if (new URL(u).protocol === 'blob:') return u;
  } catch { /* not a parseable URL at all */ }
  return '';
}

const OBJECT_URL_TYPES: ReadonlySet<string> = new Set(['image/png', 'image/jpeg', 'image/webp']);

/**
 * Mint an object URL for a locally held poster Blob — the sink-side
 * half of the allowlist: only PNG/JPEG/WebP blobs mint; anything else
 * (and no blob) yields '', and the caller renders no image. The caller
 * owns the minted URL's lifetime (revoke on change/unmount).
 */
export function safeObjectUrl(blob: Blob | null | undefined): string {
  if (!blob || !OBJECT_URL_TYPES.has(blob.type)) return '';
  return URL.createObjectURL(blob);
}
