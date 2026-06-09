'use client';

import { useCallback, useEffect, useState } from 'react';
import { AudioWaveform, Scissors, Loader2, Plus, Trash2 } from 'lucide-react';
import { lensRun } from '@/lib/api/client';

interface WarpMarker { beat: number; sampleSec: number }
interface Clip {
  id: string;
  projectId: string;
  trackId: string;
  name: string;
  kind: string;
  startBeats: number;
  lengthBeats: number;
  warpEnabled: boolean;
  warpMarkers: WarpMarker[];
  warpMode?: string;
  fadeInBeats?: number;
  fadeOutBeats?: number;
  fadeInCurve?: string;
  fadeOutCurve?: string;
  gainDb?: number;
}

const WARP_MODES = ['beats', 'tones', 'texture', 'repitch', 'complex'];
const FADE_CURVES = ['linear', 'exp', 'log', 'scurve'];

export function ClipEditorPanel({ projectId, trackId }: { projectId?: string; trackId?: string }) {
  const [clips, setClips] = useState<Clip[]>([]);
  const [loading, setLoading] = useState(true);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [warpBeat, setWarpBeat] = useState('0');
  const [warpSec, setWarpSec] = useState('0');
  const [sliceAt, setSliceAt] = useState('');
  const [busy, setBusy] = useState(false);

  const refresh = useCallback(async () => {
    if (!projectId) { setClips([]); setLoading(false); return; }
    setLoading(true);
    try {
      const res = await lensRun('studio', 'clips-list', { projectId, trackId });
      const list = (res.data?.result?.clips || []) as Clip[];
      setClips(list);
      setSelectedId((prev) => (prev && list.some((c) => c.id === prev) ? prev : list[0]?.id ?? null));
    } catch (e) { console.error('[ClipEditor] list', e); }
    finally { setLoading(false); }
  }, [projectId, trackId]);

  useEffect(() => { void refresh(); }, [refresh]);

  const selected = clips.find((c) => c.id === selectedId) || null;

  async function addWarpMarker() {
    if (!selected) return;
    setBusy(true);
    try {
      const next = [...(selected.warpMarkers || []), { beat: Number(warpBeat), sampleSec: Number(warpSec) }];
      await lensRun('studio', 'clip-warp-set', { clipId: selected.id, warpMarkers: next, warpEnabled: true });
      setWarpBeat('0'); setWarpSec('0');
      await refresh();
    } catch (e) { console.error('[ClipEditor] warp', e); }
    finally { setBusy(false); }
  }

  async function removeWarpMarker(idx: number) {
    if (!selected) return;
    setBusy(true);
    try {
      const next = (selected.warpMarkers || []).filter((_, i) => i !== idx);
      await lensRun('studio', 'clip-warp-set', { clipId: selected.id, warpMarkers: next });
      await refresh();
    } catch (e) { console.error('[ClipEditor] warp rm', e); }
    finally { setBusy(false); }
  }

  async function setWarpMode(mode: string) {
    if (!selected) return;
    setBusy(true);
    try {
      await lensRun('studio', 'clip-warp-set', {
        clipId: selected.id,
        warpMarkers: selected.warpMarkers || [],
        warpMode: mode,
      });
      await refresh();
    } catch (e) { console.error('[ClipEditor] warpMode', e); }
    finally { setBusy(false); }
  }

  async function doSlice() {
    if (!selected || !sliceAt) return;
    setBusy(true);
    try {
      const res = await lensRun('studio', 'clip-slice', { clipId: selected.id, atBeats: Number(sliceAt) });
      if (res.data?.ok) { setSliceAt(''); await refresh(); }
    } catch (e) { console.error('[ClipEditor] slice', e); }
    finally { setBusy(false); }
  }

  async function setFade(patch: Record<string, unknown>) {
    if (!selected) return;
    setBusy(true);
    try {
      await lensRun('studio', 'clip-fade-set', { clipId: selected.id, ...patch });
      await refresh();
    } catch (e) { console.error('[ClipEditor] fade', e); }
    finally { setBusy(false); }
  }

  return (
    <div className="bg-[#0d1117] border border-violet-500/20 rounded-lg overflow-hidden">
      <header className="px-4 py-2 border-b border-white/10 flex items-center gap-2">
        <AudioWaveform className="w-4 h-4 text-violet-400" />
        <span className="text-xs uppercase font-semibold text-gray-300 tracking-wider">Clip editor — warp · slice · fades</span>
      </header>
      {loading ? (
        <div className="flex items-center justify-center py-8 text-xs text-gray-400"><Loader2 className="w-4 h-4 animate-spin mr-2" /> Loading…</div>
      ) : !projectId ? (
        <div className="px-3 py-10 text-center text-xs text-gray-400">Open a project to edit clips.</div>
      ) : clips.length === 0 ? (
        <div className="px-3 py-10 text-center text-xs text-gray-400">No clips yet. Create a clip on the Clips tab first.</div>
      ) : (
        <div className="grid md:grid-cols-[200px_1fr]">
          <ul className="border-r border-white/10 max-h-96 overflow-y-auto">
            {clips.map((c) => (
              <li key={c.id}>
                <button
                  onClick={() => setSelectedId(c.id)}
                  className={'w-full text-left px-3 py-2 text-xs ' + (selectedId === c.id ? 'bg-violet-500/15 text-violet-200' : 'text-gray-400 hover:bg-white/[0.03]')}
                >
                  <div className="font-medium text-white truncate">{c.name}</div>
                  <div className="text-[10px] text-gray-400">{c.kind} · {c.lengthBeats} beats</div>
                </button>
              </li>
            ))}
          </ul>
          {selected ? (
            <div className="p-3 space-y-4">
              <section>
                <div className="text-[10px] uppercase text-violet-300 font-semibold mb-1">Warp mode</div>
                <div className="flex flex-wrap gap-1">
                  {WARP_MODES.map((m) => (
                    <button key={m} disabled={busy} onClick={() => setWarpMode(m)}
                      className={'px-2 py-1 text-[10px] rounded border ' + ((selected.warpMode || 'beats') === m ? 'bg-violet-500/20 border-violet-500/40 text-violet-200' : 'border-white/10 text-gray-400 hover:text-white')}>
                      {m}
                    </button>
                  ))}
                </div>
                <div className="mt-2 flex items-end gap-2">
                  <label className="text-[10px] text-gray-400">Beat<input type="number" step="0.25" value={warpBeat} onChange={(e) => setWarpBeat(e.target.value)} className="block w-20 px-2 py-1 mt-0.5 text-xs bg-lattice-deep border border-lattice-border rounded text-white" /></label>
                  <label className="text-[10px] text-gray-400">Sample sec<input type="number" step="0.01" value={warpSec} onChange={(e) => setWarpSec(e.target.value)} className="block w-24 px-2 py-1 mt-0.5 text-xs bg-lattice-deep border border-lattice-border rounded text-white" /></label>
                  <button disabled={busy} onClick={addWarpMarker} className="px-2 py-1 text-[10px] rounded bg-violet-500 text-white inline-flex items-center gap-1"><Plus className="w-3 h-3" />Marker</button>
                </div>
                {(selected.warpMarkers || []).length > 0 ? (
                  <ul className="mt-2 space-y-1">
                    {selected.warpMarkers.map((m, i) => (
                      <li key={i} className="flex items-center gap-2 text-[11px] text-gray-300">
                        <span className="font-mono">beat {m.beat} → {m.sampleSec}s</span>
                        <button aria-label="Delete" onClick={() => removeWarpMarker(i)} className="ml-auto text-rose-400"><Trash2 className="w-3 h-3" /></button>
                      </li>
                    ))}
                  </ul>
                ) : <div className="mt-2 text-[10px] text-gray-400">No warp markers — add 2+ to enable warping.</div>}
              </section>

              <section>
                <div className="text-[10px] uppercase text-violet-300 font-semibold mb-1">Slice</div>
                <div className="flex items-end gap-2">
                  <label className="text-[10px] text-gray-400">At beat<input type="number" step="0.25" value={sliceAt} onChange={(e) => setSliceAt(e.target.value)} placeholder={`${selected.startBeats}–${selected.startBeats + selected.lengthBeats}`} className="block w-28 px-2 py-1 mt-0.5 text-xs bg-lattice-deep border border-lattice-border rounded text-white" /></label>
                  <button disabled={busy || !sliceAt} onClick={doSlice} className="px-2 py-1 text-[10px] rounded bg-amber-500 text-black font-semibold inline-flex items-center gap-1"><Scissors className="w-3 h-3" />Slice clip</button>
                </div>
              </section>

              <section className="grid grid-cols-2 gap-3">
                <div>
                  <div className="text-[10px] uppercase text-violet-300 font-semibold mb-1">Fade in</div>
                  <input type="number" step="0.25" min="0" defaultValue={selected.fadeInBeats ?? 0}
                    onBlur={(e) => setFade({ fadeInBeats: Number(e.target.value) })}
                    className="w-full px-2 py-1 text-xs bg-lattice-deep border border-lattice-border rounded text-white" />
                  <select defaultValue={selected.fadeInCurve || 'linear'} onChange={(e) => setFade({ fadeInCurve: e.target.value })}
                    className="mt-1 w-full px-2 py-1 text-[10px] bg-lattice-deep border border-lattice-border rounded text-white">
                    {FADE_CURVES.map((c) => <option key={c} value={c}>{c}</option>)}
                  </select>
                </div>
                <div>
                  <div className="text-[10px] uppercase text-violet-300 font-semibold mb-1">Fade out</div>
                  <input type="number" step="0.25" min="0" defaultValue={selected.fadeOutBeats ?? 0}
                    onBlur={(e) => setFade({ fadeOutBeats: Number(e.target.value) })}
                    className="w-full px-2 py-1 text-xs bg-lattice-deep border border-lattice-border rounded text-white" />
                  <select defaultValue={selected.fadeOutCurve || 'linear'} onChange={(e) => setFade({ fadeOutCurve: e.target.value })}
                    className="mt-1 w-full px-2 py-1 text-[10px] bg-lattice-deep border border-lattice-border rounded text-white">
                    {FADE_CURVES.map((c) => <option key={c} value={c}>{c}</option>)}
                  </select>
                </div>
                <div className="col-span-2">
                  <div className="text-[10px] uppercase text-violet-300 font-semibold mb-1">Clip gain (dB)</div>
                  <input type="range" min="-60" max="12" step="0.5" defaultValue={selected.gainDb ?? 0}
                    onMouseUp={(e) => setFade({ gainDb: Number((e.target as HTMLInputElement).value) })}
                    onTouchEnd={(e) => setFade({ gainDb: Number((e.target as HTMLInputElement).value) })}
                    className="w-full accent-violet-500" />
                  <div className="text-[10px] text-gray-400">{selected.gainDb ?? 0} dB</div>
                </div>
              </section>
            </div>
          ) : null}
        </div>
      )}
    </div>
  );
}

export default ClipEditorPanel;
