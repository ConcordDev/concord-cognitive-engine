'use client';

/**
 * DesignPane — what the workspace's centre shows when it is not the I-beam
 * study: the blank "What do you want to build?" start screen, a showcase
 * design (drawn with the designs page's own DrawingsPanel, so the car and
 * Sentinel use AssemblyViewer / StlViewer), or a truss / bracket / part the
 * class-problem solvers answered (POST /api/conkay/workbench, stage "solved").
 */

import Link from 'next/link';
import { Fragment, useEffect, useMemo, useState } from 'react';
import { ExternalLink, Loader2, Sparkles, X } from 'lucide-react';
import { fetchDesign, type DesignSnapshot } from '@/lib/conkay/designs-api';
import { DrawingsPanel } from '@/components/conkay/designs/DrawingsPanel';
import { START_EXAMPLES, type ShowcaseId } from '@/lib/conkay/new-design-intent';

export interface TrussAnswer {
  geometry: { joints: { id: string; x: number; y: number }[]; bars: { id: string; i: string; j: string }[]; supports?: unknown };
  forces: { id: string; i: string; j: string; lengthM: number; N: number; sense: 'tension' | 'compression' | 'zero' | string }[];
  reactions: { joint: string; Rx: number; Ry: number }[];
  maxDisplacementM?: number;
  note?: string;
  validity?: string;
}

export interface BriefClaim { field: string; label: string; value: unknown; display?: string | null; status: string; source?: string; note?: string }

export type WorkspaceDesign =
  | { kind: 'showcase'; id: ShowcaseId; label: string }
  | { kind: 'solved'; domain: string; prompt: string; answer: Record<string, unknown>; claims: BriefClaim[] };

const PANEL = 'rounded-2xl border border-sky-400/15 bg-[#060f1c]/90 p-3';

export function StartScreen({ onPick, onBeam, busy }: { onPick: (text: string) => void; onBeam: () => void; busy: boolean }) {
  return (
    <div className="absolute inset-0 z-30 flex flex-col items-center justify-center gap-4 bg-[#040a13]/95 p-6 text-center" data-testid="start-screen">
      <Sparkles className="h-6 w-6 text-sky-300" aria-hidden />
      <h2 className="text-lg font-semibold text-slate-100">What do you want to build?</h2>
      <p className="max-w-md text-xs leading-relaxed text-slate-400">
        Describe it in the box below, or start from one of these. Bridges and trusses, brackets and beams are solved here;
        the car, Sentinel M1, reactor and formulation open their showcase results.
      </p>
      <ul className="flex max-w-2xl flex-wrap justify-center gap-2">
        {START_EXAMPLES.map((t) => (
          <li key={t}>
            <button type="button" disabled={busy} onClick={() => onPick(t)} className="rounded-lg border border-white/10 bg-white/[0.03] px-3 py-1.5 text-left text-xs text-slate-200 hover:border-sky-400/40 hover:bg-sky-400/10 disabled:opacity-50">
              {t}
            </button>
          </li>
        ))}
      </ul>
      <button type="button" onClick={onBeam} className="text-xs text-sky-300 underline-offset-2 hover:underline">
        Start from a blank I-beam study
      </button>
    </div>
  );
}

function ShowcaseView({ id, label }: { id: ShowcaseId; label: string }) {
  const [design, setDesign] = useState<DesignSnapshot | null>(null);
  const [error, setError] = useState('');
  useEffect(() => {
    let live = true;
    void fetchDesign(id).then((r) => {
      if (!live) return;
      if ('error' in r) setError(r.error); else setDesign(r);
    });
    return () => { live = false; };
  }, [id]);
  if (error) return <p role="alert" className="text-sm text-rose-300">Could not open {label}: {error}</p>;
  if (!design) return <p className="flex items-center gap-2 text-sm text-slate-400"><Loader2 className="h-4 w-4 animate-spin" aria-hidden /> Opening {label}…</p>;
  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-wrap items-center gap-2">
        <h2 className="text-base font-semibold text-slate-100">{design.title}</h2>
        <span className="rounded-md border border-white/10 px-2 py-0.5 text-[11px] text-slate-300">{design.headline.status} · {String(design.headline.verdict).replace(/_/g, ' ')}</span>
        <Link href={`/conkay/designs/${design.id}`} className="ml-auto flex items-center gap-1 text-xs text-sky-300 hover:underline">
          Full result <ExternalLink className="h-3 w-3" aria-hidden />
        </Link>
      </div>
      <p className="text-xs leading-relaxed text-slate-400">{design.brief}</p>
      <p className="text-[11px] text-slate-500">A precomputed showcase result (nothing was re-solved for this message).</p>
      <DrawingsPanel designId={design.id} drawings={design.drawings} model3d={design.model3d} assembly={design.assembly} />
    </div>
  );
}

/** Elevation of the solved truss: tension blue, compression red, line width by |N|. */
export function TrussView({ answer }: { answer: TrussAnswer }) {
  const view = useMemo(() => {
    const js = answer.geometry.joints;
    const xs = js.map((j) => j.x), ys = js.map((j) => j.y);
    const minX = Math.min(...xs), maxX = Math.max(...xs), minY = Math.min(...ys), maxY = Math.max(...ys);
    const w = Math.max(maxX - minX, 1e-6), h = Math.max(maxY - minY, w / 12);
    const pad = w * 0.06;
    const yMid = (maxY + minY) / 2;
    const by = new Map(js.map((j) => [j.id, j]));
    const maxN = Math.max(1e-9, ...answer.forces.map((f) => Math.abs(f.N)));
    return { minX: minX - pad, minY: yMid - h / 2 - pad, w: w + 2 * pad, h: h + 2 * pad, yMid, by, maxN };
  }, [answer]);
  const tension = answer.forces.filter((f) => f.N > 1e-6).sort((a, b) => b.N - a.N)[0];
  const compression = answer.forces.filter((f) => f.N < -1e-6).sort((a, b) => a.N - b.N)[0];
  // SVG y grows downward: reflect about the truss's mid-height.
  const sy = (y: number) => 2 * view.yMid - y;
  return (
    <div className="flex flex-col gap-2">
      <svg viewBox={`${view.minX} ${view.minY} ${view.w} ${view.h}`} className="h-[42vh] min-h-[220px] w-full rounded-xl border border-white/10 bg-[#050d18]" role="img" aria-label="Truss elevation with bar forces">
        {answer.forces.map((f) => {
          const a = view.by.get(f.i), b = view.by.get(f.j);
          if (!a || !b) return null;
          const k = Math.abs(f.N) / view.maxN;
          return <line key={f.id} x1={a.x} y1={sy(a.y)} x2={b.x} y2={sy(b.y)} stroke={f.N > 1e-6 ? '#38bdf8' : f.N < -1e-6 ? '#fb7185' : '#64748b'} strokeWidth={view.w * (0.002 + 0.006 * k)} strokeLinecap="round"><title>{`${f.id}: ${(f.N / 1000).toFixed(2)} kN ${f.sense}`}</title></line>;
        })}
        {answer.geometry.joints.map((j) => <circle key={j.id} cx={j.x} cy={sy(j.y)} r={view.w * 0.006} fill="#e2e8f0" />)}
      </svg>
      <ul className="grid grid-cols-2 gap-2 text-xs text-slate-300 2xl:grid-cols-4">
        <li className={PANEL}>Max tension<br /><span className="font-mono text-sky-200">{tension ? `${(tension.N / 1000).toFixed(2)} kN (${tension.id})` : '—'}</span></li>
        <li className={PANEL}>Max compression<br /><span className="font-mono text-rose-200">{compression ? `${(compression.N / 1000).toFixed(2)} kN (${compression.id})` : '—'}</span></li>
        <li className={PANEL}>Reactions<br /><span className="font-mono">{answer.reactions.map((r) => `${r.joint} ${(r.Ry / 1000).toFixed(2)} kN`).join(' · ')}</span></li>
        <li className={PANEL}>Max displacement<br /><span className="font-mono">{answer.maxDisplacementM != null ? `${(answer.maxDisplacementM * 1000).toFixed(2)} mm` : '—'}</span></li>
      </ul>
      {answer.note && <p className="text-[11px] text-slate-500">{answer.note}{answer.validity ? `. Valid for: ${answer.validity}.` : ''}</p>}
    </div>
  );
}

function SolvedView({ d }: { d: Extract<WorkspaceDesign, { kind: 'solved' }> }) {
  const truss = d.domain === 'truss' && Array.isArray((d.answer as { forces?: unknown }).forces);
  const scalars = Object.entries(d.answer).filter(([, v]) => typeof v === 'number' || typeof v === 'string' || typeof v === 'boolean').slice(0, 16);
  return (
    <div className="flex flex-col gap-3">
      <h2 className="text-base font-semibold capitalize text-slate-100">{d.domain.replace('-', ' ')}</h2>
      <ul className="flex flex-wrap gap-1.5 text-[11px]">
        {d.claims.filter((c) => c.value != null).map((c) => (
          <li key={c.field} title={c.source} className={`rounded-md border px-2 py-0.5 ${c.status === 'default' ? 'border-amber-400/30 text-amber-100' : 'border-white/10 text-slate-300'}`}>
            {c.label}: {c.display ?? String(c.value)}{c.status === 'default' ? ' (default)' : ''}
          </li>
        ))}
      </ul>
      {truss ? <TrussView answer={d.answer as unknown as TrussAnswer} /> : (
        <dl className="grid grid-cols-2 gap-x-4 gap-y-1 text-xs">
          {scalars.map(([k, v]) => (
            <Fragment key={k}><dt className="text-slate-500">{k}</dt><dd className="font-mono text-slate-200">{String(v)}</dd></Fragment>
          ))}
        </dl>
      )}
    </div>
  );
}

export function DesignPane({ design, onClose }: { design: WorkspaceDesign; onClose: () => void }) {
  return (
    <div className="absolute inset-0 z-30 overflow-y-auto bg-[#040a13] p-3" data-testid="design-pane">
      <button type="button" onClick={onClose} aria-label="Back to the beam study" title="Back to the beam study" className="absolute right-3 top-3 z-10 rounded-md p-1.5 text-slate-300 hover:bg-white/10">
        <X className="h-4 w-4" aria-hidden />
      </button>
      {design.kind === 'showcase' ? <ShowcaseView id={design.id} label={design.label} /> : <SolvedView d={design} />}
    </div>
  );
}
