'use client';

import { useEffect, useState } from 'react';
import { Target, Plus, Loader2, CheckCircle, AlertCircle } from 'lucide-react';
import { lensRun } from '@/lib/api/client';
import { cn } from '@/lib/utils';

interface TargetItem {
  id: string; name: string; baseYear: number; targetYear: number; baseCo2eTonnes: number;
  reductionPct: number; targetCo2eTonnes: number; scopes: number[]; framework: string; status: string;
}
interface Progress {
  target: TargetItem;
  currentEmissions: number;
  reductionAchievedPct: number;
  expectedReductionPct: number;
  onTrack: boolean;
  gapToTarget: number;
}

export function TargetsTracker() {
  const [targets, setTargets] = useState<TargetItem[]>([]);
  const [progress, setProgress] = useState<Record<string, Progress>>({});
  const [loading, setLoading] = useState(true);
  const [form, setForm] = useState({ name: '', baseYear: '2020', targetYear: '2030', baseCo2eTonnes: '', reductionPct: '50', scopes: [1, 2] as number[], framework: 'sbti_1.5c' });

  useEffect(() => { refresh(); }, []);

  async function refresh() {
    setLoading(true);
    try {
      const r = await lensRun({ domain: 'environment', action: 'targets-list', input: {} });
      const list = (r.data?.result?.targets || []) as TargetItem[];
      setTargets(list);
      const progMap: Record<string, Progress> = {};
      for (const t of list) {
        const p = await lensRun({ domain: 'environment', action: 'targets-progress', input: { id: t.id } });
        if (p.data?.ok !== false) progMap[t.id] = p.data?.result as Progress;
      }
      setProgress(progMap);
    } catch (e) { console.error('[Targets] failed', e); }
    finally { setLoading(false); }
  }

  async function create() {
    if (!form.name.trim() || !form.baseCo2eTonnes) return;
    try {
      await lensRun({ domain: 'environment', action: 'targets-create', input: { ...form, baseYear: Number(form.baseYear), targetYear: Number(form.targetYear), baseCo2eTonnes: Number(form.baseCo2eTonnes), reductionPct: Number(form.reductionPct) } });
      setForm({ ...form, name: '', baseCo2eTonnes: '' });
      await refresh();
    } catch (e) { console.error('[Targets] create', e); }
  }

  function toggleScope(scope: number) {
    setForm(f => ({ ...f, scopes: f.scopes.includes(scope) ? f.scopes.filter(s => s !== scope) : [...f.scopes, scope].sort() }));
  }

  return (
    <div className="bg-[#0d1117] border border-cyan-500/20 rounded-lg overflow-hidden">
      <header className="px-4 py-2 border-b border-white/10 flex items-center gap-2">
        <Target className="w-4 h-4 text-cyan-400" />
        <span className="text-xs uppercase font-semibold text-gray-300 tracking-wider">Decarbonisation targets · SBTi-shape</span>
        <span className="ml-auto text-[10px] text-gray-400">{targets.length}</span>
      </header>
      <div className="p-3 border-b border-white/10 space-y-2">
        <div className="grid grid-cols-6 gap-2">
          <input value={form.name} onChange={e => setForm({ ...form, name: e.target.value })} placeholder="Target name" className="col-span-2 px-2 py-1.5 text-xs bg-lattice-deep border border-lattice-border rounded text-white" />
          <input type="number" value={form.baseYear} onChange={e => setForm({ ...form, baseYear: e.target.value })} placeholder="Base year" className="px-2 py-1.5 text-xs bg-lattice-deep border border-lattice-border rounded text-white" />
          <input type="number" value={form.targetYear} onChange={e => setForm({ ...form, targetYear: e.target.value })} placeholder="Target year" className="px-2 py-1.5 text-xs bg-lattice-deep border border-lattice-border rounded text-white" />
          <input type="number" value={form.baseCo2eTonnes} onChange={e => setForm({ ...form, baseCo2eTonnes: e.target.value })} placeholder="Base tCO₂e" className="px-2 py-1.5 text-xs bg-lattice-deep border border-lattice-border rounded text-white" />
          <input type="number" value={form.reductionPct} onChange={e => setForm({ ...form, reductionPct: e.target.value })} placeholder="% reduction" className="px-2 py-1.5 text-xs bg-lattice-deep border border-lattice-border rounded text-white" />
          <select value={form.framework} onChange={e => setForm({ ...form, framework: e.target.value })} className="col-span-3 px-2 py-1.5 text-xs bg-lattice-deep border border-lattice-border rounded text-white">
            <option value="sbti_1.5c">SBTi 1.5°C aligned</option>
            <option value="sbti_well_below_2c">SBTi well-below 2°C</option>
            <option value="net_zero_2050">Net zero by 2050</option>
            <option value="custom">Custom</option>
          </select>
          <div className="col-span-2 flex items-center gap-1 text-[11px]">
            <span className="text-gray-400">Scopes:</span>
            {[1, 2, 3].map(s => (
              <button key={s} onClick={() => toggleScope(s)} className={cn('px-1.5 py-0.5 rounded', form.scopes.includes(s) ? 'bg-cyan-500/30 text-cyan-300' : 'bg-white/5 text-gray-400')}>S{s}</button>
            ))}
          </div>
          <button onClick={create} className="px-3 py-1.5 text-xs rounded bg-cyan-500 text-black font-bold hover:bg-cyan-400 inline-flex items-center justify-center gap-1"><Plus className="w-3 h-3" />Create target</button>
        </div>
      </div>
      <div className="max-h-96 overflow-y-auto">
        {loading ? (
          <div className="flex items-center justify-center py-6 text-xs text-gray-400"><Loader2 className="w-4 h-4 animate-spin mr-2" /> Loading…</div>
        ) : targets.length === 0 ? (
          <div className="px-3 py-10 text-center text-xs text-gray-400"><Target className="w-6 h-6 mx-auto mb-2 opacity-30" />No targets yet. SBTi recommends a 1.5°C-aligned target by 2030.</div>
        ) : (
          <ul className="divide-y divide-white/5">
            {targets.map(t => {
              const p = progress[t.id];
              const achieved = p?.reductionAchievedPct ?? 0;
              const expected = p?.expectedReductionPct ?? 0;
              return (
                <li key={t.id} className="px-3 py-3">
                  <div className="flex items-center gap-2 mb-1.5">
                    {p?.onTrack ? <CheckCircle className="w-3.5 h-3.5 text-emerald-400" /> : <AlertCircle className="w-3.5 h-3.5 text-amber-400" />}
                    <span className="text-sm text-white font-medium">{t.name}</span>
                    <span className="text-[10px] uppercase tracking-wider px-1.5 py-0.5 rounded bg-cyan-500/15 text-cyan-300">{t.framework.replace(/_/g, ' ')}</span>
                    <span className="ml-auto text-[10px] text-gray-400">Scopes {t.scopes.join('+')}</span>
                  </div>
                  <div className="text-[11px] text-gray-400 mb-1.5">{t.baseCo2eTonnes.toLocaleString()} → {t.targetCo2eTonnes.toLocaleString()} tCO₂e · {t.reductionPct}% reduction {t.baseYear}→{t.targetYear}</div>
                  <div className="relative h-3 bg-white/10 rounded-full overflow-hidden">
                    <div className={cn('absolute top-0 left-0 h-full transition-all', p?.onTrack ? 'bg-emerald-400' : 'bg-amber-400')} style={{ width: `${Math.min(100, Math.max(0, achieved))}%` }} />
                    <div className="absolute top-0 h-full w-px bg-cyan-300" style={{ left: `${Math.min(100, Math.max(0, expected))}%` }} title={`Expected pace: ${expected.toFixed(1)}%`} />
                  </div>
                  {p && (
                    <div className="mt-1 flex justify-between text-[10px] text-gray-400">
                      <span>{achieved.toFixed(1)}% achieved · expected {expected.toFixed(1)}%</span>
                      <span className={p.onTrack ? 'text-emerald-300' : 'text-amber-300'}>{p.onTrack ? 'on track' : `gap ${p.gapToTarget.toFixed(0)}t`}</span>
                    </div>
                  )}
                </li>
              );
            })}
          </ul>
        )}
      </div>
    </div>
  );
}

export default TargetsTracker;
