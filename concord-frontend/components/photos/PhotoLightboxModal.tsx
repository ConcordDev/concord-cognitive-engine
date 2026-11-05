'use client';

// components/photos/PhotoLightboxModal.tsx
//
// Single-photo detail / lightbox view for the `photos` lens. Wires the
// genuinely-unwired `photos.get` macro (server/domains/photos.js) — a real,
// owner-or-public-gated single-row lookup that previously had no UI caller
// (docs/lens-specs/photos-capability-map.md: "UNSURFACED ... a legitimate
// but low-priority follow-on"). Mirrors the SpeciesDetailModal pattern
// (components/fishing/SpeciesDetailModal.tsx): Modal + lensRun + explicit
// loading/error/data states, no fabricated placeholder content.
//
// The full-size image still streams from the real `/api/photos/:id/image`
// route (same blob the gallery card thumbnail uses) — `photos.get` doesn't
// return image bytes, only metadata (`blob_path` is a server-side
// filesystem path, never rendered).

import { useEffect, useState } from 'react';
import { Camera, Globe2, Lock, Sparkles } from 'lucide-react';
import { Modal } from '@/components/common/Modal';
import { ErrorState, Skeleton } from '@/components/ui';
import { cn } from '@/lib/utils';
import { ds } from '@/lib/design-system';
import { lensRun } from '@/lib/api/client';

export interface PhotoDetail {
  id: string;
  user_id: string;
  world_id: string | null;
  caption: string | null;
  taken_at: number;
  dtu_id: string | null;
  visibility: string;
  blob_path?: string;
  width: number | null;
  height: number | null;
  size_bytes: number | null;
  original_filename: string | null;
}

interface PhotoLightboxModalProps {
  /** The photo to show detail for, or null when the lightbox is closed. */
  photoId: string | null;
  onClose: () => void;
}

function formatTakenAt(ts: number): string {
  if (!Number.isFinite(ts)) return 'unknown time';
  return new Date(ts * 1000).toLocaleString(undefined, {
    dateStyle: 'medium',
    timeStyle: 'short',
  });
}

function formatBytes(n: number | null): string {
  if (!n || !Number.isFinite(n)) return 'unknown';
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  return `${(n / (1024 * 1024)).toFixed(1)} MB`;
}

export function PhotoLightboxModal({ photoId, onClose }: PhotoLightboxModalProps) {
  const [photo, setPhoto] = useState<PhotoDetail | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!photoId) { setPhoto(null); setError(null); return; }
    let cancelled = false;
    setLoading(true);
    setError(null);
    setPhoto(null);
    lensRun<{ ok: boolean; photo?: PhotoDetail; reason?: string }>('photos', 'get', { id: photoId })
      .then((res) => {
        if (cancelled) return;
        if (res.data.ok && res.data.result?.ok && res.data.result.photo) {
          setPhoto(res.data.result.photo);
        } else {
          setError(res.data.result?.reason || res.data.error || 'Photo lookup failed.');
        }
      })
      .catch((e) => { if (!cancelled) setError(e instanceof Error ? e.message : 'Photo lookup failed.'); })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [photoId]);

  return (
    <Modal isOpen={photoId !== null} onClose={onClose} title={photo?.caption || 'Photo'} size="lg">
      {loading && (
        <div data-testid="photo-lightbox-loading" className="space-y-3 py-1" role="status" aria-busy="true" aria-live="polite">
          <span className="sr-only">Loading photo…</span>
          <Skeleton variant="block" height="16rem" />
          <Skeleton variant="line" lines={2} />
        </div>
      )}

      {!loading && error && (
        <div data-testid="photo-lightbox-error">
          <ErrorState message={error} variant="inline" />
        </div>
      )}

      {!loading && !error && photo && (
        <div data-testid="photo-lightbox-detail" className="space-y-4">
          <div className="overflow-hidden rounded-lg border border-sky-500/20 bg-slate-900/70">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src={`/api/photos/${photo.id}/image`}
              alt={photo.caption || 'Untitled photo'}
              className="max-h-[60vh] w-full object-contain"
              onError={(e) => {
                // Honest degrade — never fabricate a placeholder image.
                (e.currentTarget as HTMLImageElement).style.display = 'none';
              }}
            />
          </div>

          <div>
            <h3 className="text-sm font-medium text-sky-100">{photo.caption || 'Untitled'}</h3>
            <p className={cn(ds.textMuted, 'mt-1 text-xs')}>{formatTakenAt(photo.taken_at)}</p>
          </div>

          <dl className="grid grid-cols-2 gap-3 text-sm">
            <div>
              <dt className={ds.textMuted}>World</dt>
              <dd className="flex items-center gap-1 text-gray-200">
                <Globe2 className="h-3 w-3 text-slate-400" aria-hidden="true" />
                {photo.world_id || 'unknown'}
              </dd>
            </div>
            <div>
              <dt className={ds.textMuted}>Visibility</dt>
              <dd className="flex items-center gap-1 capitalize text-gray-200">
                {photo.visibility === 'public' ? (
                  <Camera className="h-3 w-3 text-emerald-400" aria-hidden="true" />
                ) : (
                  <Lock className="h-3 w-3 text-slate-400" aria-hidden="true" />
                )}
                {photo.visibility}
              </dd>
            </div>
            <div>
              <dt className={ds.textMuted}>Dimensions</dt>
              <dd className="text-gray-200">
                {photo.width && photo.height ? `${photo.width} × ${photo.height}px` : 'unknown'}
              </dd>
            </div>
            <div>
              <dt className={ds.textMuted}>File</dt>
              <dd className="text-gray-200">PNG &middot; {formatBytes(photo.size_bytes)}</dd>
            </div>
            {photo.original_filename ? (
              <div className="col-span-2">
                <dt className={ds.textMuted}>Original filename</dt>
                <dd className="truncate text-gray-200">{photo.original_filename}</dd>
              </div>
            ) : null}
          </dl>

          {photo.dtu_id ? (
            <div className="flex items-center gap-1.5 rounded-lg border border-emerald-700/40 bg-emerald-950/20 p-2.5 text-xs text-emerald-200">
              <Sparkles className="h-3 w-3" aria-hidden="true" />
              <span>
                DTU minted &middot; royalty active &middot;{' '}
                <code className="rounded bg-emerald-900/40 px-1 py-0.5 text-[11px]">{photo.dtu_id}</code>
              </span>
            </div>
          ) : (
            <p className="text-xs text-slate-500">Not shared yet — no DTU minted.</p>
          )}
        </div>
      )}
    </Modal>
  );
}
