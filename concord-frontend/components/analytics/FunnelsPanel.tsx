'use client';

/**
 * FunnelsPanel — surfaces the analytics lens's saved conversion funnels (the
 * analytics.funnel-* macros existed backend-side but had no UI). Define a named
 * funnel as an ordered list of steps, list, delete. A Mixpanel/Amplitude-core feature.
 *
 * Computed results (R3 / Review 4 F9): funnel-list already attaches each
 * funnel's computed result server-side — domains/analytics.js maps every
 * saved funnel to { ...f, result: computeFunnel(the actor's event log,
 * f.steps) }. This panel used to type only { id, name, steps } and render
 * the definition, silently dropping the computation (the tab read as
 * definition-only in the review). The result now renders below the step
 * chips in the Events builder's own funnel idiom (EventAnalytics). A
 * funnel whose payload carries no result stays definition-only — absent
 * data never renders as invented numbers.
 */

import { useCallback, useEffect, useState } from 'react';
import { Filter, Plus, Trash2, Loader2, AlertTriangle } from 'lucide-react';
import { lensRun } from '@/lib/api/client';
import { useLensStatePersistence } from '@/lib/lens-state-persistence';
import { cn } from '@/lib/utils';

// The computed shape funnel-list attaches (server computeFunnel; the same
// shape EventAnalytics' funnel-build result renders).
interface FunnelStepResult { step: number; event: string; count: number; conversionFromStart: number; conversionFromPrev: number }
interface FunnelResult { steps: FunnelStepResult[]; totalStarters: number; overallConversion: number }
interface Funnel { id: string; name: string; steps?: string[]; result?: FunnelResult }

export function FunnelsPanel({ className }: { className?: string }) {
  const [funnels, setFunnels] = useState<Funnel[]>([]);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  // Draft persistence (A23 successor, Review 4 Addenda 5 + 8): the
  // funnel-builder draft rides the lens state store under a funnelDraft
  // key — restored once on mount, re-persisted on change. The lens page
  // replaces its whole body on a tab switch, so plain useState drafts
  // died on every switch; these two fields are the A23 protocol's graded
  // pair. Same idiom as the bench drafts (AnalyticsActionPanel).
  const { restore, persist } = useLensStatePersistence('analytics');
  const [savedFunnelDraft] = useState(() => {
    const d = restore()?.funnelDraft;
    return d && typeof d === 'object' ? (d as Record<string, unknown>) : {};
  });
  const [name, setName] = useState(() => String(savedFunnelDraft.name ?? ''));
  const [stepsText, setStepsText] = useState(() => String(savedFunnelDraft.stepsText ?? ''));
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    persist({ ...(restore() ?? {}), funnelDraft: { name, stepsText } });
  }, [name, stepsText, persist, restore]);

  const load = useCallback(async () => {
    setLoading(true); setError(null);
    try {
      const r = await lensRun('analytics', 'funnel-list', {});
      const list = (r?.data?.result?.funnels || []) as Funnel[];
      setFunnels(Array.isArray(list) ? list : []);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to load funnels');
    } finally { setLoading(false); }
  }, []);

  useEffect(() => { void load(); }, [load]);

  const save = useCallback(async () => {
    const steps = stepsText.split(',').map((s) => s.trim()).filter(Boolean);
    if (!name.trim() || steps.length < 2) { setError('A funnel needs a name and at least 2 comma-separated steps.'); return; }
    setSaving(true); setError(null);
    try {
      const r = await lensRun('analytics', 'funnel-save', { name: name.trim(), steps });
      if (r?.data?.error) setError(String(r.data.error));
      else { setName(''); setStepsText(''); await load(); }
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to save funnel');
    } finally { setSaving(false); }
  }, [name, stepsText, load]);

  const remove = useCallback(async (id: string) => {
    setFunnels((prev) => prev.filter((f) => f.id !== id));
    try { await lensRun('analytics', 'funnel-delete', { id }); } catch { void load(); }
  }, [load]);

  return (
    <div className={cn('rounded-xl border border-zinc-800 bg-zinc-950/40 p-4', className)}>
      <div className="flex items-center gap-2 mb-3">
        <Filter className="w-4 h-4 text-amber-400" />
        <h3 className="text-sm font-semibold text-zinc-100">Conversion funnels</h3>
        {loading && <Loader2 className="w-3.5 h-3.5 animate-spin text-zinc-500" />}
      </div>

      {error && (
        <div className="mb-3 flex items-center gap-2 text-xs text-rose-300">
          <AlertTriangle className="w-3.5 h-3.5" /> {error}
        </div>
      )}

      <div className="space-y-2 mb-3">
        {funnels.length === 0 && !loading && <p className="text-xs text-zinc-500">No funnels defined yet.</p>}
        {funnels.map((f) => (
          <div key={f.id} className="group">
            <div className="flex items-center gap-2">
              <span className="text-zinc-100 font-medium text-xs flex-1">{f.name}</span>
              <button type="button" onClick={() => void remove(f.id)} aria-label="Delete funnel"
                className="opacity-0 group-hover:opacity-100 p-1 text-rose-300 hover:bg-rose-500/20 rounded"><Trash2 className="w-3 h-3" /></button>
            </div>
            {Array.isArray(f.steps) && (
              <div className="flex items-center flex-wrap gap-1 mt-0.5">
                {f.steps.map((s, i) => (
                  <span key={i} className="inline-flex items-center text-[10px] text-amber-300/90">
                    {i > 0 && <span className="text-zinc-600 mx-0.5">→</span>}
                    <span className="bg-amber-500/10 border border-amber-500/30 rounded px-1.5 py-0.5">{s}</span>
                  </span>
                ))}
              </div>
            )}
            {f.result && Array.isArray(f.result.steps) && (
              <div className="space-y-1 mt-1.5 ml-0.5">
                {f.result.steps.map((s) => (
                  <div key={s.step} className="text-[11px]">
                    <div className="flex justify-between text-zinc-300">
                      <span>{s.step}. {s.event}</span>
                      <span>{s.count} · {s.conversionFromStart}%</span>
                    </div>
                    <div className="h-1.5 bg-zinc-800 rounded overflow-hidden">
                      <div className="h-full bg-amber-500" style={{ width: `${s.conversionFromStart}%` }} />
                    </div>
                  </div>
                ))}
                <p className="text-[10px] text-amber-300">
                  Overall conversion: {f.result.overallConversion}% · {f.result.totalStarters} entered
                </p>
              </div>
            )}
          </div>
        ))}
      </div>

      <form onSubmit={(e) => { e.preventDefault(); void save(); }} className="flex flex-wrap items-center gap-2">
        <input value={name} onChange={(e) => setName(e.target.value)} placeholder="Funnel name" maxLength={50}
          className="w-32 bg-zinc-900 border border-zinc-700 rounded px-2 py-1.5 text-xs text-zinc-100 focus:border-amber-500 focus:outline-none" />
        <input value={stepsText} onChange={(e) => setStepsText(e.target.value)} placeholder="step1, step2, step3" maxLength={200}
          className="flex-1 min-w-[10rem] bg-zinc-900 border border-zinc-700 rounded px-2 py-1.5 text-xs text-zinc-100 focus:outline-none" />
        <button type="submit" disabled={saving || !name.trim()}
          className="inline-flex items-center gap-1 px-2.5 py-1.5 rounded bg-amber-500/20 border border-amber-500/40 text-amber-300 text-xs font-medium hover:bg-amber-500/30 disabled:opacity-50 focus:outline-none focus-visible:ring-2 focus-visible:ring-amber-400/50">
          {saving ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Plus className="w-3.5 h-3.5" />} Save
        </button>
      </form>
    </div>
  );
}

export default FunnelsPanel;
