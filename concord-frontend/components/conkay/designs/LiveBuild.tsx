'use client';

/**
 * LiveBuild — /conkay/designs/[id]/live. Watch the design get made: every orchestrator iteration in order, the
 * check that failed, the candidates it ran with their computed margins, what changed and why, what reran, and
 * the body after each change. Read-only; the stream is the server's record of the run (nothing solved here).
 * Reconnects resume from the last event id; nothing is shown twice.
 */

import Link from 'next/link';
import dynamic from 'next/dynamic';
import { useEffect, useReducer, useState } from 'react';
import { ArrowLeft, CheckCircle2, CircleSlash, Loader2, Radio, Wrench } from 'lucide-react';
import {
  LIVE_EVENT_TYPES, LIVE_INITIAL, latestSnapshot, liveFileUrl, liveReducer, liveStreamUrl,
  type LiveCandidate, type LiveEvent,
} from '@/lib/conkay/live-api';
import { DesignsHeader } from './DesignsHeader';
import { PANEL } from './design-styles';

const StlViewer = dynamic(() => import('./StlViewer'), {
  ssr: false,
  loading: () => <div className="h-64 animate-pulse rounded-xl bg-white/[0.03]" aria-busy="true" />,
});

type Conn = 'connecting' | 'live' | 'reconnecting' | 'complete' | 'missing';

export function LiveBuild({ id }: { id: string }) {
  const [state, dispatch] = useReducer(liveReducer, LIVE_INITIAL);
  const [conn, setConn] = useState<Conn>(() => (typeof EventSource === 'undefined' ? 'missing' : 'connecting'));

  useEffect(() => {
    if (typeof EventSource === 'undefined') return;
    const es = new EventSource(liveStreamUrl(id));
    let finished = false;
    const onEvent = (m: MessageEvent) => {
      try {
        const e = JSON.parse(m.data) as LiveEvent;
        dispatch(e);
        if (e.type === 'done') { finished = true; setConn('complete'); es.close(); } else setConn('live');
      } catch { /* a malformed event is skipped, never guessed at */ }
    };
    for (const t of LIVE_EVENT_TYPES) es.addEventListener(t, onEvent as EventListener);
    es.onerror = () => { if (!finished) setConn(es.readyState === 2 ? 'missing' : 'reconnecting'); };
    return () => { es.close(); };
  }, [id]);

  const snap = latestSnapshot(state.events);
  const start = state.events.find((e) => e.type === 'start');
  const brief = typeof start?.initialState?.brief === 'string' ? start.initialState.brief : null;

  return (
    <div className="flex min-h-screen flex-col bg-[#040a13] text-slate-100" data-lens-theme="conkay">
      <DesignsHeader crumb={{ label: `${id} · live` }} />
      <main className="mx-auto flex w-full max-w-7xl flex-1 flex-col gap-4 p-3 sm:p-5">
        <Link href="/conkay/designs" className="flex w-fit items-center gap-1 text-xs text-slate-400 hover:text-slate-200">
          <ArrowLeft className="h-3 w-3" aria-hidden /> All designs
        </Link>
        <section className="flex flex-wrap items-center gap-3">
          <h1 className="text-xl font-semibold tracking-tight">Live build</h1>
          <ConnChip conn={conn} />
          {brief && <p className="text-sm text-slate-400" data-testid="live-brief">{brief}</p>}
        </section>
        {conn === 'missing' && state.events.length === 0 && (
          <p role="alert" className="text-sm text-rose-300">No live run with this id.</p>
        )}
        <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_420px]">
          <ol className="flex flex-col gap-3" data-testid="live-timeline" aria-live="polite">
            {state.events.filter((e) => e.type !== 'start').map((e) => <Step key={e.id} e={e} />)}
            {!state.done && state.events.length > 0 && (
              <li className="flex items-center gap-2 text-xs text-slate-400"><Loader2 className="h-3 w-3 animate-spin" aria-hidden /> waiting for the next step</li>
            )}
          </ol>
          <aside className={`${PANEL} flex h-fit flex-col gap-2`}>
            <h2 className="text-xs font-semibold uppercase tracking-wider text-slate-400">Body at this step</h2>
            {snap?.file ? (
              <>
                <StlViewer url={liveFileUrl(id, snap.file)} />
                <p className="font-mono text-[10px] text-slate-500" data-testid="live-snapshot">cad.body solid · {snap.triangles ?? '?'} triangles · sha256 {snap.sha256?.slice(0, 12)}</p>
              </>
            ) : <p className="text-xs text-slate-500">No solid yet.</p>}
          </aside>
        </div>
      </main>
    </div>
  );
}

function ConnChip({ conn }: { conn: Conn }) {
  const map: Record<Conn, [string, string]> = {
    connecting: ['Connecting', 'border-slate-400/25 text-slate-300'],
    live: ['Live', 'border-emerald-400/30 text-emerald-200'],
    reconnecting: ['Reconnecting · resumes where it left off', 'border-amber-400/30 text-amber-200'],
    complete: ['Complete', 'border-sky-400/30 text-sky-200'],
    missing: ['Unavailable', 'border-rose-400/35 text-rose-200'],
  };
  const [label, cls] = map[conn];
  return <span data-testid="live-conn" className={`inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-[11px] ${cls}`}><Radio className="h-3 w-3" aria-hidden />{label}</span>;
}

function Counts({ envelopes }: { envelopes?: Record<string, number> }) {
  if (!envelopes) return null;
  return (
    <span className="font-mono text-[11px] text-slate-400">
      {['PASS', 'WARN', 'FAIL', 'NOT_COMPUTED'].filter((k) => envelopes[k]).map((k) => `${k} ${envelopes[k]}`).join(' · ')}
    </span>
  );
}

function Step({ e }: { e: LiveEvent }) {
  if (e.type === 'evaluated') {
    return (
      <li className={PANEL} data-testid={`live-step-${e.id}`}>
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h3 className="text-sm font-medium">Initial design</h3>
          <Counts envelopes={e.envelopes} />
        </div>
        <Failing checks={e.failingChecks} />
      </li>
    );
  }
  if (e.type === 'iteration') {
    return (
      <li className={PANEL} data-testid={`live-step-${e.id}`}>
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h3 className="text-sm font-medium">Iteration {e.iteration}</h3>
          <Counts envelopes={e.envelopes} />
        </div>
        <Failing checks={e.failingChecks} />
        {e.candidates && e.candidates.length > 0 && <Candidates rows={e.candidates} chosen={e.change ?? null} />}
        {e.change ? (
          <p className="mt-2 flex items-start gap-1.5 text-sm text-slate-200" data-testid="live-change">
            <Wrench className="mt-0.5 h-3.5 w-3.5 shrink-0 text-sky-300" aria-hidden />
            <span><span className="font-medium">{e.change.label}</span> — {e.change.reason}{e.change.pickNote ? ` (${e.change.pickNote})` : ''}</span>
          </p>
        ) : (
          <p className="mt-2 text-sm text-rose-200">No candidate improves the failing checks without breaking another.</p>
        )}
        {e.rerunNodes && <p className="mt-1 text-[11px] text-slate-500">{e.rerunNodes.length} runs recomputed (their inputs changed)</p>}
      </li>
    );
  }
  if (e.type === 'done') return <Outcome e={e} />;
  return null;
}

function Failing({ checks }: { checks?: string[] }) {
  if (!checks?.length) return <p className="mt-1 text-xs text-emerald-200">No failing checks.</p>;
  return (
    <ul className="mt-2 flex flex-wrap gap-1" aria-label="failing checks">
      {checks.map((c) => <li key={c} className="rounded-md border border-rose-400/35 bg-rose-400/10 px-1.5 py-0.5 font-mono text-[11px] text-rose-200">{c}</li>)}
    </ul>
  );
}

function Candidates({ rows, chosen }: { rows: LiveCandidate[]; chosen: LiveEvent['change'] | null }) {
  return (
    <div className="mt-3 overflow-x-auto">
      <table className="w-full text-left text-xs" data-testid="live-candidates">
        <thead className="text-[10px] uppercase tracking-wider text-slate-500">
          <tr><th className="py-1 pr-3 font-medium">Candidate (run)</th><th className="pr-3 font-medium">Margin gain</th><th className="pr-3 font-medium">Δ mass</th><th className="font-medium">Result</th></tr>
        </thead>
        <tbody className="font-mono text-slate-300">
          {rows.map((c) => {
            const picked = chosen && chosen.rule === c.rule && chosen.value === c.value;
            return (
              <tr key={`${c.rule}:${String(c.value)}`} className={picked ? 'text-sky-200' : ''}>
                <td className="py-1 pr-3 font-sans">{picked ? '▸ ' : ''}{c.label}</td>
                <td className="pr-3">{c.gain.toFixed(3)}</td>
                <td className="pr-3">{c.dMassKg >= 0 ? '+' : ''}{c.dMassKg} kg</td>
                <td className="font-sans">{c.regressions.length ? `breaks ${c.regressions.join(', ')}` : c.fixes.length ? `clears ${c.fixes.join(', ')}` : 'improves'}</td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

function Outcome({ e }: { e: LiveEvent }) {
  const o = e.outcome;
  if (!o) return null;
  const pass = o.kind === 'all-pass';
  return (
    <li className={`${PANEL} ${pass ? 'border-emerald-400/25' : 'border-rose-400/30'}`} data-testid="live-outcome">
      <h3 className="flex items-center gap-1.5 text-sm font-medium">
        {pass ? <CheckCircle2 className="h-4 w-4 text-emerald-300" aria-hidden /> : <CircleSlash className="h-4 w-4 text-rose-300" aria-hidden />}
        {pass ? 'Every check passes' : o.kind === 'proven-infeasible' ? 'Proven infeasible' : 'Stopped: budget reached'}
      </h3>
      {pass && o.warnings && o.warnings.length > 0 && (
        <p className="mt-1 text-xs text-amber-200">Warnings kept: {o.warnings.join(', ')}</p>
      )}
      {o.binding && o.binding.length > 0 && (
        <ul className="mt-2 list-disc pl-5 text-xs text-slate-300">{o.binding.map((b, i) => <li key={i}>{b.why}</li>)}</ul>
      )}
      {o.requirementOptions && o.requirementOptions.length > 0 && (
        <div className="mt-2 text-xs text-slate-400">
          Requirement changes that would make it feasible (offered, not applied):
          <ul className="list-disc pl-5">{o.requirementOptions.map((r, i) => <li key={i}>{r.option}</li>)}</ul>
        </div>
      )}
      {e.receiptSha256 && <p className="mt-2 font-mono text-[10px] text-slate-500" data-testid="live-receipt">receipt {e.receiptSha256}</p>}
    </li>
  );
}
