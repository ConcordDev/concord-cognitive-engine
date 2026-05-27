'use client';

/**
 * PublishAsTextureDialog — Concordia content-engine bridge UI.
 *
 * Lets the artist publish the current canvas as a tier-1 material
 * texture DTU for Concordia's procedural-buildings. The flow:
 *
 *   1. Pick materialKind (which of the 8 procedural slots),
 *      seed (which variant within the slot), channel (color / normal /
 *      roughness / ao).
 *   2. We render the canvas to image/png and POST it via
 *      art.publish-as-texture (server domain handler at
 *      server/domains/art.js).
 *   3. Server registers the asset in evo_assets with
 *      sourceId='material:<kind>:<seed>:<channel>'.
 *   4. Frontend pbr-loader tier-1 picks it up on the next material
 *      bind; procedural-buildings materials upgrade transparently.
 *
 * Royalty cascade, LLaVA validation, evo-asset refinement, and
 * marketplace canon voting happen automatically downstream — this
 * dialog is just the wire from the player's pen to the substrate.
 */

import { useCallback, useEffect, useState } from 'react';
import { lensRun } from '@/lib/api/client';

const KINDS = ['stone', 'wood', 'brick', 'cloth', 'metal', 'leather', 'thatch', 'dirt'] as const;
const CHANNELS = ['color', 'normal', 'roughness', 'ao'] as const;

type Kind = typeof KINDS[number];
type Channel = typeof CHANNELS[number];

interface CoverageSlot {
  assetId: string;
  qualityLevel: number;
  evolutionScore: number;
}

interface CoverageResult {
  materialKind: Kind;
  seed: number;
  channels: Record<Channel, CoverageSlot | null>;
}

interface PublishResult {
  assetId: string;
  created: boolean;
  sourceId: string;
  materialKind: Kind;
  seed: number;
  channel: Channel;
  sizeBytes: number;
  resolveUrl: string;
}

export interface PublishAsTextureDialogProps {
  /** The canvas to publish. Caller passes the ArtCanvas's HTMLCanvasElement. */
  canvas: HTMLCanvasElement | null;
  /** Optional artworkId for lineage attribution. */
  artworkId?: string;
  /** Close the dialog. */
  onClose: () => void;
}

export function PublishAsTextureDialog({ canvas, artworkId, onClose }: PublishAsTextureDialogProps) {
  const [kind, setKind] = useState<Kind>('wood');
  const [seed, setSeed] = useState<number>(1);
  const [channel, setChannel] = useState<Channel>('color');
  const [preview, setPreview] = useState<string | null>(null);
  const [coverage, setCoverage] = useState<CoverageResult | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [result, setResult] = useState<PublishResult | null>(null);
  const [error, setError] = useState<string | null>(null);

  // Render canvas → data URL preview whenever the canvas pointer changes
  useEffect(() => {
    if (!canvas) { setPreview(null); return; }
    try { setPreview(canvas.toDataURL('image/png')); }
    catch { setPreview(null); }
  }, [canvas]);

  // Fetch coverage for the current (kind, seed)
  const refreshCoverage = useCallback(async () => {
    try {
      const r = await lensRun('art', 'published-texture-coverage', { materialKind: kind, seed });
      const data = r.data?.result as CoverageResult | undefined;
      if (data) setCoverage(data);
    } catch {
      /* coverage is informational — failures are non-fatal */
    }
  }, [kind, seed]);

  useEffect(() => { refreshCoverage(); }, [refreshCoverage]);

  const submit = useCallback(async () => {
    if (!canvas) return;
    setError(null);
    setSubmitting(true);
    try {
      const imageDataUrl = canvas.toDataURL('image/png');
      const r = await lensRun('art', 'publish-as-texture', {
        materialKind: kind,
        seed,
        channel,
        imageDataUrl,
        artworkId,
      });
      if (r.data?.ok === false) {
        setError(r.data.error || 'publish failed');
      } else {
        setResult(r.data?.result as PublishResult);
        // Coverage will change now — refresh the slot indicator
        refreshCoverage();
      }
    } catch (e) {
      setError(String((e as Error)?.message || e));
    } finally {
      setSubmitting(false);
    }
  }, [canvas, kind, seed, channel, artworkId, refreshCoverage]);

  return (
    <div
      role="dialog"
      aria-label="Publish as Concordia material texture"
      className="fixed inset-0 z-50 bg-black/70 flex items-center justify-center p-4"
      onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}
    >
      <div className="bg-zinc-950 border border-zinc-800 rounded-lg w-full max-w-2xl p-5 text-zinc-200">
        <div className="flex items-baseline justify-between mb-4">
          <h2 className="text-sm font-semibold tracking-wide uppercase text-zinc-300">
            Publish as Concordia material
          </h2>
          <button type="button" onClick={onClose} className="text-zinc-500 hover:text-zinc-200 text-xs">close</button>
        </div>

        <div className="grid grid-cols-[180px_1fr] gap-4">
          {/* Preview thumbnail */}
          <div className="space-y-2">
            <div className="aspect-square bg-zinc-900 border border-zinc-800 rounded flex items-center justify-center overflow-hidden">
              {preview
                /* next/image doesn't fit data: URLs from canvas.toDataURL */
                /* eslint-disable-next-line @next/next/no-img-element */
                ? <img src={preview} alt="canvas preview" className="w-full h-full object-contain" />
                : <span className="text-zinc-600 text-xs">no canvas</span>}
            </div>
            <p className="text-[10px] leading-tight text-zinc-500">
              Goes to <span className="font-mono text-zinc-400">evo_assets</span> with
              {' '}<span className="font-mono text-violet-300">source=authored</span>.
              Royalty cascade + LLaVA validation kick in automatically.
            </p>
          </div>

          {/* Form */}
          <div className="space-y-3">
            <label className="block">
              <span className="block text-[10px] uppercase tracking-wider text-zinc-400 mb-1">Material kind</span>
              <select
                value={kind}
                onChange={(e) => setKind(e.target.value as Kind)}
                className="w-full bg-zinc-900 border border-zinc-800 rounded px-2 py-1.5 text-sm"
              >
                {KINDS.map((k) => <option key={k} value={k}>{k}</option>)}
              </select>
            </label>

            <label className="block">
              <span className="block text-[10px] uppercase tracking-wider text-zinc-400 mb-1">Seed (variant)</span>
              <input
                type="number"
                value={seed}
                min={1}
                max={0xffffffff}
                onChange={(e) => setSeed(Math.max(1, parseInt(e.target.value || '1', 10) || 1))}
                className="w-full bg-zinc-900 border border-zinc-800 rounded px-2 py-1.5 text-sm font-mono"
              />
            </label>

            <label className="block">
              <span className="block text-[10px] uppercase tracking-wider text-zinc-400 mb-1">PBR channel</span>
              <div className="grid grid-cols-4 gap-1">
                {CHANNELS.map((ch) => {
                  const slot = coverage?.channels[ch];
                  const isActive = channel === ch;
                  return (
                    <button
                      key={ch}
                      type="button"
                      onClick={() => setChannel(ch)}
                      className={
                        'rounded px-2 py-1.5 text-xs border ' +
                        (isActive
                          ? 'bg-violet-600/30 border-violet-400 text-violet-100'
                          : 'bg-zinc-900 border-zinc-800 text-zinc-300 hover:border-zinc-700')
                      }
                    >
                      <div>{ch}</div>
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
                Coverage for <span className="font-mono">{kind}:{seed}</span>:{' '}
                {(['color', 'normal', 'roughness', 'ao'] as const)
                  .filter((ch) => coverage.channels[ch])
                  .map((ch) => ch)
                  .join(', ') || <span className="text-zinc-600">no channels yet — be first</span>}
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
                  {result.created ? 'Registered' : 'Updated'} as
                  {' '}<span className="font-mono">{result.sourceId}</span>
                </div>
                <div className="text-zinc-400 font-mono text-[10px] break-all">{result.resolveUrl}</div>
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
                disabled={!canvas || submitting}
                className="px-4 py-1.5 text-xs bg-violet-600 hover:bg-violet-500 text-white rounded disabled:opacity-50 disabled:cursor-not-allowed"
              >
                {submitting ? 'Publishing…' : 'Publish'}
              </button>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
