'use client';

/**
 * DesignsIndex — /conkay/designs. One card per showcase design, read from the
 * precomputed snapshots (no solve on page load). A design whose snapshot is
 * not built says so instead of showing a card with nothing behind it.
 */

import Link from 'next/link';
import { useEffect, useState } from 'react';
import { Atom, Bot, Car, FlaskConical, Layers, Loader2, Box, FileText } from 'lucide-react';
import { CHECK_STATUSES, fetchDesigns, type DesignSummary } from '@/lib/conkay/designs-api';
import { retryNotice } from '@/lib/conkay/demo-api';
import { DesignsHeader } from './DesignsHeader';
import { CHECK_LABEL, CHECK_STYLE } from './design-styles';

const KIND_ICON: Record<string, typeof Car> = { vehicle: Car, robot: Bot, material: Layers, mixture: FlaskConical, nuclear: Atom };

export function DesignsIndex({ embedded = false, onOpen }: { embedded?: boolean; onOpen?: (id: string) => void } = {}) {
  const [designs, setDesigns] = useState<DesignSummary[] | null>(null);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');

  useEffect(() => {
    let live = true;
    fetchDesigns((r) => live && setNotice(retryNotice(r))).then((r) => {
      if (!live) return;
      setNotice('');
      if ('error' in r) setError(r.error);
      else setDesigns(r);
    });
    return () => { live = false; };
  }, []);

  const body = (
      <main className={embedded ? 'w-full' : 'mx-auto w-full max-w-6xl flex-1 p-4 sm:p-6'}>
        <h1 className="text-xl font-semibold tracking-tight">Showcase designs</h1>
        <p className="mt-1 max-w-3xl text-sm leading-relaxed text-slate-400">
          Each design was run once through ConKay&apos;s real pipeline and saved as a snapshot. Every check shows its
          margin, every value shows whether it is sourced, measured, computed, estimated, a design input or unknown, and
          what still needs a physical test. Software screening, not physical validation.
        </p>
        {notice && <p role="status" className="mt-4 flex items-center gap-1.5 text-xs text-amber-200"><Loader2 className="h-3 w-3 animate-spin" aria-hidden /> {notice}</p>}
        {error && <p role="alert" className="mt-4 text-sm text-rose-300">{error}</p>}
        {!designs && !error && (
          <div className="mt-6 grid gap-3 sm:grid-cols-2 lg:grid-cols-3" aria-busy="true">
            {[0, 1, 2].map((i) => <div key={i} className="h-40 animate-pulse rounded-2xl border border-white/5 bg-white/[0.02]" />)}
          </div>
        )}
        {designs && (
          <ul className="mt-6 grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {designs.map((d) => <DesignCard key={d.id} d={d} onOpen={onOpen} />)}
          </ul>
        )}
      </main>
  );
  if (embedded) return body;
  return (
    <div className="flex min-h-screen flex-col bg-[#040a13] text-slate-100" data-lens-theme="conkay">
      <DesignsHeader />
      {body}
    </div>
  );
}

function DesignCard({ d, onOpen }: { d: DesignSummary; onOpen?: (id: string) => void }) {
  const Icon = KIND_ICON[d.kind] || Box;
  if (!d.available) {
    return (
      <li className="rounded-2xl border border-dashed border-white/10 p-4 text-sm text-slate-500">
        <p className="flex items-center gap-2 font-medium text-slate-300"><Icon className="h-4 w-4" aria-hidden /> {d.title}</p>
        <p className="mt-2 text-xs">Snapshot not built on this server.</p>
      </li>
    );
  }
  return (
    <li>
      <CardLink
        id={d.id}
        onOpen={onOpen}
        className="group flex h-full w-full flex-col rounded-2xl text-left border border-white/10 bg-gradient-to-b from-white/[0.04] to-transparent p-4 transition-colors hover:border-sky-400/40 focus:outline-none focus-visible:ring-2 focus-visible:ring-sky-400/60"
      >
        <span className="flex items-center gap-2 text-sm font-medium text-slate-100">
          <Icon className="h-4 w-4 text-sky-300" aria-hidden /> {d.title}
        </span>
        <span className="mt-2 line-clamp-2 text-xs leading-relaxed text-slate-400">{d.brief}</span>
        <span className="mt-auto flex flex-wrap items-center gap-1.5 pt-3">
          {CHECK_STATUSES.filter((s) => (d.checkCounts?.[s] || 0) > 0).map((s) => (
            <span key={s} className={`rounded-md border px-1.5 py-0.5 text-[10px] tabular-nums ${CHECK_STYLE[s]}`}>
              {d.checkCounts?.[s]} {CHECK_LABEL[s].toLowerCase()}
            </span>
          ))}
          {d.hasDrawings && <span className="flex items-center gap-1 text-[10px] text-slate-400"><FileText className="h-3 w-3" aria-hidden /> drawings</span>}
          {d.hasModel3d && <span className="flex items-center gap-1 text-[10px] text-slate-400"><Box className="h-3 w-3" aria-hidden /> 3D</span>}
        </span>
      </CardLink>
    </li>
  );
}

/** A link to the design page, or — inside the Workshop — a button that opens it on the table. */
function CardLink({ id, onOpen, className, children }: { id: string; onOpen?: (id: string) => void; className: string; children: React.ReactNode }) {
  if (onOpen) return <button type="button" onClick={() => onOpen(id)} className={className}>{children}</button>;
  return <Link href={`/conkay/designs/${id}`} className={className}>{children}</Link>;
}
