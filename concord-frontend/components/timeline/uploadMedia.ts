// uploadMedia — S-TL-3: real file upload for the Timeline wall, on the
// platform artifact route (POST /api/artifact/upload, raw bytes — the
// ArtifactUploader's proven shape), plus the F14 honesty checks for
// pasted media URLs. Every rejection is a stated reason on the surface;
// nothing fails silently and no broken media is ever attached.

import type { MediaItem, MediaKind } from './types';

/** The stated per-file cap for Timeline uploads, shown in the UI. */
export const MAX_UPLOAD_BYTES = 10 * 1024 * 1024;

/** Mirrors the server allowlist (server/lib/upload-mime.js) for the
 *  kinds a wall post can carry. The server re-checks the real bytes
 *  and its error sentence wins if the two ever disagree. */
export const UPLOAD_ACCEPT =
  'image/jpeg,image/png,image/gif,image/webp,image/svg+xml,video/mp4,video/webm';

const IMAGE_TYPES = ['image/jpeg', 'image/png', 'image/gif', 'image/webp', 'image/svg+xml'];
const VIDEO_TYPES = ['video/mp4', 'video/webm'];

export function kindForType(type: string): MediaKind | null {
  if (VIDEO_TYPES.includes(type)) return 'video';
  if (IMAGE_TYPES.includes(type)) return 'photo';
  return null;
}

export type UploadResult = { ok: true; item: MediaItem } | { ok: false; error: string };

/** Upload one file to the artifact route as a Timeline artifact.
 *  Pre-checks type and size with stated reasons; the server's own
 *  error sentence is surfaced verbatim when it refuses. */
export async function uploadTimelineFile(file: File): Promise<UploadResult> {
  const kind = kindForType(file.type);
  if (!kind) {
    return {
      ok: false,
      error: `“${file.name}” can't be posted — Timeline takes JPEG, PNG, GIF, WebP or SVG images and MP4 or WebM video.`,
    };
  }
  if (file.size > MAX_UPLOAD_BYTES) {
    return {
      ok: false,
      error: `“${file.name}” is ${(file.size / (1024 * 1024)).toFixed(1)} MB — the limit is 10 MB.`,
    };
  }
  if (file.size === 0) {
    return { ok: false, error: `“${file.name}” is empty.` };
  }
  let res: Response;
  try {
    res = await fetch('/api/artifact/upload', {
      method: 'POST',
      credentials: 'include',
      headers: {
        'Content-Type': file.type || 'application/octet-stream',
        'X-Filename': encodeURIComponent(file.name),
        'X-Title': encodeURIComponent(file.name),
        'X-Domain': 'timeline',
      },
      body: file,
    });
  } catch {
    return { ok: false, error: 'Upload failed — check your connection and try again.' };
  }
  let data: { ok?: boolean; dtuId?: string; error?: string } = {};
  try { data = await res.json(); } catch { /* non-JSON body */ }
  if (!res.ok || !data?.ok || !data.dtuId) {
    return { ok: false, error: data?.error || `Upload failed (${res.status})` };
  }
  return {
    ok: true,
    item: { kind, url: `/api/artifact/${data.dtuId}/stream`, caption: '' },
  };
}

/** F14, client leg: the same shape rule the server enforces — an
 *  artifact stream path or an absolute http(s) URL is usable; anything
 *  else is refused with the reason. Returns null when usable. */
export function mediaUrlError(raw: string): string | null {
  const u = (raw || '').trim();
  if (/^\/api\/artifact\/[A-Za-z0-9_.:-]+\/stream$/.test(u)) return null;
  try {
    const parsed = new URL(u);
    if (parsed.protocol === 'http:' || parsed.protocol === 'https:') return null;
  } catch { /* not a URL */ }
  return `That link can't be used: ${u.slice(0, 80) || '(empty)'} — paste an http(s) link or upload the file instead.`;
}

/** F14, photo leg: actually load it. A link that cannot load as an
 *  image is refused before it can become a broken tile. Resolves true
 *  when the image loads. */
export function probeImageUrl(url: string): Promise<boolean> {
  return new Promise((resolve) => {
    const img = new Image();
    img.onload = () => resolve(true);
    img.onerror = () => resolve(false);
    img.src = url;
  });
}
