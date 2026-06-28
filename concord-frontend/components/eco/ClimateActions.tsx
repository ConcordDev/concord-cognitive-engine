'use client';

import { useEffect, useMemo, useState } from 'react';
import { Leaf, Plus, Check, Filter, Loader2, TrendingDown } from 'lucide-react';
import { api } from '@/lib/api/client';
import { cn } from '@/lib/utils';

export interface ClimateAction {
  slug: string;
  title: string;
  category: 'transport' | 'food' | 'home' | 'shopping' | 'advocacy' | 'energy';
  effort: 1 | 2 | 3 | 4 | 5;
  kgCo2eSavedPerYear: number;
  description: string;
  citation: string;
}

interface ClimateActionsProps {
  onLogged?: (slug: string, kgSaved: number) => void;
}

const CATEGORIES: Array<ClimateAction['category']> = ['transport', 'food', 'home', 'shopping', 'advocacy', 'energy'];

export function ClimateActions({ onLogged }: ClimateActionsProps) {
  const [actions, setActions] = useState<ClimateAction[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [logged, setLogged] = useState<Record<string, number>>({});
  const [filter, setFilter] = useState<ClimateAction['category'] | 'all'>('all');
  const [effortMax, setEffortMax] = useState<number>(5);

  useEffect(() => { refresh(); }, []);
  useEffect(() => { refreshLogged(); }, []);

  async function refresh() {
    setLoading(true);
    setError(null);
    try {
      const res = await api.post('/api/lens/run', {
        domain: 'eco', action: 'climate-actions-list', input: {},
      });
      // /api/lens/run single-unwraps: a handler rejection arrives as
      // res.data.result = { ok:false, error }. Surface it as an error so a
      // backend failure is never indistinguishable from "no actions match".
      const node = res.data?.result;
      if (node && (node as { ok?: boolean }).ok === false) {
        setError((node as { error?: string }).error || 'Could not load climate actions.');
        setActions([]);
      } else {
        setActions(((node as { actions?: ClimateAction[] })?.actions || []) as ClimateAction[]);
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not load climate actions.');
      setActions([]);
    } finally { setLoading(false); }
  }

  async function refreshLogged() {
    try {
      const res = await api.post('/api/lens/run', {
        domain: 'eco', action: 'climate-actions-logged', input: { sinceDays: 30 },
      });
      const counts: Record<string, number> = {};
      for (const e of (res.data?.result?.entries || [])) {
        counts[e.slug] = (counts[e.slug] || 0) + 1;
      }
      setLogged(counts);
    } catch { /* best effort */ }
  }

  async function logAction(action: ClimateAction) {
    setLogged(prev => ({ ...prev, [action.slug]: (prev[action.slug] || 0) + 1 }));
    try {
      await api.post('/api/lens/run', {
        domain: 'eco', action: 'climate-actions-log',
        input: { slug: action.slug, kgCo2eSavedThisInstance: action.kgCo2eSavedPerYear / 52 },
      });
      onLogged?.(action.slug, action.kgCo2eSavedPerYear / 52);
    } catch (e) {
      console.error('[Actions] log failed', e);
    }
  }

  const visible = useMemo(() => {
    return actions.filter(a => (filter === 'all' || a.category === filter) && a.effort <= effortMax);
  }, [actions, filter, effortMax]);

  const totalThisMonth = useMemo(() => {
    let total = 0;
    for (const a of actions) {
      const count = logged[a.slug] || 0;
      total += count * (a.kgCo2eSavedPerYear / 52);
    }
    return total;
  }, [actions, logged]);

  return (
    <div className="bg-[#0d1117] border border-cyan-500/20 rounded-lg overflow-hidden">
      <header className="px-4 py-2 border-b border-white/10 flex items-center gap-2">
        <Leaf className="w-4 h-4 text-green-400" />
        <span className="text-xs uppercase font-semibold text-gray-300 tracking-wider">Climate actions</span>
        <span className="ml-auto text-xs text-green-300 inline-flex items-center gap-1">
          <TrendingDown className="w-3 h-3" /> {totalThisMonth.toFixed(1)} kgCO₂e saved this month
        </span>
      </header>
      <div className="px-3 py-2 border-b border-white/5 flex items-center gap-2 text-xs flex-wrap">
        <Filter className="w-3.5 h-3.5 text-gray-400" />
        <select
          value={filter}
          onChange={e => setFilter(e.target.value as ClimateAction['category'] | 'all')}
          className="px-2 py-1 text-xs bg-lattice-deep border border-lattice-border rounded text-white"
        >
          <option value="all">All categories</option>
          {CATEGORIES.map(c => <option key={c} value={c}>{c}</option>)}
        </select>
        <label className="ml-2 text-gray-400">Max effort:</label>
        <input
          type="range" min={1} max={5} value={effortMax}
          onChange={e => setEffortMax(Number(e.target.value))}
          className="accent-green-400 w-24"
        />
        <span className="text-green-300 font-mono">{effortMax}/5</span>
      </div>
      <div className="max-h-96 overflow-y-auto">
        {loading ? (
          <div role="status" aria-busy="true" className="flex items-center justify-center py-6 text-xs text-gray-400">
            <Loader2 className="w-4 h-4 animate-spin mr-2" /> Loading…
          </div>
        ) : error ? (
          <div role="alert" className="px-3 py-8 text-center text-xs text-red-400 space-y-2">
            <div>{error}</div>
            <button
              onClick={() => refresh()}
              className="inline-flex items-center gap-1.5 px-3 py-1 rounded bg-white/[0.04] border border-white/10 text-gray-300 hover:bg-white/[0.08]"
            >
              Retry
            </button>
          </div>
        ) : visible.length === 0 ? (
          <div className="px-3 py-8 text-xs text-gray-400 text-center">No actions match.</div>
        ) : (
          <ul className="divide-y divide-white/5">
            {visible.map(a => {
              const count = logged[a.slug] || 0;
              return (
                <li key={a.slug} className="px-3 py-2 hover:bg-white/[0.03]">
                  <div className="flex items-start gap-3">
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 mb-0.5">
                        <span className="text-sm text-white font-medium">{a.title}</span>
                        <span className="text-[9px] text-gray-400 uppercase">{a.category}</span>
                        <span className="text-[9px] text-yellow-400">{'★'.repeat(a.effort)}{'☆'.repeat(5 - a.effort)}</span>
                      </div>
                      <p className="text-[11px] text-gray-400 mb-1">{a.description}</p>
                      <div className="flex items-center gap-3 text-[10px]">
                        <span className="text-green-400">~{a.kgCo2eSavedPerYear.toFixed(0)} kgCO₂e/yr saved</span>
                        <span className="text-gray-400">· {a.citation}</span>
                      </div>
                    </div>
                    <button
                      onClick={() => logAction(a)}
                      className={cn(
                        'shrink-0 inline-flex items-center gap-1 px-2.5 py-1 text-[11px] rounded',
                        count > 0
                          ? 'bg-green-500/20 text-green-300 border border-green-500/40'
                          : 'bg-cyan-500 text-black font-bold hover:bg-cyan-400'
                      )}
                      title={count > 0 ? `Logged ${count} time${count === 1 ? '' : 's'}` : 'Log it'}
                    >
                      {count > 0 ? <Check className="w-3 h-3" /> : <Plus className="w-3 h-3" />}
                      {count > 0 ? `Logged ${count}x` : 'Log it'}
                    </button>
                  </div>
                </li>
              );
            })}
          </ul>
        )}
      </div>
    </div>
  );
}

export default ClimateActions;
