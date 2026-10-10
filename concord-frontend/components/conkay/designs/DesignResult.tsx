'use client';

/**
 * DesignResult — /conkay/designs/[id]. One showcase design's precomputed
 * snapshot: disclaimers first, then the drawings / CAD model, solver checks
 * with margins, mass by state, every value with its status and source, and
 * what still needs physical testing. Read-only; nothing is solved here.
 */

import Link from 'next/link';
import { useEffect, useState } from 'react';
import { AlertTriangle, ArrowLeft, FlaskConical, Loader2, ShieldAlert } from 'lucide-react';
import { fetchDesign, type DesignSnapshot } from '@/lib/conkay/designs-api';
import { retryNotice } from '@/lib/conkay/demo-api';
import { DesignsHeader } from './DesignsHeader';
import { DrawingsPanel } from './DrawingsPanel';
import { ChecksPanel } from './ChecksPanel';
import { ValuesPanel } from './ValuesPanel';
import { MassPanel } from './MassPanel';
import { CHECK_LABEL, CHECK_STYLE, PANEL } from './design-styles';

export function DesignResult({ id }: { id: string }) {
  const [design, setDesign] = useState<DesignSnapshot | null>(null);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');

  useEffect(() => {
    let live = true;
    fetchDesign(id, (r) => live && setNotice(retryNotice(r))).then((r) => {
      if (!live) return;
      setNotice('');
      if ('error' in r) setError(r.error);
      else setDesign(r);
    });
    return () => { live = false; };
  }, [id]);

  return (
    <div className="flex min-h-screen flex-col bg-[#040a13] text-slate-100" data-lens-theme="conkay">
      <DesignsHeader crumb={{ label: design?.title || id }} />
      <main className="mx-auto flex w-full max-w-7xl flex-1 flex-col gap-4 p-3 sm:p-5">
        <Link href="/conkay/designs" className="flex w-fit items-center gap-1 text-xs text-slate-400 hover:text-slate-200">
          <ArrowLeft className="h-3 w-3" aria-hidden /> All designs
        </Link>
        {notice && <p role="status" className="flex items-center gap-1.5 text-xs text-amber-200"><Loader2 className="h-3 w-3 animate-spin" aria-hidden /> {notice}</p>}
        {error && <p role="alert" className="text-sm text-rose-300">{error}</p>}
        {!design && !error && <div className="h-64 animate-pulse rounded-2xl border border-white/5 bg-white/[0.02]" aria-busy="true" />}
        {design && <DesignBody d={design} />}
      </main>
    </div>
  );
}

function DesignBody({ d }: { d: DesignSnapshot }) {
  const nuclear = d.kind === 'nuclear';
  return (
    <>
      <section className="flex flex-col gap-2">
        <div className="flex flex-wrap items-center gap-2">
          <h1 className="text-xl font-semibold tracking-tight">{d.title}</h1>
          <span className={`rounded-md border px-2 py-0.5 text-[11px] ${CHECK_STYLE[d.headline.status] || CHECK_STYLE.NOT_COMPUTED}`}>
            {CHECK_LABEL[d.headline.status] || d.headline.status} · {String(d.headline.verdict).replace(/_/g, ' ')}
          </span>
        </div>
        <p className="max-w-4xl text-sm leading-relaxed text-slate-400">{d.brief}</p>
        <div
          role="note"
          className={`flex gap-2 rounded-xl border px-3 py-2 text-xs leading-relaxed ${nuclear ? 'border-rose-400/30 bg-rose-500/[0.07] text-rose-100' : 'border-amber-400/25 bg-amber-400/[0.06] text-amber-100'}`}
        >
          {nuclear ? <ShieldAlert className="mt-0.5 h-4 w-4 shrink-0" aria-hidden /> : <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" aria-hidden />}
          <ul className="space-y-0.5">{d.disclaimers.map((x) => <li key={x}>{x}</li>)}</ul>
        </div>
      </section>

      <DrawingsPanel designId={d.id} drawings={d.drawings} model3d={d.model3d} />

      <div className="grid gap-4 lg:grid-cols-[minmax(0,1.15fr)_minmax(0,0.85fr)]">
        <div className="flex min-w-0 flex-col gap-4">
          <ChecksPanel checks={d.checks} counts={d.checkCounts} perPartRuns={d.perPartRuns} />
          <ValuesPanel values={d.values} meaning={d.statusMeaning} />
        </div>
        <aside className="flex min-w-0 flex-col gap-4" aria-label="Mass, tests and caveats">
          {d.mass && <MassPanel mass={d.mass} meaning={d.statusMeaning} />}
          <section className={PANEL} aria-label="Still needs physical testing">
            <h2 className="flex items-center gap-1.5 text-sm font-semibold"><FlaskConical className="h-4 w-4 text-sky-300" aria-hidden /> Still needs physical testing</h2>
            <ol className="mt-2 list-decimal space-y-1.5 pl-4 text-xs leading-relaxed text-slate-300">{d.physicalTests.map((t) => <li key={t}>{t}</li>)}</ol>
          </section>
          {d.repairs && d.repairs.length > 0 && (
            <section className={PANEL} aria-label="Design repairs">
              <h2 className="text-sm font-semibold">Repairs the loop made</h2>
              <p className="mt-1 text-[11px] text-slate-500">Design parameters changed to clear a failing check; requirements were not changed.</p>
              <ul className="mt-2 space-y-1 text-xs text-slate-300">
                {d.repairs.map((r, i) => <li key={i}><span className="text-slate-500">{r.variable}:</span> {r.before} → {r.after}{r.result ? <span className="text-slate-500"> ({r.result})</span> : null}</li>)}
              </ul>
            </section>
          )}
          {(d.caveats.length > 0 || d.failures.length > 0) && (
            <section className={PANEL} aria-label="Caveats">
              <h2 className="text-sm font-semibold">Caveats and assumptions</h2>
              <ul className="mt-2 space-y-1.5 text-[11px] leading-relaxed text-slate-400">
                {d.failures.map((x) => <li key={x} className="text-rose-200">{x}</li>)}
                {d.caveats.map((x) => <li key={x}>{x}</li>)}
              </ul>
            </section>
          )}
          {d.reviewQueue && d.reviewQueue.length > 0 && (
            <section className={PANEL} aria-label="Pending human review">
              <h2 className="text-sm font-semibold">Pending human review ({d.reviewQueue.length})</h2>
              <ul className="mt-2 space-y-1.5 text-[11px] leading-relaxed text-slate-400">
                {d.reviewQueue.map((q) => <li key={q.id}><span className="font-mono text-slate-300">{q.id}</span> · {q.kind}{q.subject ? ` · ${q.subject}` : ''}{q.reason ? ` — ${q.reason}` : ''}</li>)}
              </ul>
            </section>
          )}
          <p className="px-1 font-mono text-[10px] text-slate-600" title={d.snapshotSha256}>snapshot {d.snapshotSha256.slice(0, 16)}… · {d.pipeline}</p>
        </aside>
      </div>
    </>
  );
}
