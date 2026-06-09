'use client';

import { useCallback, useEffect, useState } from 'react';
import { SlidersHorizontal, Loader2, Plus, Trash2, X } from 'lucide-react';
import { lensRun } from '@/lib/api/client';

type FxType = 'eq' | 'compressor' | 'reverb' | 'delay';
interface FxUnit { id: string; type: FxType; bypassed: boolean; params: Record<string, number | boolean | string> }
interface FxRack { id: string; name: string; units: FxUnit[] }
type ParamRange = [number, number];
type FxSchema = Record<string, Record<string, ParamRange | string>>;

// Sensible defaults per effect type — used when adding a fresh unit.
const UNIT_DEFAULTS: Record<FxType, Record<string, number | boolean | string>> = {
  eq: { lowGainDb: 0, midGainDb: 0, highGainDb: 0, lowFreqHz: 250, highFreqHz: 4000 },
  compressor: { thresholdDb: -18, ratio: 4, attackMs: 10, releaseMs: 120, kneeDb: 6, makeupDb: 0 },
  reverb: { decaySec: 2, preDelayMs: 20, dampingHz: 6000, mix: 0.3, roomSize: 0.5 },
  delay: { timeMs: 300, feedback: 0.35, mix: 0.3 },
};

export function FxRackPanel() {
  const [racks, setRacks] = useState<FxRack[]>([]);
  const [schema, setSchema] = useState<FxSchema>({});
  const [loading, setLoading] = useState(true);
  const [name, setName] = useState('');
  const [draft, setDraft] = useState<FxUnit[]>([]);

  const refresh = useCallback(async () => {
    setLoading(true);
    try {
      const res = await lensRun('studio', 'fx-rack-list', {});
      setRacks((res.data?.result?.racks || []) as FxRack[]);
      setSchema((res.data?.result?.schema || {}) as FxSchema);
    } catch (e) { console.error('[FxRack] list', e); }
    finally { setLoading(false); }
  }, []);

  useEffect(() => { void refresh(); }, [refresh]);

  function addDraftUnit(type: FxType) {
    setDraft((prev) => [...prev, { id: `draft_${Date.now()}_${prev.length}`, type, bypassed: false, params: { ...UNIT_DEFAULTS[type] } }]);
  }

  function updateDraftParam(unitId: string, key: string, value: number) {
    setDraft((prev) => prev.map((u) => (u.id === unitId ? { ...u, params: { ...u.params, [key]: value } } : u)));
  }

  async function saveRack() {
    if (!name.trim() || draft.length === 0) return;
    try {
      await lensRun('studio', 'fx-rack-save', {
        name,
        units: draft.map((u) => ({ type: u.type, bypassed: u.bypassed, params: u.params })),
      });
      setName(''); setDraft([]);
      await refresh();
    } catch (e) { console.error('[FxRack] save', e); }
  }

  async function deleteRack(id: string) {
    try {
      await lensRun('studio', 'fx-rack-delete', { id });
      await refresh();
    } catch (e) { console.error('[FxRack] delete', e); }
  }

  return (
    <div className="bg-[#0d1117] border border-violet-500/20 rounded-lg overflow-hidden">
      <header className="px-4 py-2 border-b border-white/10 flex items-center gap-2">
        <SlidersHorizontal className="w-4 h-4 text-violet-400" />
        <span className="text-xs uppercase font-semibold text-gray-300 tracking-wider">FX racks — EQ · compressor · reverb · delay</span>
        <span className="ml-auto text-[10px] text-gray-400">{racks.length}</span>
      </header>

      <div className="p-3 border-b border-white/10 space-y-2">
        <div className="flex gap-2">
          <input value={name} onChange={(e) => setName(e.target.value)} placeholder="New rack name" className="flex-1 px-2 py-1.5 text-xs bg-lattice-deep border border-lattice-border rounded text-white" />
          <button onClick={saveRack} disabled={!name.trim() || draft.length === 0} className="px-3 py-1.5 text-xs rounded bg-violet-500 disabled:opacity-40 text-white font-bold inline-flex items-center gap-1"><Plus className="w-3 h-3" />Save rack</button>
        </div>
        <div className="flex flex-wrap gap-1">
          {(['eq', 'compressor', 'reverb', 'delay'] as FxType[]).map((t) => (
            <button key={t} onClick={() => addDraftUnit(t)} className="px-2 py-1 text-[10px] rounded border border-white/10 text-gray-300 hover:bg-white/[0.06]">+ {t}</button>
          ))}
        </div>
        {draft.length > 0 && (
          <div className="space-y-2">
            {draft.map((u) => (
              <div key={u.id} className="p-2 rounded border border-violet-500/20 bg-violet-500/[0.04]">
                <div className="flex items-center gap-2 mb-1">
                  <span className="text-[11px] font-semibold text-violet-200 uppercase">{u.type}</span>
                  <button aria-label="Close" onClick={() => setDraft((p) => p.filter((x) => x.id !== u.id))} className="ml-auto text-rose-400"><X className="w-3 h-3" /></button>
                </div>
                <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
                  {Object.entries(schema[u.type] || {}).filter(([, r]) => Array.isArray(r)).map(([key, range]) => {
                    const [min, max] = range as ParamRange;
                    const val = Number(u.params[key] ?? 0);
                    return (
                      <label key={key} className="text-[10px] text-gray-400">
                        {key}
                        <input type="range" min={min} max={max} step={(max - min) / 100} value={val}
                          onChange={(e) => updateDraftParam(u.id, key, Number(e.target.value))}
                          className="block w-full accent-violet-500" />
                        <span className="text-[9px] text-gray-400">{val}</span>
                      </label>
                    );
                  })}
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      <div className="max-h-72 overflow-y-auto">
        {loading ? (
          <div className="flex items-center justify-center py-8 text-xs text-gray-400"><Loader2 className="w-4 h-4 animate-spin mr-2" /> Loading…</div>
        ) : racks.length === 0 ? (
          <div className="px-3 py-10 text-center text-xs text-gray-400">No saved FX racks yet.</div>
        ) : (
          <ul className="divide-y divide-white/5">
            {racks.map((r) => (
              <li key={r.id} className="px-3 py-2 flex items-center gap-3">
                <div className="flex-1 min-w-0">
                  <div className="text-sm text-white">{r.name}</div>
                  <div className="text-[10px] text-gray-400">{r.units.map((u) => u.type).join(' → ')}</div>
                </div>
                <button aria-label="Delete" onClick={() => deleteRack(r.id)} className="p-1 text-rose-400"><Trash2 className="w-3 h-3" /></button>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}

export default FxRackPanel;
