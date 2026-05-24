'use client';

import { useCallback, useEffect, useState } from 'react';
import { Magnet, Loader2, CheckCircle2 } from 'lucide-react';
import { lensRun } from '@/lib/api/client';

interface Groove { id: string; name: string; swing: number; velAccent: number }
interface ResultMsg { ok: boolean; text: string }

const GRID_OPTIONS = [
  { label: '1/4', value: 1 },
  { label: '1/8', value: 0.5 },
  { label: '1/8T', value: 1 / 3 },
  { label: '1/16', value: 0.25 },
  { label: '1/16T', value: 1 / 6 },
  { label: '1/32', value: 0.125 },
];

export function QuantizePanel({ clipId }: { clipId?: string }) {
  const [grooves, setGrooves] = useState<Groove[]>([]);
  const [loading, setLoading] = useState(true);
  const [grid, setGrid] = useState(0.25);
  const [strength, setStrength] = useState(1);
  const [swing, setSwing] = useState(0);
  const [quantizeLength, setQuantizeLength] = useState(false);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<ResultMsg | null>(null);

  const refresh = useCallback(async () => {
    setLoading(true);
    try {
      const res = await lensRun('studio', 'groove-list', {});
      setGrooves((res.data?.result?.grooves || []) as Groove[]);
    } catch (e) { console.error('[Quantize] grooves', e); }
    finally { setLoading(false); }
  }, []);

  useEffect(() => { void refresh(); }, [refresh]);

  async function doQuantize() {
    if (!clipId) return;
    setBusy(true); setMsg(null);
    try {
      const res = await lensRun('studio', 'midi-quantize', { clipId, gridBeats: grid, strength, swing, quantizeLength });
      const r = res.data?.result as { quantized?: number; moved?: number } | undefined;
      if (res.data?.ok && r) setMsg({ ok: true, text: `Quantized ${r.quantized} notes — ${r.moved} moved.` });
      else setMsg({ ok: false, text: res.data?.error || 'Quantize failed.' });
    } catch (e) { console.error('[Quantize] run', e); setMsg({ ok: false, text: 'Quantize failed.' }); }
    finally { setBusy(false); }
  }

  async function applyGroove(g: Groove) {
    if (!clipId) return;
    setBusy(true); setMsg(null);
    try {
      const res = await lensRun('studio', 'groove-apply', { clipId, gridBeats: grid, swing: g.swing, velAccent: g.velAccent });
      const r = res.data?.result as { grooved?: number } | undefined;
      if (res.data?.ok && r) setMsg({ ok: true, text: `Applied "${g.name}" to ${r.grooved} notes.` });
      else setMsg({ ok: false, text: res.data?.error || 'Groove failed.' });
    } catch (e) { console.error('[Quantize] groove', e); setMsg({ ok: false, text: 'Groove failed.' }); }
    finally { setBusy(false); }
  }

  return (
    <div className="bg-[#0d1117] border border-violet-500/20 rounded-lg overflow-hidden">
      <header className="px-4 py-2 border-b border-white/10 flex items-center gap-2">
        <Magnet className="w-4 h-4 text-violet-400" />
        <span className="text-xs uppercase font-semibold text-gray-300 tracking-wider">Quantize & groove</span>
      </header>
      {!clipId ? (
        <div className="px-3 py-10 text-center text-xs text-gray-400">Paste a Clip ID above to quantize its MIDI notes.</div>
      ) : (
        <div className="p-3 space-y-3">
          <div>
            <div className="text-[10px] uppercase text-violet-300 font-semibold mb-1">Grid</div>
            <div className="flex flex-wrap gap-1">
              {GRID_OPTIONS.map((g) => (
                <button key={g.label} onClick={() => setGrid(g.value)}
                  className={'px-2 py-1 text-[10px] rounded border ' + (Math.abs(grid - g.value) < 1e-6 ? 'bg-violet-500/20 border-violet-500/40 text-violet-200' : 'border-white/10 text-gray-400 hover:text-white')}>
                  {g.label}
                </button>
              ))}
            </div>
          </div>
          <label className="block text-[10px] text-gray-400">Strength {Math.round(strength * 100)}%
            <input type="range" min="0" max="1" step="0.05" value={strength} onChange={(e) => setStrength(Number(e.target.value))} className="block w-full accent-violet-500" />
          </label>
          <label className="block text-[10px] text-gray-400">Swing {Math.round(swing * 100)}%
            <input type="range" min="0" max="0.75" step="0.01" value={swing} onChange={(e) => setSwing(Number(e.target.value))} className="block w-full accent-violet-500" />
          </label>
          <label className="flex items-center gap-2 text-[11px] text-gray-300">
            <input type="checkbox" checked={quantizeLength} onChange={(e) => setQuantizeLength(e.target.checked)} className="accent-violet-500" />
            Also quantize note lengths
          </label>
          <button onClick={doQuantize} disabled={busy} className="w-full px-3 py-1.5 text-xs rounded bg-violet-500 disabled:opacity-40 text-white font-bold inline-flex items-center justify-center gap-1">
            {busy ? <Loader2 className="w-3 h-3 animate-spin" /> : <Magnet className="w-3 h-3" />}Quantize notes
          </button>

          <div className="pt-2 border-t border-white/10">
            <div className="text-[10px] uppercase text-violet-300 font-semibold mb-1">Groove templates</div>
            {loading ? (
              <div className="flex items-center text-xs text-gray-400"><Loader2 className="w-4 h-4 animate-spin mr-2" /> Loading…</div>
            ) : (
              <div className="grid grid-cols-2 gap-1.5">
                {grooves.map((g) => (
                  <button key={g.id} onClick={() => applyGroove(g)} disabled={busy}
                    className="px-2 py-1.5 text-[10px] rounded border border-white/10 text-gray-300 hover:bg-white/[0.06] text-left disabled:opacity-40">
                    <div className="text-white">{g.name}</div>
                    <div className="text-[9px] text-gray-400">swing {Math.round(g.swing * 100)}% · accent {g.velAccent}</div>
                  </button>
                ))}
              </div>
            )}
          </div>

          {msg && (
            <div className={'text-[11px] flex items-center gap-1 ' + (msg.ok ? 'text-emerald-400' : 'text-rose-400')}>
              {msg.ok && <CheckCircle2 className="w-3 h-3" />}{msg.text}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

export default QuantizePanel;
