'use client';

/**
 * MhFactorsPanel — user-defined activity factors (Daylio core), a
 * factor-tagged mood check-in, and correlation insights that surface
 * which factors lift or lower mood relative to the user's baseline.
 */

import { useCallback, useEffect, useState } from 'react';
import { Loader2, Plus, Trash2, Tags, TrendingUp, TrendingDown, Minus } from 'lucide-react';
import { lensRun } from '@/lib/api/client';
import { cn } from '@/lib/utils';

interface Factor { id: string; name: string; group: string; icon: string | null }
interface Correlation { factorId: string; name: string; group: string; samples: number; avgMood: number; delta: number; effect: string }
interface CorrelationResult { hasData: boolean; baseline: number | null; entriesAnalyzed?: number; correlations: Correlation[] }

const MOOD_EMOJI = ['', '😞', '😕', '😐', '🙂', '😄'];

export function MhFactorsPanel({ onChange }: { onChange: () => void }) {
  const [factors, setFactors] = useState<Factor[]>([]);
  const [corr, setCorr] = useState<CorrelationResult | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [newFactor, setNewFactor] = useState('');
  const [newGroup, setNewGroup] = useState('');
  const [mood, setMood] = useState(3);
  const [selected, setSelected] = useState<string[]>([]);
  const [note, setNote] = useState('');

  const refresh = useCallback(async () => {
    setLoading(true);
    const [f, c] = await Promise.all([
      lensRun('mental-health', 'factor-list', {}),
      lensRun('mental-health', 'factor-correlations', { minSamples: 2 }),
    ]);
    setFactors(f.data?.result?.factors || []);
    setCorr((c.data?.result as CorrelationResult | null) || null);
    setLoading(false);
    onChange();
  }, [onChange]);

  useEffect(() => { void refresh(); }, [refresh]);

  const addFactor = async () => {
    const name = newFactor.trim();
    if (!name) { setError('Enter a factor name.'); return; }
    const r = await lensRun('mental-health', 'factor-create', { name, group: newGroup.trim() || 'activity' });
    if (r.data?.ok === false) { setError(r.data?.error || 'Failed'); return; }
    setNewFactor(''); setNewGroup(''); setError(null);
    await refresh();
  };

  const deleteFactor = async (id: string) => {
    await lensRun('mental-health', 'factor-delete', { id });
    setSelected((p) => p.filter((x) => x !== id));
    await refresh();
  };

  const logTagged = async () => {
    const r = await lensRun('mental-health', 'mood-log-tagged', { mood, factors: selected, note: note.trim() });
    if (r.data?.ok === false) { setError(r.data?.error || 'Failed'); return; }
    setSelected([]); setNote(''); setError(null);
    await refresh();
  };

  if (loading) {
    return <div className="flex items-center justify-center py-10 text-zinc-400"><Loader2 className="w-5 h-5 animate-spin" /></div>;
  }

  return (
    <div className="space-y-4">
      {error && <div className="text-xs text-rose-400 bg-rose-950/40 border border-rose-900/50 rounded-lg px-3 py-2">{error}</div>}

      {/* Define factors */}
      <section>
        <h3 className="flex items-center gap-1 text-xs font-semibold text-zinc-300 mb-2">
          <Tags className="w-3.5 h-3.5 text-sky-400" /> Your factors
        </h3>
        <div className="bg-zinc-900/70 border border-zinc-800 rounded-xl p-3 space-y-2">
          <div className="flex gap-1">
            <input value={newFactor} onChange={(e) => setNewFactor(e.target.value)} placeholder="Factor (e.g. Exercise)"
              className="flex-1 bg-zinc-950 border border-zinc-700 rounded-lg px-2 py-1.5 text-xs text-zinc-100" />
            <input value={newGroup} onChange={(e) => setNewGroup(e.target.value)} placeholder="Group"
              className="w-24 bg-zinc-950 border border-zinc-700 rounded-lg px-2 py-1.5 text-xs text-zinc-100" />
            <button aria-label="Add" type="button" onClick={addFactor}
              className="px-3 py-1.5 text-xs bg-sky-600 hover:bg-sky-500 text-white rounded-lg"><Plus className="w-3.5 h-3.5" /></button>
          </div>
          {factors.length === 0 ? (
            <p className="text-[11px] text-zinc-400 italic">No factors yet. Add the activities you want to track against mood.</p>
          ) : (
            <div className="flex flex-wrap gap-1.5">
              {factors.map((f) => (
                <span key={f.id} className="flex items-center gap-1 bg-zinc-800 border border-zinc-700 rounded-full pl-2.5 pr-1 py-0.5 text-[11px] text-zinc-200">
                  {f.name}<span className="text-zinc-400">·{f.group}</span>
                  <button type="button" onClick={() => deleteFactor(f.id)} className="text-zinc-400 hover:text-rose-400" aria-label="Delete factor">
                    <Trash2 className="w-3 h-3" />
                  </button>
                </span>
              ))}
            </div>
          )}
        </div>
      </section>

      {/* Tagged check-in */}
      {factors.length > 0 && (
        <section>
          <h3 className="text-xs font-semibold text-zinc-300 mb-2">Tagged mood check-in</h3>
          <div className="bg-zinc-900/70 border border-zinc-800 rounded-xl p-3 space-y-2">
            <div className="flex justify-between">
              {[1, 2, 3, 4, 5].map((n) => (
                <button key={n} type="button" onClick={() => setMood(n)}
                  className={cn('text-xl rounded-lg px-2 py-1', mood === n ? 'bg-sky-950/60 scale-110' : 'opacity-50 hover:opacity-100')}>
                  {MOOD_EMOJI[n]}
                </button>
              ))}
            </div>
            <div className="flex flex-wrap gap-1.5">
              {factors.map((f) => {
                const on = selected.includes(f.id);
                return (
                  <button key={f.id} type="button"
                    onClick={() => setSelected((p) => on ? p.filter((x) => x !== f.id) : [...p, f.id])}
                    className={cn('rounded-full px-2.5 py-0.5 text-[11px] border',
                      on ? 'bg-sky-600 border-sky-500 text-white' : 'bg-zinc-800 border-zinc-700 text-zinc-300')}>
                    {f.name}
                  </button>
                );
              })}
            </div>
            <div className="flex gap-1">
              <input value={note} onChange={(e) => setNote(e.target.value)} placeholder="Optional note…"
                className="flex-1 bg-zinc-950 border border-zinc-700 rounded-lg px-2 py-1.5 text-xs text-zinc-100" />
              <button type="button" onClick={logTagged}
                className="px-3 py-1.5 text-xs bg-sky-600 hover:bg-sky-500 text-white rounded-lg">Log</button>
            </div>
          </div>
        </section>
      )}

      {/* Correlation insights */}
      <section>
        <h3 className="text-xs font-semibold text-zinc-300 mb-2">Correlation insights</h3>
        {!corr || !corr.hasData ? (
          <p className="text-[11px] text-zinc-400 italic">
            Log a few factor-tagged check-ins to see which activities lift or lower your mood.
          </p>
        ) : (
          <div className="bg-zinc-900/70 border border-zinc-800 rounded-xl p-3 space-y-2">
            <p className="text-[11px] text-zinc-400">
              Baseline mood {corr.baseline} across {corr.entriesAnalyzed} tagged check-ins.
            </p>
            {corr.correlations.length === 0 ? (
              <p className="text-[11px] text-zinc-400 italic">Not enough samples per factor yet.</p>
            ) : (
              <ul className="space-y-1.5">
                {corr.correlations.map((c) => {
                  const Icon = c.effect === 'lifts' ? TrendingUp : c.effect === 'lowers' ? TrendingDown : Minus;
                  const color = c.effect === 'lifts' ? 'text-emerald-400' : c.effect === 'lowers' ? 'text-rose-400' : 'text-zinc-400';
                  return (
                    <li key={c.factorId} className="flex items-center gap-2 text-xs">
                      <Icon className={cn('w-3.5 h-3.5 shrink-0', color)} />
                      <span className="text-zinc-200 flex-1">{c.name}</span>
                      <span className="text-zinc-400">{c.samples}×</span>
                      <span className={cn('font-mono font-semibold w-12 text-right', color)}>
                        {c.delta > 0 ? '+' : ''}{c.delta}
                      </span>
                    </li>
                  );
                })}
              </ul>
            )}
          </div>
        )}
      </section>
    </div>
  );
}
