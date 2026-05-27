'use client';

/**
 * PublishAsBlueprintDialog — Concordia content-engine bridge UI for
 * the whiteboard lens. Player picks an archetype (tavern/archive/forge/
 * market/tower) and publishes the current board as an interior layout
 * blueprint DTU. Flows through evo_assets and is consumed by
 * procedural-buildings.ts#attachInteriorDecor at runtime.
 */

import { useCallback, useEffect, useState } from 'react';
import { lensRun } from '@/lib/api/client';

const ARCHETYPES = ['tavern', 'archive', 'forge', 'market', 'tower'] as const;
type Archetype = typeof ARCHETYPES[number];

interface CoverageSlot {
  assetId: string;
  qualityLevel: number;
  evolutionScore: number;
}
interface CoverageResult {
  userId: string;
  archetypes: Record<Archetype, CoverageSlot | null>;
}
interface PublishResult {
  assetId: string;
  created: boolean;
  sourceId: string;
  archetype: Archetype;
  boardId: string;
  elementCount: number;
  previewIncluded: boolean;
  resolveUrl: string;
}

export interface PublishAsBlueprintDialogProps {
  /** The board the user is publishing. Comes from the workbench. */
  boardId: string;
  /** Optional preview SVG (data URL) — caller may pre-render. */
  svgDataUrl?: string | null;
  /** Close the dialog. */
  onClose: () => void;
}

export function PublishAsBlueprintDialog({ boardId, svgDataUrl, onClose }: PublishAsBlueprintDialogProps) {
  const [archetype, setArchetype] = useState<Archetype>('tavern');
  const [coverage, setCoverage] = useState<CoverageResult | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [result, setResult] = useState<PublishResult | null>(null);
  const [error, setError] = useState<string | null>(null);

  const refreshCoverage = useCallback(async () => {
    try {
      const r = await lensRun('whiteboard', 'published-blueprint-coverage', {});
      const data = (r.data?.result as CoverageResult | null) ?? null;
      if (data) setCoverage(data);
    } catch {
      /* coverage is informational */
    }
  }, []);

  useEffect(() => { refreshCoverage(); }, [refreshCoverage]);

  const submit = useCallback(async () => {
    if (!boardId) return;
    setError(null); setSubmitting(true);
    try {
      const params: Record<string, unknown> = { archetype, boardId };
      if (svgDataUrl) {
        params.snapshotFormat = 'svg-raster';
        params.svgDataUrl = svgDataUrl;
      } else {
        params.snapshotFormat = 'json-snap';
      }
      const r = await lensRun('whiteboard', 'publish-as-blueprint', params);
      if (r.data?.ok === false) {
        setError(r.data.error || 'publish failed');
      } else {
        setResult(r.data?.result as PublishResult);
        refreshCoverage();
      }
    } catch (e) {
      setError(String((e as Error)?.message || e));
    } finally {
      setSubmitting(false);
    }
  }, [archetype, boardId, svgDataUrl, refreshCoverage]);

  return (
    <div
      role="dialog"
      aria-label="Publish board as Concordia blueprint"
      className="fixed inset-0 z-50 bg-black/70 flex items-center justify-center p-4"
      onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}
    >
      <div className="bg-zinc-950 border border-zinc-800 rounded-lg w-full max-w-xl p-5 text-zinc-200">
        <div className="flex items-baseline justify-between mb-4">
          <h2 className="text-sm font-semibold tracking-wide uppercase text-zinc-300">
            Publish as building blueprint
          </h2>
          <button type="button" onClick={onClose} className="text-zinc-500 hover:text-zinc-200 text-xs">close</button>
        </div>

        <div className="space-y-3">
          <p className="text-[11px] leading-tight text-zinc-500">
            Your board becomes the interior decor for one of the 5 building archetypes.
            Marketplace canon picks winners by evolution score; multiple blueprints can
            coexist per archetype.
          </p>

          <label className="block">
            <span className="block text-[10px] uppercase tracking-wider text-zinc-400 mb-1">Building archetype</span>
            <div className="grid grid-cols-5 gap-1">
              {ARCHETYPES.map((a) => {
                const slot = coverage?.archetypes[a];
                const isActive = archetype === a;
                return (
                  <button
                    key={a}
                    type="button"
                    onClick={() => setArchetype(a)}
                    className={
                      'rounded px-2 py-2 text-xs border ' +
                      (isActive
                        ? 'bg-violet-600/30 border-violet-400 text-violet-100'
                        : 'bg-zinc-900 border-zinc-800 text-zinc-300 hover:border-zinc-700')
                    }
                  >
                    <div>{a}</div>
                    <div className="text-[9px] mt-0.5 text-zinc-500">
                      {slot ? `q${slot.qualityLevel}` : '—'}
                    </div>
                  </button>
                );
              })}
            </div>
          </label>

          {coverage && (
            <div className="text-[11px] text-zinc-400">
              You&rsquo;ve published{' '}
              {ARCHETYPES.filter((a) => coverage.archetypes[a]).length} / {ARCHETYPES.length}{' '}
              archetypes.
            </div>
          )}

          {error && (
            <div className="text-xs text-rose-400 bg-rose-950/40 border border-rose-900 rounded px-2 py-1.5">
              {error}
            </div>
          )}

          {result && (
            <div className="text-xs text-emerald-300 bg-emerald-950/30 border border-emerald-900/60 rounded px-2 py-1.5 space-y-1">
              <div>
                {result.created ? 'Registered' : 'Updated'} as{' '}
                <span className="font-mono">{result.sourceId}</span>
              </div>
              <div className="text-zinc-400 font-mono text-[10px] break-all">
                {result.elementCount} element(s) → {result.resolveUrl}
              </div>
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
              disabled={!boardId || submitting}
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
