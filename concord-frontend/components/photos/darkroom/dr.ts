'use client';

/** Calls and shapes for the Darkroom (photos.* lens actions + /api/photos file routes). */
import { api, lensRun } from '@/lib/api/client';
import type { Edit } from './editTypes';

export interface Res<T> { ok: boolean; result: T | null; error: string | null }

export async function dr<T>(action: string, input: Record<string, unknown> = {}): Promise<Res<T>> {
  try {
    const r = await lensRun<T>('photos', action, input);
    const d = r.data as ({ ok?: boolean; result?: T; error?: string; message?: string } & Record<string, unknown>) | undefined;
    if (!d) return { ok: false, result: null, error: 'No answer from the server.' };
    if (d.ok === false) return { ok: false, result: null, error: d.error || d.message || 'That did not work.' };
    const payload = (d.result && typeof d.result === 'object' ? d.result : d) as T & { ok?: boolean; error?: string };
    if (payload.ok === false) return { ok: false, result: null, error: payload.error || 'That did not work.' };
    return { ok: true, result: payload, error: null };
  } catch (e) {
    return { ok: false, result: null, error: e instanceof Error ? e.message : 'That did not work.' };
  }
}

export interface Exif {
  make?: string; model?: string; lens?: string; iso?: number; fNumber?: number; exposureTime?: number;
  focalLength?: number; focalLength35?: number; exposureBias?: number; capturedAt?: string; gps?: { lat: number; lon: number };
}
export interface Photo {
  id: string; caption: string | null; altText: string | null; tags: string[]; favorite: boolean;
  rating: number; flag: 'none' | 'pick' | 'reject'; label: Label | null;
  width: number | null; height: number | null; sizeBytes: number | null; filename: string | null; mime: string | null;
  source: 'import' | 'concordia'; worldId: string | null; takenAt: number | null; capturedAt: number | null;
  camera: string | null; lens: string | null; exif: Exif; edited: boolean; editedAt: number | null;
  visibility: string; dtuId: string | null; thumbUrl: string; previewUrl: string;
}
export type Label = 'red' | 'yellow' | 'green' | 'blue' | 'purple';
export const LABELS: Label[] = ['red', 'yellow', 'green', 'blue', 'purple'];
export interface Facets { total: number; picks: number; rejects: number; rated: number; labels: Record<string, number>; keywords: Record<string, number>; cameras: Record<string, number>; concordia: number }
export interface Filter { minRating?: number; flag?: 'pick' | 'reject' | 'unflagged'; label?: Label; keyword?: string; camera?: string; text?: string; edited?: boolean; source?: 'import' | 'concordia'; favorite?: boolean }
export interface Library { photos: Photo[]; total: number; facets: Facets | null; filter: Filter }
export interface HistoryStep { id: number; label: string; snapshot: boolean; at: number }
export interface Release {
  id: string; photoId?: string; title: string; description: string; priceCC: number; width: number; height: number;
  format: string; longEdge: number; status: 'published' | 'withdrawn'; publishedAt: number;
  photographer: { name: string; isMe: boolean }; owned: boolean; canDownload: boolean; buyers: number | null;
  proofUrl: string; downloadUrl: string;
}
export interface PhotoDetail { photo: Photo; edit: Edit; history: HistoryStep[]; releases: Release[] }
export interface Preset { id: string; name: string; edit: Edit; createdAt: number }
export interface Album { id: string; name: string; smart: boolean; rule?: Filter; count: number; coverPhotoId: string | null }

export const IMPORT_TYPES = 'image/jpeg,image/png,image/webp,image/tiff,image/gif,image/avif,.jpg,.jpeg,.png,.webp,.tif,.tiff,.gif,.avif';
export const MAX_IMPORT_MB = 40;

/** Import one file exactly as it is. */
export async function importFile(file: File): Promise<{ ok: true; photo: Photo } | { ok: false; error: string }> {
  if (file.size > MAX_IMPORT_MB * 1024 * 1024) return { ok: false, error: `${file.name} is ${(file.size / 1048576).toFixed(1)} MB; the limit is ${MAX_IMPORT_MB} MB.` };
  try {
    const r = await api.post(`/api/photos/upload?name=${encodeURIComponent(file.name)}`, file, {
      headers: { 'Content-Type': file.type || 'application/octet-stream' },
      validateStatus: () => true, timeout: 180_000,
    });
    const d = r.data as { ok?: boolean; photo?: Photo; error?: string };
    if (!d?.ok || !d.photo) return { ok: false, error: `${file.name}: ${d?.error || `the upload failed (${r.status})`}` };
    return { ok: true, photo: d.photo };
  } catch (e) {
    return { ok: false, error: `${file.name}: ${e instanceof Error ? e.message : 'the upload failed'}` };
  }
}

export interface ExportOptions { format: 'jpeg' | 'webp' | 'png'; quality: number; longEdge: number; exif: boolean; location: boolean }
export function exportUrl(photoId: string, o: ExportOptions) {
  const q = new URLSearchParams({ format: o.format, quality: String(o.quality), longEdge: String(o.longEdge), exif: o.exif ? '1' : '0', location: o.location ? '1' : '0' });
  return `/api/photos/${encodeURIComponent(photoId)}/export?${q}`;
}

/** Download a server-rendered export as a file (and report its real size). */
export async function downloadExport(photoId: string, o: ExportOptions, fallbackName: string): Promise<{ ok: true; width: number; height: number; bytes: number } | { ok: false; error: string }> {
  try {
    const r = await api.get(exportUrl(photoId, o), { responseType: 'blob', validateStatus: () => true, timeout: 300_000 });
    if (r.status !== 200) {
      let msg = `the export failed (${r.status})`;
      try { msg = JSON.parse(await (r.data as Blob).text()).error || msg; } catch { /* keep the status */ }
      return { ok: false, error: msg };
    }
    const blob = r.data as Blob;
    const cd = String(r.headers['content-disposition'] || '');
    const name = /filename="([^"]+)"/.exec(cd)?.[1] || fallbackName;
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url; a.download = name; document.body.appendChild(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 30_000);
    return { ok: true, width: Number(r.headers['x-photo-width']) || 0, height: Number(r.headers['x-photo-height']) || 0, bytes: blob.size };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : 'the export failed' };
  }
}

export const shutter = (t?: number) => (!t || t <= 0 ? null : t >= 1 ? `${Math.round(t * 10) / 10}s` : `1/${Math.round(1 / t)}`);
export const bytes = (n: number | null | undefined) => (!n ? '—' : n >= 1048576 ? `${(n / 1048576).toFixed(1)} MB` : `${Math.round(n / 1024)} KB`);
export const photoName = (p: Pick<Photo, 'caption' | 'filename' | 'id'>) => p.caption || p.filename || p.id;
export function dateOf(p: Pick<Photo, 'capturedAt' | 'takenAt'>) {
  const t = p.capturedAt || p.takenAt;
  return t ? new Date(t * 1000).toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' }) : 'Undated';
}
