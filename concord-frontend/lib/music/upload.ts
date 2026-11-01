import type { MusicTrack, TierConfig } from '@/lib/music/types';

/**
 * Real-money trading is off, so every upload ships free and listen-only:
 * `create` / `commercial` are stored disabled at price 0. (A priced
 * create/commercial tier makes the server serve other listeners only a
 * preview window, i.e. the track "can't be played".)
 */
export function freeListenOnlyTiers(): TierConfig[] {
  return [
    { tier: 'listen', enabled: true, price: 0, currency: 'USD', maxLicenses: null, licensesIssued: 0 },
    { tier: 'create', enabled: false, price: 0, currency: 'USD', maxLicenses: null, licensesIssued: 0 },
    { tier: 'commercial', enabled: false, price: 0, currency: 'USD', maxLicenses: null, licensesIssued: 0 },
  ];
}

/** Query string for POST /api/media/upload-raw (the file is the request body). */
export function rawUploadQuery(args: {
  title: string; filename: string; duration: number;
  previewStart: number; previewDuration: number; tags: string[];
}): string {
  const q = new URLSearchParams({
    title: args.title,
    filename: args.filename,
    mediaType: 'audio',
    duration: String(args.duration),
    previewStart: String(args.previewStart),
    previewDuration: String(args.previewDuration),
    privacy: 'public',
    tiers: JSON.stringify(freeListenOnlyTiers()),
  });
  if (args.tags.length) q.set('tags', args.tags.join(','));
  return q.toString();
}

const MB = 1024 * 1024;

/** A readable, specific message for a failed upload (never a bare status code). */
export function describeUploadError(err: unknown, file?: { name: string; type: string; size: number }): string {
  const e = err as {
    response?: { status?: number; data?: { error?: string; message?: string } | string };
    message?: string;
  };
  const status = e?.response?.status;
  const data = e?.response?.data;
  const body = typeof data === 'object' && data ? data : undefined;
  const server = body?.message || body?.error;
  if (status === 413) {
    const size = file ? ` (${(file.size / MB).toFixed(1)} MB)` : '';
    return `File too large${size}. ${server && server !== 'payload_too_large' ? server : 'The server or network limit was exceeded.'}`;
  }
  if (status === 400 && server && /type not allowed/i.test(server)) {
    return `Format not supported: ${file?.type || file?.name || 'unknown'}. Use mp3, wav, flac, m4a, aac, ogg, mp4 or mov.`;
  }
  if (status === 401) return 'You need to be signed in to upload.';
  if (server) return server;
  if (status) return `Upload failed (HTTP ${status}).`;
  return e?.message || 'Upload failed.';
}

/**
 * A lens row's data may be missing fields (older rows, API-created rows).
 * The Music lens indexes into tiers/tags/stems/credits directly, so one
 * malformed row used to crash the whole lens. Default every collection.
 */
export function normalizeTrackRow(data: unknown, id: string, title: string): MusicTrack {
  const d = (data && typeof data === 'object' ? data : {}) as Partial<MusicTrack>;
  return {
    ...(d as MusicTrack),
    id,
    title,
    tiers: Array.isArray(d.tiers) ? d.tiers : [],
    tags: Array.isArray(d.tags) ? d.tags : [],
    stems: Array.isArray(d.stems) ? d.stems : [],
    credits: Array.isArray(d.credits) ? d.credits : [],
    waveformPeaks: Array.isArray(d.waveformPeaks) ? d.waveformPeaks : [],
  };
}
