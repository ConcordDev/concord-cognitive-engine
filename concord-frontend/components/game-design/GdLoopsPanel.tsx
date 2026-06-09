'use client';

/**
 * GdLoopsPanel — Machinations-shape core-loop modelling. Each loop is a
 * named chain of steps; every step carries a resource delta, and the
 * panel folds those into a net-delta balance verdict per loop.
 */

import { useCallback, useEffect, useState } from 'react';
import { Loader2, Plus, Trash2, RefreshCw, Repeat } from 'lucide-react';
import { lensRun } from '@/lib/api/client';
import { cn } from '@/lib/utils';

interface Step { id: string; label: string; delta: number; resource: string | null }
interface Loop { id: string; name: string; kind: string; description: string | null; steps: Step[] }
interface Analysed { id: string; name: string; kind: string; steps: number; netDelta: number; verdict: string }

const KINDS = ['core', 'progression', 'positive', 'negative', 'economy'];
const KIND_COLOR: Record<string, string> = {
  core: 'text-lime-400', progression: 'text-sky-400', positive: 'text-emerald-400',
  negative: 'text-rose-400', economy: 'text-amber-400',
};

export function GdLoopsPanel({ gameId, onChange }: { gameId: string; onChange: () => void }) {
  const [loops, setLoops] = useState<Loop[]>([]);
  const [analysis, setAnalysis] = useState<{ loops: Analysed[]; unbalanced: number; health: string } | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [form, setForm] = useState({ name: '', kind: 'core', description: '' });
  const [stepDraft, setStepDraft] = useState<Record<string, { label: string; delta: string; resource: string }>>({});

  const refresh = useCallback(async () => {
    setLoading(true);
    const [l, a] = await Promise.all([
      lensRun('game-design', 'loop-list', { gameId }),
      lensRun('game-design', 'loop-analysis', { gameId }),
    ]);
    setLoops(l.data?.result?.loops || []);
    setAnalysis((a.data?.result?.loops ? a.data.result : null) as typeof analysis);
    setLoading(false);
    onChange();
  }, [gameId, onChange]);

  useEffect(() => { void refresh(); }, [refresh]);

  const addLoop = async () => {
    if (!form.name.trim()) { setError('Loop name is required.'); return; }
    const r = await lensRun('game-design', 'loop-create', {
      gameId, name: form.name.trim(), kind: form.kind, description: form.description.trim(),
    });
    if (r.data?.ok === false) { setError(r.data?.error || 'Failed'); return; }
    setForm({ name: '', kind: 'core', description: '' });
    setError(null);
    await refresh();
  };

  const delLoop = async (id: string) => {
    await lensRun('game-design', 'loop-delete', { id });
    await refresh();
  };

  const addStep = async (loopId: string) => {
    const d = stepDraft[loopId];
    if (!d?.label?.trim()) return;
    await lensRun('game-design', 'loop-step-add', {
      loopId, label: d.label.trim(), delta: Number(d.delta) || 0, resource: d.resource?.trim() || '',
    });
    setStepDraft({ ...stepDraft, [loopId]: { label: '', delta: '', resource: '' } });
    await refresh();
  };

  const delStep = async (loopId: string, stepId: string) => {
    await lensRun('game-design', 'loop-step-delete', { loopId, stepId });
    await refresh();
  };

  if (loading) {
    return <div className="flex items-center justify-center py-10 text-zinc-400"><Loader2 className="w-5 h-5 animate-spin" /></div>;
  }

  const verdictFor = (id: string) => analysis?.loops.find((a) => a.id === id);

  return (
    <div className="space-y-4">
      {error && <div className="text-xs text-rose-400 bg-rose-950/40 border border-rose-900/50 rounded-lg px-3 py-2">{error}</div>}

      <section className="bg-zinc-900/70 border border-zinc-800 rounded-xl p-3 space-y-2">
        <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
          <input placeholder="Loop name (e.g. Combat loop)" value={form.name}
            onChange={(e) => setForm({ ...form, name: e.target.value })}
            className="bg-zinc-950 border border-zinc-700 rounded-lg px-2 py-1.5 text-xs text-zinc-100" />
          <select value={form.kind} onChange={(e) => setForm({ ...form, kind: e.target.value })}
            className="bg-zinc-950 border border-zinc-700 rounded-lg px-2 py-1.5 text-xs text-zinc-100 capitalize">
            {KINDS.map((k) => <option key={k} value={k}>{k}</option>)}
          </select>
          <button type="button" onClick={addLoop}
            className="flex items-center justify-center gap-1 bg-lime-600 hover:bg-lime-500 text-white text-xs font-medium rounded-lg">
            <Plus className="w-3.5 h-3.5" /> Loop
          </button>
        </div>
        <input placeholder="What does this loop do? (optional)" value={form.description}
          onChange={(e) => setForm({ ...form, description: e.target.value })}
          className="w-full bg-zinc-950 border border-zinc-700 rounded-lg px-2 py-1.5 text-xs text-zinc-100" />
      </section>

      {analysis && (
        <div className="flex items-center gap-2 text-[11px] text-zinc-400 bg-zinc-900/70 border border-zinc-800 rounded-lg px-3 py-1.5">
          <RefreshCw className="w-3.5 h-3.5 text-lime-400" />
          <span className={analysis.unbalanced === 0 ? 'text-emerald-400' : 'text-amber-400'}>{analysis.health}</span>
        </div>
      )}

      {loops.length === 0 ? (
        <p className="text-[11px] text-zinc-400 italic py-6 text-center">No core loops modelled yet.</p>
      ) : (
        <ul className="space-y-2">
          {loops.map((loop) => {
            const a = verdictFor(loop.id);
            const d = stepDraft[loop.id] || { label: '', delta: '', resource: '' };
            return (
              <li key={loop.id} className="bg-zinc-900/70 border border-zinc-800 rounded-xl p-3 space-y-2">
                <div className="flex items-center gap-2">
                  <Repeat className={cn('w-4 h-4 shrink-0', KIND_COLOR[loop.kind])} />
                  <span className="text-sm font-semibold text-zinc-100">{loop.name}</span>
                  <span className={cn('text-[10px] uppercase', KIND_COLOR[loop.kind])}>{loop.kind}</span>
                  <div className="flex-1" />
                  {a && (
                    <span className={cn('text-[11px] font-mono px-1.5 rounded',
                      a.netDelta > 0 ? 'text-emerald-300 bg-emerald-950/40'
                        : a.netDelta < 0 ? 'text-rose-300 bg-rose-950/40' : 'text-zinc-300 bg-zinc-800')}>
                      net {a.netDelta > 0 ? '+' : ''}{a.netDelta}
                    </span>
                  )}
                  <button aria-label="Delete" type="button" onClick={() => delLoop(loop.id)} className="text-zinc-600 hover:text-rose-400">
                    <Trash2 className="w-3.5 h-3.5" />
                  </button>
                </div>
                {loop.description && <p className="text-[11px] text-zinc-400">{loop.description}</p>}
                {a && <p className={cn('text-[10px]', a.verdict.includes('—') ? 'text-amber-400' : 'text-emerald-400')}>{a.verdict}</p>}

                {loop.steps.length > 0 && (
                  <ol className="space-y-1">
                    {loop.steps.map((s, i) => (
                      <li key={s.id} className="flex items-center gap-2 bg-zinc-950/60 border border-zinc-800 rounded-lg px-2 py-1 text-[11px]">
                        <span className="text-zinc-600 w-4">{i + 1}</span>
                        <span className="flex-1 text-zinc-200">{s.label}</span>
                        {s.resource && <span className="text-zinc-400">{s.resource}</span>}
                        <span className={cn('font-mono', s.delta > 0 ? 'text-emerald-400' : s.delta < 0 ? 'text-rose-400' : 'text-zinc-400')}>
                          {s.delta > 0 ? '+' : ''}{s.delta}
                        </span>
                        <button aria-label="Delete" type="button" onClick={() => delStep(loop.id, s.id)} className="text-zinc-600 hover:text-rose-400">
                          <Trash2 className="w-3 h-3" />
                        </button>
                      </li>
                    ))}
                  </ol>
                )}

                <div className="flex items-center gap-1.5">
                  <input placeholder="Step (e.g. Defeat enemy)" value={d.label}
                    onChange={(e) => setStepDraft({ ...stepDraft, [loop.id]: { ...d, label: e.target.value } })}
                    className="flex-1 bg-zinc-950 border border-zinc-700 rounded-lg px-2 py-1 text-[11px] text-zinc-100" />
                  <input placeholder="resource" value={d.resource}
                    onChange={(e) => setStepDraft({ ...stepDraft, [loop.id]: { ...d, resource: e.target.value } })}
                    className="w-20 bg-zinc-950 border border-zinc-700 rounded-lg px-2 py-1 text-[11px] text-zinc-100" />
                  <input placeholder="±delta" inputMode="numeric" value={d.delta}
                    onChange={(e) => setStepDraft({ ...stepDraft, [loop.id]: { ...d, delta: e.target.value } })}
                    className="w-16 bg-zinc-950 border border-zinc-700 rounded-lg px-2 py-1 text-[11px] text-zinc-100" />
                  <button type="button" onClick={() => addStep(loop.id)}
                    className="px-2 py-1 text-[11px] bg-zinc-800 hover:bg-zinc-700 text-zinc-200 rounded-lg">+ Step</button>
                </div>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
