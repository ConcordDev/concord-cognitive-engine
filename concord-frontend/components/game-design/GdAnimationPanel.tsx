'use client';

/**
 * GdAnimationPanel — sprite/entity animation timeline. An animation is a
 * named clip on a game: an ordered list of keyframes, each referencing a
 * sprite-sheet frame index with a per-frame duration. Live playback
 * steps the timeline against an imported sprite-sheet asset.
 */

import { useCallback, useEffect, useRef, useState } from 'react';
import { Loader2, Plus, Trash2, Play, Pause, Film, ChevronLeft, ChevronRight } from 'lucide-react';
import { lensRun } from '@/lib/api/client';
import { cn } from '@/lib/utils';

interface Frame { id: string; frameIndex: number; durationMs: number }
interface Animation {
  id: string; name: string; entityId: string | null; assetId: string | null;
  loop: boolean; fps: number; frames: Frame[];
}
interface AssetLite { id: string; name: string; kind: string; src: string; width: number; height: number; frameW: number; frameH: number }
interface EntityLite { id: string; name: string; kind: string }

export function GdAnimationPanel({ gameId, onChange }: { gameId: string; onChange: () => void }) {
  const [anims, setAnims] = useState<Animation[]>([]);
  const [assets, setAssets] = useState<AssetLite[]>([]);
  const [entities, setEntities] = useState<EntityLite[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [form, setForm] = useState({ name: '', fps: '12', assetId: '', entityId: '' });
  const [selected, setSelected] = useState<string | null>(null);
  const [playing, setPlaying] = useState(false);
  const [playFrame, setPlayFrame] = useState(0);
  const tickRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const refresh = useCallback(async () => {
    setLoading(true);
    const [a, as, g] = await Promise.all([
      lensRun('game-design', 'animation-list', { gameId }),
      lensRun('game-design', 'asset-list', { gameId }),
      lensRun('game-design', 'game-get', { id: gameId }),
    ]);
    setAnims(a.data?.result?.animations || []);
    setAssets((as.data?.result?.assets || []).filter((x: AssetLite) => x.kind === 'sprite' || x.kind === 'tileset'));
    setEntities(g.data?.result?.entities || []);
    setLoading(false);
    onChange();
  }, [gameId, onChange]);

  useEffect(() => { void refresh(); }, [refresh]);

  const active = anims.find((a) => a.id === selected) || null;
  const activeAsset = active?.assetId ? assets.find((x) => x.id === active.assetId) || null : null;

  // Playback loop driven by per-frame duration.
  useEffect(() => {
    if (tickRef.current) { clearTimeout(tickRef.current); tickRef.current = null; }
    if (!playing || !active || active.frames.length === 0) return;
    const idx = playFrame % active.frames.length;
    const dur = active.frames[idx]?.durationMs || 80;
    tickRef.current = setTimeout(() => {
      setPlayFrame((p) => {
        const next = p + 1;
        if (next >= active.frames.length && !active.loop) { setPlaying(false); return p; }
        return next % active.frames.length;
      });
    }, dur);
    return () => { if (tickRef.current) clearTimeout(tickRef.current); };
  }, [playing, playFrame, active]);

  useEffect(() => { setPlayFrame(0); setPlaying(false); }, [selected]);

  const createAnim = async () => {
    if (!form.name.trim()) { setError('Animation name is required.'); return; }
    const r = await lensRun('game-design', 'animation-create', {
      gameId, name: form.name.trim(), fps: Number(form.fps) || 12,
      assetId: form.assetId || null, entityId: form.entityId || null,
    });
    if (r.data?.ok === false) { setError(r.data?.error || 'Failed'); return; }
    setForm({ name: '', fps: '12', assetId: '', entityId: '' });
    setError(null);
    await refresh();
    setSelected(r.data?.result?.animation?.id || null);
  };

  const delAnim = async (id: string) => {
    await lensRun('game-design', 'animation-delete', { id });
    if (selected === id) setSelected(null);
    await refresh();
  };

  const patchAnim = async (id: string, patch: Record<string, unknown>) => {
    await lensRun('game-design', 'animation-update', { id, ...patch });
    await refresh();
  };

  const addFrame = async () => {
    if (!active) return;
    const last = active.frames[active.frames.length - 1];
    await lensRun('game-design', 'animation-frame-add', {
      animationId: active.id, frameIndex: last ? last.frameIndex + 1 : 0,
      durationMs: Math.round(1000 / active.fps),
    });
    await refresh();
  };

  const delFrame = async (frameId: string) => {
    if (!active) return;
    await lensRun('game-design', 'animation-frame-delete', { animationId: active.id, frameId });
    await refresh();
  };

  const patchFrame = async (frameId: string, patch: Record<string, unknown>) => {
    if (!active) return;
    await lensRun('game-design', 'animation-frame-update', { animationId: active.id, frameId, ...patch });
    await refresh();
  };

  const moveFrame = async (frameId: string, dir: -1 | 1) => {
    if (!active) return;
    const ids = active.frames.map((f) => f.id);
    const i = ids.indexOf(frameId);
    const j = i + dir;
    if (j < 0 || j >= ids.length) return;
    [ids[i], ids[j]] = [ids[j], ids[i]];
    await lensRun('game-design', 'animation-frame-reorder', { animationId: active.id, order: ids });
    await refresh();
  };

  // Compute sprite-sheet cell geometry for a given frame index.
  const cellStyle = (asset: AssetLite, frameIndex: number): React.CSSProperties => {
    if (!asset.frameW || !asset.frameH || !asset.width) return {};
    const cols = Math.max(1, Math.floor(asset.width / asset.frameW));
    const col = frameIndex % cols;
    const row = Math.floor(frameIndex / cols);
    return {
      width: asset.frameW, height: asset.frameH,
      backgroundImage: `url(${asset.src})`,
      backgroundPosition: `-${col * asset.frameW}px -${row * asset.frameH}px`,
      backgroundRepeat: 'no-repeat',
      imageRendering: 'pixelated',
    };
  };

  if (loading) {
    return <div className="flex items-center justify-center py-10 text-zinc-400"><Loader2 className="w-5 h-5 animate-spin" /></div>;
  }

  return (
    <div className="space-y-4">
      {error && <div className="text-xs text-rose-400 bg-rose-950/40 border border-rose-900/50 rounded-lg px-3 py-2">{error}</div>}

      <section className="bg-zinc-900/70 border border-zinc-800 rounded-xl p-3 grid grid-cols-2 sm:grid-cols-5 gap-2">
        <input placeholder="Animation name" value={form.name}
          onChange={(e) => setForm({ ...form, name: e.target.value })}
          className="bg-zinc-950 border border-zinc-700 rounded-lg px-2 py-1.5 text-xs text-zinc-100" />
        <input placeholder="fps" inputMode="numeric" value={form.fps}
          onChange={(e) => setForm({ ...form, fps: e.target.value })}
          className="bg-zinc-950 border border-zinc-700 rounded-lg px-2 py-1.5 text-xs text-zinc-100" />
        <select value={form.assetId} onChange={(e) => setForm({ ...form, assetId: e.target.value })}
          className="bg-zinc-950 border border-zinc-700 rounded-lg px-2 py-1.5 text-xs text-zinc-100">
          <option value="">No sheet</option>
          {assets.map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}
        </select>
        <select value={form.entityId} onChange={(e) => setForm({ ...form, entityId: e.target.value })}
          className="bg-zinc-950 border border-zinc-700 rounded-lg px-2 py-1.5 text-xs text-zinc-100">
          <option value="">No entity</option>
          {entities.map((e) => <option key={e.id} value={e.id}>{e.name}</option>)}
        </select>
        <button type="button" onClick={createAnim}
          className="flex items-center justify-center gap-1 bg-lime-600 hover:bg-lime-500 text-white text-xs font-medium rounded-lg">
          <Plus className="w-3.5 h-3.5" /> Clip
        </button>
      </section>

      {anims.length === 0 ? (
        <p className="text-[11px] text-zinc-400 italic py-6 text-center">No animation clips yet.</p>
      ) : (
        <div className="flex flex-wrap gap-1.5">
          {anims.map((a) => (
            <span key={a.id} className={cn('flex items-center gap-1.5 text-[11px] pl-2.5 pr-1.5 py-1 rounded-lg',
              selected === a.id ? 'bg-lime-600 text-white' : 'bg-zinc-800 text-zinc-300')}>
              <button type="button" onClick={() => setSelected(a.id)} className="flex items-center gap-1">
                <Film className="w-3 h-3" /> {a.name} <span className="opacity-60">({a.frames.length}f)</span>
              </button>
              <button type="button" onClick={() => delAnim(a.id)} className="text-zinc-300/70 hover:text-rose-200">×</button>
            </span>
          ))}
        </div>
      )}

      {active && (
        <section className="bg-zinc-900/70 border border-zinc-800 rounded-xl p-3 space-y-3">
          <div className="flex items-center gap-3">
            {/* Preview */}
            <div className="w-24 h-24 shrink-0 rounded-lg bg-zinc-950 border border-zinc-800 flex items-center justify-center overflow-hidden">
              {activeAsset && activeAsset.frameW > 0 && active.frames.length > 0 ? (
                <div style={cellStyle(activeAsset, active.frames[playFrame % active.frames.length]?.frameIndex ?? 0)} />
              ) : (
                <span className="text-2xl font-bold text-lime-400">
                  {active.frames.length > 0 ? active.frames[playFrame % active.frames.length]?.frameIndex : '—'}
                </span>
              )}
            </div>
            <div className="flex-1 space-y-1.5">
              <div className="flex items-center gap-2">
                <button type="button" onClick={() => setPlaying((p) => !p)} disabled={active.frames.length === 0}
                  className="flex items-center gap-1 px-3 py-1.5 text-xs bg-zinc-800 hover:bg-zinc-700 text-zinc-200 rounded-lg disabled:opacity-40">
                  {playing ? <Pause className="w-3.5 h-3.5" /> : <Play className="w-3.5 h-3.5" />}
                  {playing ? 'Pause' : 'Play'}
                </button>
                <label className="flex items-center gap-1 text-[11px] text-zinc-400">
                  <input type="checkbox" checked={active.loop}
                    onChange={(e) => patchAnim(active.id, { loop: e.target.checked })} /> loop
                </label>
                <label className="flex items-center gap-1 text-[11px] text-zinc-400">
                  fps
                  <input type="number" min={1} max={60} value={active.fps}
                    onChange={(e) => patchAnim(active.id, { fps: Number(e.target.value) || 12 })}
                    className="w-14 bg-zinc-950 border border-zinc-700 rounded px-1.5 py-0.5 text-[11px] text-zinc-100" />
                </label>
              </div>
              <p className="text-[10px] text-zinc-400">
                {active.frames.length} frames · total {active.frames.reduce((s, f) => s + f.durationMs, 0)}ms
                {!activeAsset && ' · attach a sprite sheet asset to preview pixels'}
              </p>
            </div>
          </div>

          <button type="button" onClick={addFrame}
            className="flex items-center gap-1 px-3 py-1.5 text-xs bg-lime-600 hover:bg-lime-500 text-white rounded-lg">
            <Plus className="w-3.5 h-3.5" /> Keyframe
          </button>

          {active.frames.length === 0 ? (
            <p className="text-[11px] text-zinc-400 italic py-3 text-center">No keyframes — add one to start the timeline.</p>
          ) : (
            <ol className="flex flex-wrap gap-1.5">
              {active.frames.map((f, i) => (
                <li key={f.id}
                  className={cn('flex flex-col items-center gap-1 p-1.5 rounded-lg border',
                    playing && i === playFrame % active.frames.length ? 'border-lime-500 bg-lime-950/30' : 'border-zinc-800 bg-zinc-950/60')}>
                  <div className="w-12 h-12 rounded bg-zinc-900 border border-zinc-800 flex items-center justify-center overflow-hidden">
                    {activeAsset && activeAsset.frameW > 0 ? (
                      <div style={{ ...cellStyle(activeAsset, f.frameIndex), transform: `scale(${Math.min(1, 48 / Math.max(1, activeAsset.frameW))})` }} />
                    ) : (
                      <span className="text-sm text-zinc-300">{f.frameIndex}</span>
                    )}
                  </div>
                  <input type="number" min={0} value={f.frameIndex}
                    onChange={(e) => patchFrame(f.id, { frameIndex: Number(e.target.value) || 0 })}
                    className="w-12 bg-zinc-950 border border-zinc-700 rounded px-1 py-0.5 text-[10px] text-zinc-100 text-center" />
                  <input type="number" min={16} step={16} value={f.durationMs}
                    onChange={(e) => patchFrame(f.id, { durationMs: Number(e.target.value) || 80 })}
                    className="w-12 bg-zinc-950 border border-zinc-700 rounded px-1 py-0.5 text-[10px] text-zinc-100 text-center" />
                  <div className="flex items-center gap-0.5">
                    <button aria-label="Previous" type="button" onClick={() => moveFrame(f.id, -1)} className="text-zinc-600 hover:text-zinc-200">
                      <ChevronLeft className="w-3 h-3" />
                    </button>
                    <button aria-label="Delete" type="button" onClick={() => delFrame(f.id)} className="text-zinc-600 hover:text-rose-400">
                      <Trash2 className="w-3 h-3" />
                    </button>
                    <button aria-label="Next" type="button" onClick={() => moveFrame(f.id, 1)} className="text-zinc-600 hover:text-zinc-200">
                      <ChevronRight className="w-3 h-3" />
                    </button>
                  </div>
                </li>
              ))}
            </ol>
          )}
        </section>
      )}
    </div>
  );
}
