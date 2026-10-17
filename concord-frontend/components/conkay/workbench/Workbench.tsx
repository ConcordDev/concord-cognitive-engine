'use client';

/**
 * Workbench v0 — the design for people who want the knobs. Left: the design variables with their declared bounds
 * or options, each lockable (a locked variable is never moved by an edit or by the orchestrator). Middle: the design
 * graph in columns (knobs, then solver runs by how many results they read through); selecting a node lights what
 * it reads and what reads it. Right: the selected check's receipt — solver and version, input hash, validity range,
 * inputs with sources, margins, and an explanation with the numbers substituted. Bottom: a follow-up box; a knob
 * move and a typed follow-up take the same edit path, and every reply shows what changed and which checks flipped.
 */

import { useMemo, useState } from 'react';
import { Lock, LockOpen, RotateCcw, Send, Loader2 } from 'lucide-react';
import { neighbourhood, workbenchClient, type WorkbenchCheck, type WorkbenchClient, type WorkbenchKnob, type WorkbenchReply, type WorkbenchView } from '@/lib/conkay/workbench-api';
import { CHECK_STYLE, PANEL } from '@/components/conkay/designs/design-styles';
import type { CheckStatus } from '@/lib/conkay/designs-api';

const statusCls = (s?: string) => CHECK_STYLE[(s as CheckStatus)] || CHECK_STYLE.NOT_COMPUTED;

export function Workbench({ id, initialView, client = workbenchClient }: { id: string; initialView: WorkbenchView; client?: WorkbenchClient }) {
  const [view, setView] = useState(initialView);
  const [selected, setSelected] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [reply, setReply] = useState<WorkbenchReply | null>(null);
  const [error, setError] = useState('');
  const [text, setText] = useState('');

  const run = async (fn: () => Promise<{ view: WorkbenchView; reply?: WorkbenchReply }>) => {
    setBusy(true); setError('');
    try {
      const r = await fn();
      setView(r.view);
      if (r.reply) setReply(r.reply);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'the request failed');
    } finally { setBusy(false); }
  };

  const columns = useMemo(() => {
    const byDepth = new Map<number, typeof view.graph.nodes>();
    for (const n of view.graph.nodes) (byDepth.get(n.depth) || byDepth.set(n.depth, []).get(n.depth)!).push(n);
    return [...byDepth.entries()].sort((a, b) => a[0] - b[0]).map(([d, ns]) => ({ depth: d, nodes: [...ns].sort((a, b) => a.id.localeCompare(b.id)) }));
  }, [view]);
  const hood = useMemo(() => (selected ? neighbourhood(view.graph.edges, selected) : null), [selected, view]);
  const check = view.checks.find((c) => c.runId === selected) || null;

  return (
    <div className="flex flex-col gap-3" data-testid="workbench">
      <div className="flex flex-wrap items-center gap-3 text-xs text-slate-400">
        <span>revision <span className="font-mono text-slate-200" data-testid="wb-revision">{view.revision}</span></span>
        <span className="font-mono">receipt {view.receipt.slice(0, 12)}</span>
        {view.locked.length > 0 && <span data-testid="wb-locked">locked: {view.locked.join(', ')}</span>}
        <button type="button" className="ml-auto inline-flex items-center gap-1 rounded-md border border-white/10 px-2 py-1 hover:bg-white/5 disabled:opacity-40" disabled={busy || view.revision === 0} onClick={() => run(() => client.undo(id))}>
          <RotateCcw className="h-3 w-3" aria-hidden /> Undo
        </button>
      </div>
      <div className="grid gap-3 xl:grid-cols-[260px_minmax(0,1fr)_380px]">
        <section className={PANEL} aria-label="knobs">
          <h2 className="mb-2 text-xs font-semibold uppercase tracking-wider text-slate-400">Design variables</h2>
          <div className="flex flex-col gap-3">
            {view.knobs.map((k) => <Knob key={k.variable} k={k} busy={busy} onSet={(v) => run(() => client.knob(id, k.variable, v))} onLock={(l) => run(() => client.lock(id, k.variable, l))} onSelect={() => setSelected(`knob:${k.variable}`)} />)}
            {view.knobs.length === 0 && <p className="text-xs text-slate-500">This design has no adjustable variables.</p>}
          </div>
        </section>
        <section className={`${PANEL} overflow-x-auto`} aria-label="design graph">
          <h2 className="mb-2 text-xs font-semibold uppercase tracking-wider text-slate-400">Design graph · {view.graph.nodes.length} nodes · {view.graph.edges.length} edges</h2>
          <div className="flex gap-3">
            {columns.map((col) => (
              <ol key={col.depth} className="flex min-w-[150px] flex-col gap-1" aria-label={`depth ${col.depth}`}>
                {col.nodes.map((n) => {
                  const lit = selected === n.id ? 'ring-1 ring-sky-300' : hood?.up.has(n.id) ? 'ring-1 ring-violet-300/60' : hood?.down.has(n.id) ? 'ring-1 ring-amber-300/60' : '';
                  return (
                    <li key={n.id}>
                      <button type="button" data-testid={`wb-node-${n.id}`} onClick={() => setSelected(n.id)}
                        className={`w-full truncate rounded-md border px-1.5 py-0.5 text-left font-mono text-[10px] ${n.kind === 'knob' ? 'border-sky-400/30 bg-sky-400/10 text-sky-200' : statusCls(n.status)} ${lit}`}
                        title={n.id}>
                        {n.kind === 'knob' && n.locked ? '🔒 ' : ''}{n.label}
                      </button>
                    </li>
                  );
                })}
              </ol>
            ))}
          </div>
          {hood && <p className="mt-2 text-[11px] text-slate-500">{hood.up.size} upstream (violet) · {hood.down.size} downstream (amber) of the selection</p>}
        </section>
        <Receipt check={check} />
      </div>
      <form className={`${PANEL} flex items-center gap-2`} onSubmit={(e) => { e.preventDefault(); if (text.trim()) run(() => client.ask(id, text.trim())); }}>
        <input aria-label="follow-up" value={text} onChange={(e) => setText(e.target.value)} placeholder='What if… ("make the tail shorter", "what about 150 mph", "use titanium for the tub")'
          className="flex-1 rounded-md border border-white/10 bg-black/30 px-2 py-1.5 text-sm text-slate-100 placeholder:text-slate-500 focus:border-sky-400/50 focus:outline-none" />
        <button type="submit" disabled={busy} className="inline-flex items-center gap-1 rounded-md bg-sky-500/80 px-3 py-1.5 text-sm text-white hover:bg-sky-500 disabled:opacity-40">
          {busy ? <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden /> : <Send className="h-3.5 w-3.5" aria-hidden />} Apply
        </button>
      </form>
      {error && <p role="alert" className="text-sm text-rose-300">{error}</p>}
      {reply && <Reply r={reply} />}
    </div>
  );
}

function Knob({ k, busy, onSet, onLock, onSelect }: { k: WorkbenchKnob; busy: boolean; onSet: (v: string | number) => void; onLock: (locked: boolean) => void; onSelect: () => void }) {
  const [draft, setDraft] = useState<string | number>(k.value);
  return (
    <div className="flex flex-col gap-1" data-testid={`wb-knob-${k.variable}`}>
      <div className="flex items-center justify-between gap-2">
        <button type="button" onClick={onSelect} className="text-left text-sm text-slate-200 hover:underline">{k.label}</button>
        <button type="button" aria-label={k.locked ? `unlock ${k.label}` : `lock ${k.label}`} aria-pressed={k.locked} disabled={busy} onClick={() => onLock(!k.locked)}
          className={`rounded p-1 ${k.locked ? 'text-amber-200' : 'text-slate-400 hover:text-slate-200'}`}>
          {k.locked ? <Lock className="h-3.5 w-3.5" /> : <LockOpen className="h-3.5 w-3.5" />}
        </button>
      </div>
      {k.options ? (
        <select aria-label={k.label} disabled={k.locked || busy} value={String(draft)} onChange={(e) => setDraft(e.target.value)} className="rounded-md border border-white/10 bg-black/30 px-1.5 py-1 font-mono text-[11px] text-slate-100 disabled:opacity-50">
          {k.options.map((o) => <option key={o} value={o}>{o}</option>)}
        </select>
      ) : (
        <div className="flex items-center gap-2">
          <input aria-label={k.label} type="range" min={k.bounds?.[0]} max={k.bounds?.[1]} step={k.step ?? 0.01} disabled={k.locked || busy} value={Number(draft)} onChange={(e) => setDraft(Number(e.target.value))} className="flex-1" />
          <span className="w-16 text-right font-mono text-[11px] text-slate-300">{Number(draft).toFixed(2)} {k.unit}</span>
        </div>
      )}
      <div className="flex items-center justify-between">
        <span className="truncate text-[10px] text-slate-500" title={k.source}>{k.bounds ? `${k.bounds[0]}–${k.bounds[1]} ${k.unit ?? ''}` : `${k.options?.length ?? 0} options`}</span>
        <button type="button" disabled={k.locked || busy || draft === k.value} onClick={() => onSet(draft)} className="rounded border border-white/10 px-1.5 py-0.5 text-[11px] text-slate-200 hover:bg-white/5 disabled:opacity-40">Set</button>
      </div>
    </div>
  );
}

function Receipt({ check }: { check: WorkbenchCheck | null }) {
  if (!check) return <aside className={`${PANEL} text-xs text-slate-500`} aria-label="receipt">Select a check in the graph to see its receipt.</aside>;
  return (
    <aside className={`${PANEL} flex flex-col gap-2 text-xs`} aria-label="receipt" data-testid="wb-receipt">
      <div className="flex items-center justify-between gap-2">
        <h2 className="truncate font-mono text-[11px] text-slate-100">{check.runId}</h2>
        <span className={`rounded-full border px-2 py-0.5 text-[10px] ${statusCls(check.status)}`}>{check.status}</span>
      </div>
      <dl className="grid grid-cols-[90px_1fr] gap-x-2 gap-y-0.5 text-[11px]">
        <dt className="text-slate-500">solver</dt><dd className="font-mono text-slate-300">{check.solver.id}@{check.solver.version} {check.solver.fidelity}</dd>
        <dt className="text-slate-500">input hash</dt><dd className="truncate font-mono text-slate-300">{check.inputHash}</dd>
        {check.solver.regime && <><dt className="text-slate-500">valid for</dt><dd className="text-slate-300">{check.solver.regime}</dd></>}
        {check.solver.reference && <><dt className="text-slate-500">reference</dt><dd className="text-slate-300">{check.solver.reference}</dd></>}
      </dl>
      {check.margins.length > 0 && (
        <table className="w-full text-[11px]"><tbody>
          {check.margins.map((m, i) => (
            <tr key={i} className="align-top"><td className="pr-2 text-slate-400">{m.check}</td><td className="whitespace-nowrap font-mono text-slate-200">{m.utilization != null ? m.utilization.toFixed(3) : '—'}</td></tr>
          ))}
        </tbody></table>
      )}
      <pre className="whitespace-pre-wrap rounded-md bg-black/30 p-2 font-sans text-[11px] leading-relaxed text-slate-200" data-testid="wb-explanation">{check.explanation}</pre>
      {check.sources.length > 0 && (
        <ul className="flex flex-col gap-0.5">{check.sources.map((u) => <li key={u}><a href={u} target="_blank" rel="noreferrer" className="break-all text-sky-300 hover:underline">{u}</a></li>)}</ul>
      )}
    </aside>
  );
}

/** What a reply says changed — shared by the Workbench's own reply area and the builder's chat. */
export function Reply({ r }: { r: WorkbenchReply }) {
  return (
    <section className={PANEL} aria-label="what changed" data-testid="wb-reply">
      {r.note && <p className="text-sm text-amber-200">{r.note}</p>}
      {r.question && <p className="text-sm text-sky-200">{r.question}</p>}
      {r.error && <p className="text-sm text-rose-300">{r.error}</p>}
      {r.diff && (
        <>
          <ul className="text-sm text-slate-200">{r.diff.changed.map((c, i) => <li key={i}><span className="font-medium">{c.field}</span>: {String(c.before)} → {String(c.after)} <span className="text-xs text-slate-500">({c.source})</span></li>)}</ul>
          <p className="mt-1 text-xs text-slate-400">{Array.isArray(r.diff.rerun) ? `${r.diff.rerun.length} runs recomputed` : r.diff.rerun}; {r.diff.flipped.length} checks flipped</p>
          {r.diff.flipped.length > 0 && <ul className="mt-1 flex flex-wrap gap-1">{r.diff.flipped.map((f) => <li key={f.runId} className="rounded border border-white/10 px-1.5 py-0.5 font-mono text-[10px] text-slate-300">{f.runId}: {f.from ?? '—'} → {f.to ?? '—'}</li>)}</ul>}
        </>
      )}
      {r.outcome?.binding && r.outcome.binding.length > 0 && <ul className="mt-1 list-disc pl-5 text-xs text-slate-300">{r.outcome.binding.map((b, i) => <li key={i}>{b.why}</li>)}</ul>}
      {r.kind === 'locked' && <p className="text-xs text-slate-400">Unlock it in the variables panel to change it.</p>}
    </section>
  );
}
