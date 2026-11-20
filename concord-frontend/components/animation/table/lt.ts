'use client';

/** Shared calls for the Light Table. */
import { lensRun } from '@/lib/api/client';

export interface Res<T> { ok: boolean; result: T | null; error: string | null }
export async function an<T>(action: string, input: Record<string, unknown> = {}): Promise<Res<T>> {
  try {
    const r = await lensRun<T>('animation', action, input);
    const d = r.data as { ok?: boolean; result?: T; error?: string; message?: string } | undefined;
    if (d?.ok) return { ok: true, result: (d.result ?? null) as T | null, error: null };
    return { ok: false, result: null, error: d?.error || d?.message || 'That did not work.' };
  } catch (e) {
    return { ok: false, result: null, error: e instanceof Error ? e.message : 'That did not work.' };
  }
}

function csrf(): Record<string, string> {
  const m = typeof document !== 'undefined' ? document.cookie.match(/csrf_token=([^;]+)/) : null;
  return m ? { 'X-CSRF-Token': decodeURIComponent(m[1]) } : {};
}

/** Upload a file as your media (the file is the request body). */
export async function uploadMedia(file: Blob, meta: { title: string; filename: string; mediaType: 'audio' | 'video' | 'image'; duration?: number; tags?: string[] }): Promise<{ ok: true; mediaId: string } | { ok: false; error: string }> {
  const q = new URLSearchParams({ title: meta.title.slice(0, 160), filename: meta.filename, mediaType: meta.mediaType, privacy: 'private', tier: 'regular' });
  if (meta.duration && meta.duration > 0) q.set('duration', String(Math.round(meta.duration * 1000) / 1000));
  if (meta.tags?.length) q.set('tags', meta.tags.join(','));
  try {
    const res = await fetch(`/api/media/upload-raw?${q.toString()}`, { method: 'POST', credentials: 'include', headers: { 'Content-Type': file.type || 'application/octet-stream', ...csrf() }, body: file });
    const body = (await res.json().catch(() => ({}))) as { mediaDTU?: { id?: string }; id?: string; error?: string; message?: string };
    const id = body.mediaDTU?.id || body.id;
    if (!res.ok || !id) return { ok: false, error: res.status === 413 ? 'That file is too large for one upload.' : res.status === 401 ? 'Sign in to upload.' : body.message || body.error || `The upload failed (${res.status}).` };
    return { ok: true, mediaId: String(id) };
  } catch {
    return { ok: false, error: 'The upload was interrupted. Check your connection and try again.' };
  }
}

export const secs = (s: number) => (s >= 60 ? `${Math.floor(s / 60)}:${String(Math.round(s % 60)).padStart(2, '0')}` : `${Math.round(s * 10) / 10} s`);
export const cc = (n: number) => `${n.toLocaleString(undefined, { minimumFractionDigits: n % 1 ? 2 : 0, maximumFractionDigits: 2 })} CC`;

export interface Release {
  id: string; title: string; logline: string; runtimeSec: number; priceCC: number; previewSec: number | null; poster: string | null;
  animator: { name: string; isMe: boolean }; status: string; publishedAt: string; owned: boolean; canWatchFull: boolean; streamUrl: string;
  buyers: number | null; fps: number | null; width: number | null; height: number | null;
}
