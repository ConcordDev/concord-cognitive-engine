/**
 * Typed client for the Liner Notes macros (server/domains/music-releases.js
 * and the library macros in server/domains/music.js). Every call goes through
 * /api/lens/run; uploads go through the real media and artifact upload routes.
 * Nothing in this file invents data.
 */

import { lensRun } from '@/lib/api/client';
import type { MusicTrack } from '@/lib/music/types';

export interface Envelope<T> { ok: boolean; result?: T; error?: string }

export async function music<T>(action: string, input: Record<string, unknown> = {}): Promise<Envelope<T>> {
  try {
    const r = await lensRun<T>('music', action, input);
    const d = r.data;
    if (!d.ok) return { ok: false, error: d.message || d.error || 'That did not work.' };
    return { ok: true, result: (d.result ?? undefined) as T | undefined };
  } catch (e) {
    return { ok: false, error: (e as Error)?.message || 'Request failed' };
  }
}

// ── shapes (only fields the server returns) ─────────────────────────────

export interface ArtistCard { handle: string | null; key: string; name: string; isMe: boolean }

export interface ReleaseTrack {
  mediaId: string;
  title: string;
  durationSec: number | null;
  explicit: boolean;
  bpm: number | null;
  key: string | null;
  lufs: number | null;
  plays: number;
  streamUrl: string;
  fullStream: boolean;
}

export interface Release {
  id: string;
  title: string;
  type: 'single' | 'ep' | 'album';
  genre: string | null;
  note: string;
  credits: Array<{ role: string; name: string }>;
  coverDtuId: string | null;
  coverUrl: string | null;
  priceCC: number;
  streaming: 'full' | 'preview';
  previewSec: number;
  status: 'draft' | 'published';
  releaseDate: string;
  publishedAt: string | null;
  dtuId?: string;
  sales?: number;
  owned: boolean;
  remixOf: Array<{ id: string; title: string; artist: ArtistCard }>;
  remixes: Array<{ id: string; title: string; artist: ArtistCard }>;
  artist: ArtistCard;
  tracks: ReleaseTrack[];
  durationSec: number;
}

export interface ArtistPage {
  artist: ArtistCard;
  bio: string;
  links: Array<{ label: string; url: string }>;
  followers: number;
  following: boolean;
  releases: Release[];
  topTracks: Array<ReleaseTrack & { releaseId: string; releaseTitle: string; coverUrl: string | null }>;
  totalPlays: number;
}

export interface LibraryTrack {
  id: string;
  title: string;
  artist: string;
  artistKey?: string;
  album: string | null;
  genre: string;
  durationSec: number;
  liked: boolean;
  playCount: number;
  releaseId?: string;
  mediaId?: string;
  audioUrl?: string | null;
  previewUrl?: string | null;
  coverUrl?: string | null;
  artworkUrl?: string | null;
  externalId?: string;
}

export interface Playlist { id: string; name: string; description: string | null; trackIds: string[]; collaborative?: boolean }

// ── helpers ─────────────────────────────────────────────────────────────

export const TYPE_LABEL: Record<Release['type'], string> = { single: 'Single', ep: 'EP', album: 'Album' };

export function fmtDuration(sec: number | null | undefined): string {
  if (sec == null || !Number.isFinite(sec) || sec <= 0) return '—';
  const s = Math.round(sec);
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const r = s % 60;
  return h ? `${h}:${String(m).padStart(2, '0')}:${String(r).padStart(2, '0')}` : `${m}:${String(r).padStart(2, '0')}`;
}

export function fmtTotal(sec: number): string {
  if (sec > 0 && sec < 60) return `${Math.round(sec)} sec`;
  const m = Math.round(sec / 60);
  if (m < 60) return `${m} min`;
  return `${Math.floor(m / 60)} hr ${m % 60} min`;
}


export const fmtCC = (n: number) => `${Number.isInteger(n) ? n : n.toFixed(2)} CC`;

export const artistRef = (a: ArtistCard) => (a.handle ? { handle: a.handle } : { artistKey: a.key });

/** A release track as the platform player's track shape. Unknown fields are empty, not made up. */
export function toPlayerTrack(r: Release, t: ReleaseTrack, index: number): MusicTrack {
  const now = r.publishedAt || r.releaseDate;
  return {
    id: `${r.id}:${t.mediaId}`,
    title: t.title,
    artistId: r.artist.key,
    artistName: r.artist.name,
    albumId: r.id,
    albumTitle: r.title,
    coverArtUrl: r.coverUrl,
    audioUrl: t.streamUrl,
    previewUrl: null,
    duration: t.durationSec || 0,
    trackNumber: index + 1,
    genre: r.genre || '',
    subGenre: null,
    tags: [],
    bpm: t.bpm,
    key: t.key,
    loudnessLUFS: t.lufs,
    spectralCentroid: null,
    onsetDensity: null,
    waveformPeaks: [],
    tiers: [],
    playCount: t.plays,
    purchaseCount: 0,
    remixCount: r.remixes.length,
    parentTrackId: null,
    parentArtistId: null,
    parentTitle: r.remixOf[0]?.title ?? null,
    lineageDepth: r.remixOf.length ? 1 : 0,
    stems: [],
    releaseDate: r.releaseDate,
    createdAt: now,
    updatedAt: now,
    isExplicit: t.explicit,
    lyrics: null,
    credits: [],
    chromaprintHash: null,
  } as MusicTrack;
}

export function libraryToPlayerTrack(t: LibraryTrack, index: number): MusicTrack | null {
  const url = t.audioUrl || t.previewUrl;
  if (!url) return null;
  return {
    id: t.releaseId && t.mediaId ? `${t.releaseId}:${t.mediaId}` : t.id,
    title: t.title,
    artistId: t.artistKey || t.artist,
    artistName: t.artist,
    albumId: t.releaseId || null,
    albumTitle: t.album,
    coverArtUrl: t.coverUrl || t.artworkUrl || null,
    audioUrl: url,
    previewUrl: null,
    duration: t.durationSec || 0,
    trackNumber: index + 1,
    genre: t.genre,
    subGenre: null,
    tags: [],
    bpm: null, key: null, loudnessLUFS: null, spectralCentroid: null, onsetDensity: null,
    waveformPeaks: [], tiers: [], playCount: t.playCount, purchaseCount: 0, remixCount: 0,
    parentTrackId: null, parentArtistId: null, parentTitle: null, lineageDepth: 0, stems: [],
    releaseDate: '', createdAt: '', updatedAt: '', isExplicit: false, lyrics: null, credits: [], chromaprintHash: null,
  } as MusicTrack;
}

/** Split a player track id back into release + media (release tracks only). */
export function releaseRefOf(trackId: string | undefined | null): { releaseId: string; mediaId: string } | null {
  if (!trackId) return null;
  const i = trackId.indexOf(':');
  if (i <= 0 || !trackId.startsWith('rel_')) return null;
  return { releaseId: trackId.slice(0, i), mediaId: trackId.slice(i + 1) };
}

// ── uploads ─────────────────────────────────────────────────────────────

function csrf(): Record<string, string> {
  const m = typeof document !== 'undefined' ? document.cookie.match(/csrf_token=([^;]+)/) : null;
  return m ? { 'X-CSRF-Token': decodeURIComponent(m[1]) } : {};
}

/**
 * Cloudflare's edge rejects a request body over 100 MB with a bare 413.
 * Stop a little under that, in words, instead of sending a file the edge will drop.
 */
export const MAX_TRACK_UPLOAD_BYTES = 95 * 1024 * 1024;

export function trackTooLargeMessage(filename: string): string {
  return `${filename} is over 95 MB, so it was not uploaded. The network limit is 100 MB.`;
}

/**
 * Upload one audio file as a private media DTU (it becomes public when its
 * release is published). Returns the media id.
 */
export async function uploadTrackFile(
  file: File,
  title: string,
  durationSec: number,
  onProgress?: (fraction: number) => void,
): Promise<Envelope<{ mediaId: string }>> {
  if (file.size > MAX_TRACK_UPLOAD_BYTES) {
    return { ok: false, error: trackTooLargeMessage(file.name) };
  }
  const q = new URLSearchParams({
    title,
    filename: file.name,
    mediaType: 'audio',
    privacy: 'private',
    previewStart: '0',
    previewDuration: '0',
  });
  // No measured length: omit duration. Sending 1 would store a made-up length
  // (the server trusts a positive declared duration over the file itself).
  if (Number.isFinite(durationSec) && durationSec > 0) {
    q.set('duration', String(Math.max(1, Math.round(durationSec))));
  }
  return new Promise((resolve) => {
    const xhr = new XMLHttpRequest();
    xhr.open('POST', `/api/media/upload-raw?${q.toString()}`);
    xhr.withCredentials = true;
    xhr.setRequestHeader('Content-Type', file.type || 'application/octet-stream');
    for (const [k, v] of Object.entries(csrf())) xhr.setRequestHeader(k, v);
    xhr.upload.onprogress = (e) => { if (e.lengthComputable) onProgress?.(e.loaded / e.total); };
    xhr.onerror = () => resolve({ ok: false, error: 'The upload was interrupted. Check your connection and try again.' });
    xhr.onload = () => {
      let body: { mediaDTU?: { id?: string }; id?: string; media?: { id?: string }; error?: string; message?: string } = {};
      try { body = JSON.parse(xhr.responseText || '{}'); } catch { /* non-JSON */ }
      const id = body.mediaDTU?.id || body.id || body.media?.id;
      if (xhr.status >= 200 && xhr.status < 300 && id) resolve({ ok: true, result: { mediaId: id } });
      else if (xhr.status === 413) {
        const detail = typeof body.message === 'string' && body.message.trim() ? body.message.trim() : '';
        resolve({
          ok: false,
          error: detail
            ? `${file.name} is too large to upload. ${detail}`
            : `${file.name} was rejected as too large (HTTP 413). The network limit is 100 MB.`,
        });
      } else resolve({ ok: false, error: body.message || body.error || `Upload failed (${xhr.status}).` });
    };
    xhr.send(file);
  });
}

/** Upload a cover through the platform artifact route; returns the owned image DTU id. */
export async function uploadCover(file: File, title: string): Promise<Envelope<{ dtuId: string }>> {
  if (!['image/png', 'image/jpeg', 'image/webp'].includes(file.type)) return { ok: false, error: 'Covers must be PNG, JPEG or WebP.' };
  if (file.size > 10 * 1024 * 1024) return { ok: false, error: 'Covers must be under 10 MB.' };
  try {
    const res = await fetch('/api/artifact/upload', {
      method: 'POST',
      credentials: 'include',
      headers: {
        'Content-Type': file.type,
        'X-Filename': encodeURIComponent(file.name),
        'X-Title': encodeURIComponent(`Cover — ${title}`),
        'X-Domain': 'music',
        ...csrf(),
      },
      body: file,
    });
    const body = (await res.json().catch(() => ({}))) as { dtuId?: string; error?: string };
    if (!res.ok || !body.dtuId) return { ok: false, error: body.error || 'The cover did not upload.' };
    return { ok: true, result: { dtuId: body.dtuId } };
  } catch (e) {
    return { ok: false, error: (e as Error)?.message || 'The cover did not upload.' };
  }
}
