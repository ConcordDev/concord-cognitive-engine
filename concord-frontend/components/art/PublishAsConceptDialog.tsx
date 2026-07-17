'use client';

/**
 * PublishAsConceptDialog — mints a real, citable `dtus` row from the current
 * artwork via art.artwork-publish-as-concept (server/domains/art.js).
 *
 * Distinct from PublishAsTextureDialog: that one bridges the art lens into
 * evo_assets (material swatches — not part of the royalty-lineage graph);
 * this one bridges into the DTU substrate so the concept art can be CITED
 * as the origin of a later asset — e.g. game-design.building-publish's
 * optional `conceptArtDtuId` param folds this dtuId in as a citable parent
 * the same way a remix parent is (concept → asset lineage edge).
 *
 * The artwork's layer/stroke data is already persisted server-side (every
 * edit already round-trips through lensRun into STATE.artLens.artworks),
 * so this dialog only sends the artwork id + a title/visibility choice —
 * no image re-upload. The canvas preview below is purely local/informational.
 *
 * Honest by construction: success only ever shows a dtuId the server
 * actually returned from a real INSERT INTO dtus; any rejection (missing
 * artwork, no auth, DB failure) surfaces the server's own error string
 * verbatim — nothing here fabricates a success state.
 */

import { useCallback, useEffect, useState } from 'react';
import { lensRun } from '@/lib/api/client';

const VISIBILITIES = ['public', 'marketplace', 'internal', 'private'] as const;
type Visibility = typeof VISIBILITIES[number];

interface PublishConceptResult {
  ok: boolean;
  dtuId: string;
  artworkId: string;
  title: string;
  visibility: Visibility;
  layerCount: number;
  strokeCount: number;
}

export interface PublishAsConceptDialogProps {
  /** The artwork to publish. */
  artworkId: string | undefined;
  /** Used as the default title + placeholder. */
  artworkTitle?: string;
  /** Optional canvas for a client-side-only preview thumbnail. */
  canvas: HTMLCanvasElement | null;
  /** Close the dialog. */
  onClose: () => void;
}

export function PublishAsConceptDialog({ artworkId, artworkTitle, canvas, onClose }: PublishAsConceptDialogProps) {
  const [title, setTitle] = useState(artworkTitle || '');
  const [visibility, setVisibility] = useState<Visibility>('public');
  const [preview, setPreview] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [result, setResult] = useState<PublishConceptResult | null>(null);
  const [error, setError] = useState<string | null>(null);

  // Render canvas → data URL preview whenever the canvas pointer changes.
  // Local-only — never sent to the server (the artwork is already persisted).
  useEffect(() => {
    if (!canvas) { setPreview(null); return; }
    try { setPreview(canvas.toDataURL('image/png')); }
    catch { setPreview(null); }
  }, [canvas]);

  const submit = useCallback(async () => {
    if (!artworkId) return;
    setError(null);
    setSubmitting(true);
    try {
      const r = await lensRun('art', 'artwork-publish-as-concept', {
        id: artworkId,
        title: title.trim() || undefined,
        visibility,
      });
      if (r.data?.ok === false) {
        setError(r.data.error || 'publish failed');
      } else {
        setResult((r.data?.result as PublishConceptResult | null) || null);
      }
    } catch (e) {
      setError(String((e as Error)?.message || e));
    } finally {
      setSubmitting(false);
    }
  }, [artworkId, title, visibility]);

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label="Publish as concept art"
      tabIndex={-1}
      className="fixed inset-0 z-50 bg-black/70 flex items-center justify-center p-4"
      onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}
      onKeyDown={(e) => { if (e.key === 'Escape') onClose(); }}
    >
      <div className="bg-zinc-950 border border-zinc-800 rounded-lg w-full max-w-md p-5 text-zinc-200">
        <div className="flex items-baseline justify-between mb-4">
          <h2 className="text-sm font-semibold tracking-wide uppercase text-zinc-300">
            Publish as concept art
          </h2>
          <button type="button" onClick={onClose} className="text-zinc-500 hover:text-zinc-200 text-xs">close</button>
        </div>

        <div className="space-y-3">
          <div className="aspect-video bg-zinc-900 border border-zinc-800 rounded flex items-center justify-center overflow-hidden">
            {preview
              /* next/image doesn't fit data: URLs from canvas.toDataURL */
              /* eslint-disable-next-line @next/next/no-img-element */
              ? <img src={preview} alt="canvas preview" className="w-full h-full object-contain" />
              : <span className="text-zinc-600 text-xs">no canvas</span>}
          </div>
          <p className="text-[10px] leading-tight text-zinc-500">
            Mints a real <span className="font-mono text-zinc-400">dtus</span> row (kind
            {' '}<span className="font-mono text-violet-300">concept_art</span>) that other
            asset macros — e.g. a building blueprint — can cite as their origin.
          </p>

          <label className="block">
            <span className="block text-[10px] uppercase tracking-wider text-zinc-400 mb-1">Title</span>
            <input
              type="text"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder={artworkTitle || 'Untitled concept art'}
              className="w-full bg-zinc-900 border border-zinc-800 rounded px-2 py-1.5 text-sm"
            />
          </label>

          <label className="block">
            <span className="block text-[10px] uppercase tracking-wider text-zinc-400 mb-1">Visibility</span>
            <select
              value={visibility}
              onChange={(e) => setVisibility(e.target.value as Visibility)}
              className="w-full bg-zinc-900 border border-zinc-800 rounded px-2 py-1.5 text-sm"
            >
              {VISIBILITIES.map((v) => <option key={v} value={v}>{v}</option>)}
            </select>
          </label>

          {error && (
            <div className="text-xs text-rose-400 bg-rose-950/40 border border-rose-900 rounded px-2 py-1.5">
              {error}
            </div>
          )}

          {result && (
            <div className="text-xs text-emerald-300 bg-emerald-950/30 border border-emerald-900/60 rounded px-2 py-1.5 space-y-1">
              <div>Published as a real DTU</div>
              <div className="text-zinc-400 font-mono text-[10px] break-all">{result.dtuId}</div>
            </div>
          )}

          <div className="pt-2 flex items-center justify-end gap-2">
            <button
              type="button"
              onClick={onClose}
              className="px-3 py-1.5 text-xs text-zinc-400 hover:text-zinc-200"
            >
              Cancel
            </button>
            <button
              type="button"
              onClick={submit}
              disabled={!artworkId || submitting}
              className="px-4 py-1.5 text-xs bg-violet-600 hover:bg-violet-500 text-white rounded disabled:opacity-50 disabled:cursor-not-allowed"
            >
              {submitting ? 'Publishing…' : 'Publish'}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
