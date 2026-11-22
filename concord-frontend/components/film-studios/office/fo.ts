'use client';

/** Shared calls and helpers for the Production Office. */
import { lensRun } from '@/lib/api/client';
import { safeLocalMediaUrl } from '@/lib/safe-media-url';

export interface Res<T> { ok: boolean; result: T | null; error: string | null }
export async function fs<T>(action: string, input: Record<string, unknown> = {}): Promise<Res<T>> {
  try {
    const r = await lensRun<T>('film-studios', action, input);
    const d = r.data as { ok?: boolean; result?: T; error?: string; message?: string } | undefined;
    if (d?.ok) return { ok: true, result: (d.result ?? null) as T | null, error: null };
    return { ok: false, result: null, error: d?.error || d?.message || 'That did not work.' };
  } catch (e) {
    return { ok: false, result: null, error: e instanceof Error ? e.message : 'That did not work.' };
  }
}

/** The stripboard's industry colours: a strip's colour is its INT/EXT and time of day. */
export function stripColour(intExt: string | null | undefined, timeOfDay: string | null | undefined): string {
  const ext = /EXT/.test(String(intExt || '')) && !/^INT$/.test(String(intExt || ''));
  const t = String(timeOfDay || '').toUpperCase();
  if (t === 'DAWN' || t === 'DUSK') return 'var(--fo-strip-dawn)';
  const night = t === 'NIGHT' || t === 'EVENING';
  if (ext) return night ? 'var(--fo-strip-ext-night)' : 'var(--fo-strip-ext-day)';
  return night ? 'var(--fo-strip-int-night)' : 'var(--fo-strip-int-day)';
}

export function tc(sec: number | null | undefined): string {
  const t = Math.max(0, Number(sec) || 0);
  const h = Math.floor(t / 3600), m = Math.floor((t % 3600) / 60), s = Math.floor(t % 60), f = Math.floor((t - Math.floor(t)) * 24);
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}:${String(f).padStart(2, '0')}`;
}
export const runtime = (sec: number) => (sec >= 3600 ? `${Math.floor(sec / 3600)} h ${Math.round((sec % 3600) / 60)} min` : sec >= 60 ? `${Math.round(sec / 60)} min` : `${Math.round(sec)} s`);
export const cc = (n: number) => `${n.toLocaleString(undefined, { minimumFractionDigits: n % 1 ? 2 : 0, maximumFractionDigits: 2 })} CC`;

function csrf(): Record<string, string> {
  const m = typeof document !== 'undefined' ? document.cookie.match(/csrf_token=([^;]+)/) : null;
  return m ? { 'X-CSRF-Token': decodeURIComponent(m[1]) } : {};
}

/** Real footage goes up as the request body (the JSON upload path cuts files at ~7.5 KB). */
export async function uploadFootage(file: File, title: string): Promise<{ ok: true; mediaId: string } | { ok: false; error: string }> {
  const kind = file.type.startsWith('video/') ? 'video' : file.type.startsWith('audio/') ? 'audio' : file.type.startsWith('image/') ? 'image' : null;
  if (!kind) return { ok: false, error: 'Footage must be a video, audio or image file.' };
  const duration = kind === 'image' ? 0 : await probeDuration(file);
  const q = new URLSearchParams({ title, filename: file.name, mediaType: kind, privacy: 'private', tier: 'regular', tags: 'film' });
  if (duration > 0) q.set('duration', String(Math.round(duration * 1000) / 1000));
  try {
    const res = await fetch(`/api/media/upload-raw?${q.toString()}`, { method: 'POST', credentials: 'include', headers: { 'Content-Type': file.type || 'application/octet-stream', ...csrf() }, body: file });
    const body = (await res.json().catch(() => ({}))) as { mediaDTU?: { id?: string }; id?: string; error?: string; message?: string };
    const id = body.mediaDTU?.id || body.id;
    if (!res.ok || !id) return { ok: false, error: res.status === 413 ? 'That file is too large for one upload.' : body.message || body.error || `The upload failed (${res.status}).` };
    return { ok: true, mediaId: String(id) };
  } catch {
    return { ok: false, error: 'The upload was interrupted. Check your connection and try again.' };
  }
}

/** The file's real length, read by the browser from the file itself. */
function probeDuration(file: File): Promise<number> {
  return new Promise((resolve) => {
    try {
      const el = document.createElement(file.type.startsWith('audio/') ? 'audio' : 'video');
      const url = URL.createObjectURL(file);
      const done = (v: number) => { URL.revokeObjectURL(url); resolve(Number.isFinite(v) && v > 0 ? v : 0); };
      el.preload = 'metadata';
      el.onloadedmetadata = () => done(el.duration);
      el.onerror = () => done(0);
      const safeUrl = safeLocalMediaUrl(url);
      if (!safeUrl) { done(0); return; }
      el.src = safeUrl;
    } catch { resolve(0); }
  });
}

/** A poster: a PNG/JPEG/WebP of yours, uploaded as an image (made public when the film is released). */
export async function uploadPoster(file: File, title: string): Promise<{ ok: true; mediaId: string } | { ok: false; error: string }> {
  if (!['image/png', 'image/jpeg', 'image/webp'].includes(file.type)) return { ok: false, error: 'The poster must be PNG, JPEG or WebP.' };
  if (file.size > 10 * 1024 * 1024) return { ok: false, error: 'The poster must be under 10 MB.' };
  return uploadFootage(file, `${title} poster`);
}

export interface Footage { id: string; name: string; kind: string; durationSec: number | null; durationFrames: number; streamUrl: string | null; platformMediaId: string | null; quality: string; camera: string | null }
export interface CutClip { id: string; name: string; transition: string; durationFrames: number; startTimecode: string; endTimecode: string; mediaId: string | null; streamUrl: string | null; mediaKind: string | null; sourceInSec: number; durationSec: number; startSec: number }
export interface Release {
  id: string; title: string; logline: string; runtimeSec: number; priceCC: number; previewSec: number | null; poster: string | null;
  filmmaker: { name: string; isMe: boolean }; status: string; publishedAt: string; owned: boolean; canWatchFull: boolean; streamUrl: string;
  buyers: number | null; credits: { cast: { name: string; role: string | null }[]; crew: { name: string; role: string | null }[] };
}
