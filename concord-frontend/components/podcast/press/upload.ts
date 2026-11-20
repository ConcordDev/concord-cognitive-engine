'use client';

/**
 * Upload a file as media through POST /api/media/upload-raw: the request
 * body is the file and the metadata rides the query string. (The JSON
 * /api/media/upload path takes base64 in a string field that the global
 * sanitizer cuts at 10,000 characters, about 7.5 KB, so a real episode or
 * cover never fit; the server refuses it as upload_truncated.)
 */

function csrf(): Record<string, string> {
  const m = typeof document !== 'undefined' ? document.cookie.match(/csrf_token=([^;]+)/) : null;
  return m ? { 'X-CSRF-Token': decodeURIComponent(m[1]) } : {};
}

export interface RawUpload { title: string; filename: string; mediaType: 'audio' | 'image'; privacy: 'public' | 'private'; duration?: number; tags?: string[] }

export async function uploadMediaRaw(file: Blob, meta: RawUpload): Promise<{ ok: true; mediaId: string; duration: number } | { ok: false; error: string }> {
  const q = new URLSearchParams({ title: meta.title, filename: meta.filename, mediaType: meta.mediaType, privacy: meta.privacy, tier: 'regular' });
  if (meta.duration && meta.duration > 0) q.set('duration', String(Math.round(meta.duration)));
  if (meta.tags?.length) q.set('tags', meta.tags.join(','));
  try {
    const res = await fetch(`/api/media/upload-raw?${q.toString()}`, {
      method: 'POST',
      credentials: 'include',
      headers: { 'Content-Type': file.type || 'application/octet-stream', ...csrf() },
      body: file,
    });
    const body = (await res.json().catch(() => ({}))) as { mediaDTU?: { id?: string; duration?: number }; id?: string; error?: string; message?: string };
    const id = body.mediaDTU?.id || body.id;
    if (!res.ok || !id) {
      if (res.status === 413) return { ok: false, error: 'That file is too large for one upload.' };
      if (res.status === 401) return { ok: false, error: 'Sign in to upload.' };
      return { ok: false, error: body.message || body.error || `The upload failed (${res.status}).` };
    }
    return { ok: true, mediaId: String(id), duration: Number(body.mediaDTU?.duration) || 0 };
  } catch {
    return { ok: false, error: 'The upload was interrupted. Check your connection and try again.' };
  }
}
