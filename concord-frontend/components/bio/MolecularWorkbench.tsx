'use client';

/**
 * MolecularWorkbench — Benchling/SnapGene-parity surface.
 * Wires the 7 backlog macros end-to-end:
 *   plasmid-map · align-multiple · cloning-simulate · translate-orf
 *   blast-search · crispr-design · notebook-{create,list,update,delete}
 * Every value rendered comes from a real bio.* macro response.
 */

import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  Loader2, Dna, GitMerge, Scissors, FlaskConical, Search, Crosshair,
  NotebookPen, Plus, Trash2, Save, AlertTriangle, Check,
} from 'lucide-react';
import { lensRun } from '@/lib/api/client';
import { cn } from '@/lib/utils';

type WBTab = 'plasmid' | 'msa' | 'cloning' | 'orf' | 'blast' | 'crispr' | 'notebook';

const TABS: { id: WBTab; label: string; icon: typeof Dna }[] = [
  { id: 'plasmid', label: 'Plasmid map', icon: Dna },
  { id: 'msa', label: 'MSA', icon: GitMerge },
  { id: 'cloning', label: 'In-silico cloning', icon: FlaskConical },
  { id: 'orf', label: 'ORF / translate', icon: Scissors },
  { id: 'blast', label: 'BLAST search', icon: Search },
  { id: 'crispr', label: 'CRISPR guides', icon: Crosshair },
  { id: 'notebook', label: 'Lab notebook', icon: NotebookPen },
];

function btn(extra?: string) {
  return cn(
    'inline-flex items-center gap-1.5 px-3 py-1.5 rounded-md border border-emerald-500/40',
    'bg-emerald-500/15 text-xs text-emerald-100 hover:bg-emerald-500/25',
    'disabled:opacity-40 disabled:cursor-not-allowed transition', extra,
  );
}
const ta = 'w-full px-2 py-1.5 text-xs bg-black/40 border border-white/10 rounded text-gray-100 font-mono resize-none';
const inp = 'px-2 py-1.5 text-xs bg-black/40 border border-white/10 rounded text-gray-100';

function Err({ msg }: { msg: string }) {
  return (
    <div className="flex items-center gap-2 px-2.5 py-1.5 rounded border border-rose-500/30 bg-rose-500/10 text-[11px] text-rose-300">
      <AlertTriangle className="w-3 h-3 shrink-0" /> {msg}
    </div>
  );
}

export function MolecularWorkbench() {
  const [tab, setTab] = useState<WBTab>('plasmid');
  return (
    <div className="rounded-xl border border-emerald-500/20 bg-zinc-950/60">
      <header className="flex items-center gap-2 px-4 py-3 border-b border-white/10">
        <Dna className="w-4 h-4 text-emerald-400" />
        <h3 className="text-sm font-semibold text-white">Molecular Workbench</h3>
        <span className="rounded bg-zinc-800 px-1.5 py-0.5 font-mono text-[10px] uppercase tracking-wider text-zinc-400">
          plasmid · MSA · cloning · ORF · BLAST · CRISPR
        </span>
      </header>
      <nav className="flex items-center gap-1 px-3 py-2 border-b border-white/10 overflow-x-auto">
        {TABS.map((t) => {
          const Icon = t.icon;
          const active = tab === t.id;
          return (
            <button key={t.id} type="button" onClick={() => setTab(t.id)}
              className={cn(
                'inline-flex items-center gap-1.5 px-2.5 py-1 text-xs rounded transition flex-shrink-0',
                active
                  ? 'bg-emerald-500/15 text-emerald-200 border border-emerald-500/40'
                  : 'text-gray-400 hover:text-gray-200 border border-transparent',
              )}>
              <Icon className="w-3 h-3" /> {t.label}
            </button>
          );
        })}
      </nav>
      <div className="p-4">
        {tab === 'plasmid' && <PlasmidTab />}
        {tab === 'msa' && <MsaTab />}
        {tab === 'cloning' && <CloningTab />}
        {tab === 'orf' && <OrfTab />}
        {tab === 'blast' && <BlastTab />}
        {tab === 'crispr' && <CrisprTab />}
        {tab === 'notebook' && <NotebookTab />}
      </div>
    </div>
  );
}

/* ─────────────── Plasmid / construct map viewer ─────────────── */

interface RingFeature {
  name: string; type: string; start: number; end: number;
  strand: string; length: number; startDeg: number; endDeg: number;
}
interface PlasmidResult {
  length: number; gcPercent: number; topology: string;
  featureCount: number; features: RingFeature[]; summary: string;
}
const FEATURE_COLOR: Record<string, string> = {
  CDS: '#22c55e', restriction_site: '#f59e0b', misc_feature: '#60a5fa',
};

function PlasmidTab() {
  const [seq, setSeq] = useState('');
  const [topology, setTopology] = useState<'circular' | 'linear'>('circular');
  const [res, setRes] = useState<PlasmidResult | null>(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const run = useCallback(async () => {
    setBusy(true); setErr(null);
    const r = await lensRun<PlasmidResult>('bio', 'plasmid-map', { sequence: seq, topology });
    if (r.data.ok && r.data.result) setRes(r.data.result);
    else { setRes(null); setErr(r.data.error || 'plasmid-map failed'); }
    setBusy(false);
  }, [seq, topology]);

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-2">
        <select value={topology} onChange={(e) => setTopology(e.target.value as 'circular' | 'linear')} className={inp}>
          <option value="circular">Circular</option>
          <option value="linear">Linear</option>
        </select>
        <button type="button" className={btn()} disabled={busy || !seq.trim()} onClick={run}>
          {busy ? <Loader2 className="w-3 h-3 animate-spin" /> : <Dna className="w-3 h-3" />} Build map
        </button>
        <span className="text-[10px] text-gray-400">Auto-annotates ORFs + restriction sites if no features supplied.</span>
      </div>
      <textarea value={seq} onChange={(e) => setSeq(e.target.value)} rows={4} placeholder="Paste construct DNA (ACGTN)…" className={ta} />
      {err && <Err msg={err} />}
      {res && (
        <div className="grid md:grid-cols-2 gap-3">
          <PlasmidRing res={res} />
          <div className="space-y-2">
            <div className="grid grid-cols-3 gap-2 text-xs">
              <Stat label="Length" value={`${res.length} bp`} />
              <Stat label="GC%" value={`${res.gcPercent}`} />
              <Stat label="Features" value={`${res.featureCount}`} />
            </div>
            <div className="border border-white/10 rounded max-h-56 overflow-y-auto">
              <table className="w-full text-[11px]">
                <thead className="bg-black/40 text-gray-400 uppercase text-[9px] sticky top-0">
                  <tr><th className="text-left px-2 py-1">Feature</th><th className="text-left px-2 py-1">Type</th><th className="text-right px-2 py-1">Span</th></tr>
                </thead>
                <tbody>
                  {res.features.map((f, i) => (
                    <tr key={i} className="border-t border-white/5">
                      <td className="px-2 py-1 text-gray-200 flex items-center gap-1.5">
                        <span className="w-2 h-2 rounded-full" style={{ background: FEATURE_COLOR[f.type] || '#a78bfa' }} />
                        {f.name}
                      </td>
                      <td className="px-2 py-1 text-gray-400">{f.type}</td>
                      <td className="px-2 py-1 text-right font-mono text-gray-300">{f.start}–{f.end}{f.strand}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

function PlasmidRing({ res }: { res: PlasmidResult }) {
  const R = 84, CX = 110, CY = 110;
  const arcs = useMemo(() => res.features.map((f, i) => {
    const a0 = (f.startDeg - 90) * (Math.PI / 180);
    const a1 = (Math.max(f.endDeg, f.startDeg + 0.6) - 90) * (Math.PI / 180);
    const large = (f.endDeg - f.startDeg) > 180 ? 1 : 0;
    const x0 = CX + R * Math.cos(a0), y0 = CY + R * Math.sin(a0);
    const x1 = CX + R * Math.cos(a1), y1 = CY + R * Math.sin(a1);
    const mid = (a0 + a1) / 2;
    return {
      key: i, name: f.name,
      d: `M ${x0.toFixed(1)} ${y0.toFixed(1)} A ${R} ${R} 0 ${large} 1 ${x1.toFixed(1)} ${y1.toFixed(1)}`,
      color: FEATURE_COLOR[f.type] || '#a78bfa',
      lx: CX + (R + 14) * Math.cos(mid), ly: CY + (R + 14) * Math.sin(mid),
    };
  }), [res.features]);
  return (
    <div className="flex items-center justify-center rounded border border-white/10 bg-black/20 p-2">
      <svg width="220" height="220" viewBox="0 0 220 220">
        <circle cx={CX} cy={CY} r={R} fill="none" stroke="#2a3340" strokeWidth="6" />
        {arcs.map((a) => (
          <g key={a.key}>
            <path d={a.d} fill="none" stroke={a.color} strokeWidth="8" strokeLinecap="round" />
            <text x={a.lx} y={a.ly} fontSize="7" fill="#9ca3af" textAnchor="middle" dominantBaseline="middle">
              {a.name.length > 14 ? a.name.slice(0, 13) + '…' : a.name}
            </text>
          </g>
        ))}
        <text x={CX} y={CY - 4} fontSize="11" fill="#e5e7eb" textAnchor="middle" fontWeight="bold">{res.length} bp</text>
        <text x={CX} y={CY + 9} fontSize="8" fill="#6b7280" textAnchor="middle">{res.topology}</text>
      </svg>
    </div>
  );
}

/* ─────────────── Multiple sequence alignment ─────────────── */

interface MsaRow { id: string; aligned: string }
interface MsaResult {
  rows: MsaRow[]; consensus: string; conservation: number[];
  width: number; sequenceCount: number; centerSequence: string;
  conservedColumns: number; percentConserved: number;
}

function MsaTab() {
  const [raw, setRaw] = useState('');
  const [res, setRes] = useState<MsaResult | null>(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const run = useCallback(async () => {
    setBusy(true); setErr(null);
    // FASTA-ish parse: > headers, sequence lines until next header.
    const sequences: { id: string; sequence: string }[] = [];
    let cur: { id: string; sequence: string } | null = null;
    for (const line of raw.split(/\r?\n/)) {
      if (line.startsWith('>')) {
        if (cur) sequences.push(cur);
        cur = { id: line.slice(1).trim().split(/\s+/)[0] || `seq${sequences.length + 1}`, sequence: '' };
      } else if (cur) cur.sequence += line.replace(/\s/g, '');
    }
    if (cur) sequences.push(cur);
    if (sequences.length < 2) { setErr('Provide ≥2 FASTA records (each starts with >).'); setBusy(false); return; }
    const r = await lensRun<MsaResult>('bio', 'align-multiple', { sequences });
    if (r.data.ok && r.data.result) setRes(r.data.result);
    else { setRes(null); setErr(r.data.error || 'align-multiple failed'); }
    setBusy(false);
  }, [raw]);

  const consColor = (pct: number) => pct >= 100 ? '#22c55e' : pct >= 60 ? '#eab308' : pct > 0 ? '#f97316' : '#3f3f46';

  return (
    <div className="space-y-3">
      <button type="button" className={btn()} disabled={busy || !raw.trim()} onClick={run}>
        {busy ? <Loader2 className="w-3 h-3 animate-spin" /> : <GitMerge className="w-3 h-3" />} Align (center-star progressive)
      </button>
      <textarea value={raw} onChange={(e) => setRaw(e.target.value)} rows={5}
        placeholder={'>seq1\nATGCATGC\n>seq2\nATGGATGC\n>seq3\nATGCATTC'} className={ta} />
      {err && <Err msg={err} />}
      {res && (
        <div className="space-y-2">
          <div className="grid grid-cols-4 gap-2 text-xs">
            <Stat label="Sequences" value={`${res.sequenceCount}`} />
            <Stat label="Width" value={`${res.width}`} />
            <Stat label="Conserved cols" value={`${res.conservedColumns}`} />
            <Stat label="% conserved" value={`${res.percentConserved}`} />
          </div>
          <div className="border border-white/10 rounded bg-black/30 p-2 overflow-x-auto">
            <div className="font-mono text-[10px] leading-tight whitespace-pre">
              {res.rows.map((row) => (
                <div key={row.id} className="flex">
                  <span className="text-emerald-400 w-20 shrink-0 truncate pr-2">{row.id}</span>
                  <span className="text-gray-200">
                    {row.aligned.split('').map((ch, i) => (
                      <span key={i} style={{ color: ch === '-' ? '#52525b' : (res.consensus[i]?.toUpperCase() === ch ? '#86efac' : '#fca5a5') }}>{ch}</span>
                    ))}
                  </span>
                </div>
              ))}
              <div className="flex mt-1">
                <span className="text-cyan-400 w-20 shrink-0 truncate pr-2">consensus</span>
                <span className="text-cyan-200">{res.consensus}</span>
              </div>
              <div className="flex">
                <span className="w-20 shrink-0 pr-2 text-gray-600">conserv.</span>
                <span className="flex">
                  {res.conservation.map((c, i) => (
                    <span key={i} title={`${c}%`} className="inline-block" style={{ width: '0.6em', height: '4px', background: consColor(c) }} />
                  ))}
                </span>
              </div>
            </div>
          </div>
          <p className="text-[10px] text-gray-400">Center sequence: <span className="font-mono text-gray-300">{res.centerSequence}</span></p>
        </div>
      )}
    </div>
  );
}

/* ─────────────── In-silico cloning / assembly ─────────────── */

interface Junction { between: [string, string]; overlapBp?: number; scar?: string; verified: boolean }
interface CloningResult {
  method: string; circular: boolean; fragmentCount: number;
  assembledLength: number; assembledSequence: string; truncated: boolean;
  gcPercent: number; junctions: Junction[]; issues: string[];
  success: boolean; summary: string;
}

function CloningTab() {
  const [method, setMethod] = useState<'gibson' | 'goldengate' | 'restriction'>('gibson');
  const [circular, setCircular] = useState(true);
  const [frags, setFrags] = useState<{ name: string; sequence: string }[]>([
    { name: 'fragment1', sequence: '' }, { name: 'fragment2', sequence: '' },
  ]);
  const [res, setRes] = useState<CloningResult | null>(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const run = useCallback(async () => {
    setBusy(true); setErr(null);
    const fragments = frags.filter((f) => f.sequence.trim());
    const r = await lensRun<CloningResult>('bio', 'cloning-simulate', { method, circular, fragments });
    if (r.data.ok && r.data.result) setRes(r.data.result);
    else { setRes(null); setErr(r.data.error || 'cloning-simulate failed'); }
    setBusy(false);
  }, [method, circular, frags]);

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-2">
        <select value={method} onChange={(e) => setMethod(e.target.value as typeof method)} className={inp}>
          <option value="gibson">Gibson assembly</option>
          <option value="goldengate">Golden Gate</option>
          <option value="restriction">Restriction ligation</option>
        </select>
        <label className="flex items-center gap-1.5 text-[11px] text-gray-300">
          <input type="checkbox" checked={circular} onChange={(e) => setCircular(e.target.checked)} /> Circular product
        </label>
        <button type="button" className={btn()} onClick={() => setFrags((f) => [...f, { name: `fragment${f.length + 1}`, sequence: '' }])}>
          <Plus className="w-3 h-3" /> Add fragment
        </button>
        <button type="button" className={btn()} disabled={busy} onClick={run}>
          {busy ? <Loader2 className="w-3 h-3 animate-spin" /> : <FlaskConical className="w-3 h-3" />} Simulate assembly
        </button>
      </div>
      <div className="space-y-2">
        {frags.map((f, i) => (
          <div key={i} className="flex gap-2 items-start">
            <input value={f.name} onChange={(e) => setFrags((p) => p.map((x, j) => j === i ? { ...x, name: e.target.value } : x))}
              className={cn(inp, 'w-32 shrink-0')} placeholder="name" />
            <textarea value={f.sequence} onChange={(e) => setFrags((p) => p.map((x, j) => j === i ? { ...x, sequence: e.target.value } : x))}
              rows={2} className={ta} placeholder="fragment DNA…" />
            {frags.length > 2 && (
              <button aria-label="Delete" type="button" onClick={() => setFrags((p) => p.filter((_, j) => j !== i))}
                className="p-1.5 text-gray-600 hover:text-rose-300"><Trash2 className="w-3.5 h-3.5" /></button>
            )}
          </div>
        ))}
      </div>
      {err && <Err msg={err} />}
      {res && (
        <div className="rounded border border-emerald-500/20 bg-emerald-500/5 p-3 space-y-2">
          <div className="grid grid-cols-4 gap-2 text-xs">
            <Stat label="Method" value={res.method} />
            <Stat label="Assembled" value={`${res.assembledLength} bp`} />
            <Stat label="GC%" value={`${res.gcPercent}`} />
            <Stat label="Status" value={res.success ? 'clean' : `${res.issues.length} issue(s)`} />
          </div>
          <div>
            <p className="text-[10px] uppercase tracking-wider text-gray-400 mb-1">Junctions</p>
            {res.junctions.map((j, i) => (
              <p key={i} className="text-[11px] font-mono">
                <span className={j.verified ? 'text-emerald-300' : 'text-rose-300'}>{j.verified ? '✓' : '✗'}</span>{' '}
                {j.between[0]} → {j.between[1]} · {j.overlapBp != null ? `${j.overlapBp} bp overlap` : j.scar}
              </p>
            ))}
          </div>
          {res.issues.length > 0 && res.issues.map((iss, i) => <Err key={i} msg={iss} />)}
          <details>
            <summary className="text-[11px] text-gray-400 cursor-pointer">Assembled sequence ({res.assembledLength} bp{res.truncated ? ', truncated' : ''})</summary>
            <pre className="text-[10px] font-mono text-gray-400 mt-1 whitespace-pre-wrap break-all max-h-32 overflow-y-auto">{res.assembledSequence}</pre>
          </details>
        </div>
      )}
    </div>
  );
}

/* ─────────────── ORF / translation viewer ─────────────── */

interface Codon { codon: string; aa: string; start: number; isStart: boolean; isStop: boolean }
interface OrfFrame {
  frame: number; strand: string; codons: Codon[]; protein: string;
  longestOrf: { codonStart: number; codonCount: number; peptide: string } | null;
}
interface OrfResult {
  length: number; frames: OrfFrame[];
  longestOrf: { frame: number; codonStart: number; codonCount: number; peptide: string } | null;
}

function OrfTab() {
  const [seq, setSeq] = useState('');
  const [res, setRes] = useState<OrfResult | null>(null);
  const [activeFrame, setActiveFrame] = useState(0);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const run = useCallback(async () => {
    setBusy(true); setErr(null);
    const r = await lensRun<OrfResult>('bio', 'translate-orf', { sequence: seq });
    if (r.data.ok && r.data.result) { setRes(r.data.result); setActiveFrame(0); }
    else { setRes(null); setErr(r.data.error || 'translate-orf failed'); }
    setBusy(false);
  }, [seq]);

  const frame = res?.frames[activeFrame];

  return (
    <div className="space-y-3">
      <button type="button" className={btn()} disabled={busy || !seq.trim()} onClick={run}>
        {busy ? <Loader2 className="w-3 h-3 animate-spin" /> : <Scissors className="w-3 h-3" />} Translate (6 frames)
      </button>
      <textarea value={seq} onChange={(e) => setSeq(e.target.value)} rows={4} placeholder="Paste DNA/RNA (ACGTUN)…" className={ta} />
      {err && <Err msg={err} />}
      {res && (
        <div className="space-y-2">
          {res.longestOrf && (
            <div className="rounded border border-emerald-500/30 bg-emerald-500/10 p-2 text-[11px] text-emerald-200">
              Longest ORF: frame {res.longestOrf.frame}, {res.longestOrf.codonCount} codons →{' '}
              <span className="font-mono break-all">{res.longestOrf.peptide}</span>
            </div>
          )}
          <div className="flex gap-1 flex-wrap">
            {res.frames.map((f, i) => (
              <button key={i} type="button" onClick={() => setActiveFrame(i)}
                className={cn('px-2 py-1 text-[11px] rounded border',
                  activeFrame === i ? 'bg-emerald-500/15 border-emerald-500/40 text-emerald-200' : 'border-white/10 text-gray-400')}>
                Frame {f.frame > 0 ? `+${f.frame}` : f.frame}
                {f.longestOrf ? <span className="text-emerald-400 ml-1">({f.longestOrf.codonCount}c)</span> : null}
              </button>
            ))}
          </div>
          {frame && (
            <div className="border border-white/10 rounded bg-black/30 p-2 overflow-x-auto">
              <div className="flex flex-wrap gap-x-0.5 gap-y-1 font-mono text-[10px]">
                {frame.codons.map((c, i) => {
                  const inOrf = frame.longestOrf
                    && i >= frame.longestOrf.codonStart
                    && i < frame.longestOrf.codonStart + frame.longestOrf.codonCount;
                  return (
                    <span key={i} title={`pos ${c.start} · ${c.codon}`}
                      className={cn('inline-flex flex-col items-center px-0.5 rounded',
                        c.isStart && 'bg-emerald-500/30',
                        c.isStop && 'bg-rose-500/30',
                        inOrf && !c.isStart && !c.isStop && 'bg-emerald-500/10')}>
                      <span className="text-gray-400">{c.codon}</span>
                      <span className={cn(c.isStop ? 'text-rose-300' : c.isStart ? 'text-emerald-300' : 'text-gray-200')}>{c.aa}</span>
                    </span>
                  );
                })}
              </div>
              <p className="text-[10px] text-gray-400 mt-2">
                Peptide ({frame.protein.length} aa): <span className="font-mono text-gray-300 break-all">{frame.protein}</span>
              </p>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

/* ─────────────── BLAST-style homology search ─────────────── */

interface BlastHit {
  subjectId: string; score: number; bitScore: number; eValue: number;
  identity: number; alignLength: number;
  queryRange: [number, number]; subjectRange: [number, number]; coverage: number;
}
interface BlastResult {
  queryLength: number; databaseSize: number; hitCount: number;
  hits: BlastHit[]; topHit: BlastHit | null; message?: string;
}

function BlastTab() {
  const [query, setQuery] = useState('');
  const [dbRaw, setDbRaw] = useState('');
  const [res, setRes] = useState<BlastResult | null>(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const run = useCallback(async () => {
    setBusy(true); setErr(null);
    const input: Record<string, unknown> = { query };
    if (dbRaw.trim()) {
      const database: { id: string; sequence: string }[] = [];
      let cur: { id: string; sequence: string } | null = null;
      for (const line of dbRaw.split(/\r?\n/)) {
        if (line.startsWith('>')) {
          if (cur) database.push(cur);
          cur = { id: line.slice(1).trim().split(/\s+/)[0] || `subject${database.length + 1}`, sequence: '' };
        } else if (cur) cur.sequence += line.replace(/\s/g, '');
      }
      if (cur) database.push(cur);
      if (database.length) input.database = database;
    }
    const r = await lensRun<BlastResult>('bio', 'blast-search', input);
    if (r.data.ok && r.data.result) setRes(r.data.result);
    else { setRes(null); setErr(r.data.error || 'blast-search failed'); }
    setBusy(false);
  }, [query, dbRaw]);

  return (
    <div className="space-y-3">
      <button type="button" className={btn()} disabled={busy || !query.trim()} onClick={run}>
        {busy ? <Loader2 className="w-3 h-3 animate-spin" /> : <Search className="w-3 h-3" />} Search homology
      </button>
      <div>
        <label className="text-[10px] uppercase tracking-wider text-gray-400">Query (≥8 residues)</label>
        <textarea value={query} onChange={(e) => setQuery(e.target.value)} rows={2} className={cn(ta, 'mt-1')} />
      </div>
      <div>
        <label className="text-[10px] uppercase tracking-wider text-gray-400">Database FASTA (optional — falls back to your saved sequences)</label>
        <textarea value={dbRaw} onChange={(e) => setDbRaw(e.target.value)} rows={4}
          placeholder={'>subject1\nATGC…\n>subject2\nGGCC…'} className={cn(ta, 'mt-1')} />
      </div>
      {err && <Err msg={err} />}
      {res && (
        <div className="space-y-2">
          {res.message && <p className="text-[11px] text-gray-400">{res.message}</p>}
          <div className="grid grid-cols-3 gap-2 text-xs">
            <Stat label="Query len" value={`${res.queryLength}`} />
            <Stat label="DB size" value={`${res.databaseSize}`} />
            <Stat label="Hits" value={`${res.hitCount}`} />
          </div>
          {res.hits.length > 0 && (
            <div className="border border-white/10 rounded overflow-x-auto">
              <table className="w-full text-[11px]">
                <thead className="bg-black/40 text-gray-400 uppercase text-[9px]">
                  <tr>
                    <th className="text-left px-2 py-1">Subject</th>
                    <th className="text-right px-2 py-1">Bit</th>
                    <th className="text-right px-2 py-1">E-value</th>
                    <th className="text-right px-2 py-1">Ident%</th>
                    <th className="text-right px-2 py-1">Cover%</th>
                    <th className="text-right px-2 py-1">Aln len</th>
                  </tr>
                </thead>
                <tbody>
                  {res.hits.map((h, i) => (
                    <tr key={i} className="border-t border-white/5">
                      <td className="px-2 py-1 text-gray-200">{h.subjectId}</td>
                      <td className="px-2 py-1 text-right font-mono text-emerald-300">{h.bitScore}</td>
                      <td className="px-2 py-1 text-right font-mono text-gray-400">{h.eValue}</td>
                      <td className="px-2 py-1 text-right font-mono text-gray-300">{h.identity}</td>
                      <td className="px-2 py-1 text-right font-mono text-gray-300">{h.coverage}</td>
                      <td className="px-2 py-1 text-right font-mono text-gray-400">{h.alignLength}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

/* ─────────────── CRISPR guide-RNA design ─────────────── */

interface Guide {
  guide: string; pam: string; strand: string; position: number;
  gcPercent: number; onTargetScore: number;
  offTargetHits: number; specificityScore: number; compositeScore: number;
}
interface CrisprResult {
  pam: string; targetLength: number; guideCount: number;
  guides: Guide[]; topGuide: Guide; message?: string;
}

function CrisprTab() {
  const [seq, setSeq] = useState('');
  const [res, setRes] = useState<CrisprResult | null>(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const run = useCallback(async () => {
    setBusy(true); setErr(null);
    const r = await lensRun<CrisprResult>('bio', 'crispr-design', { sequence: seq });
    if (r.data.ok && r.data.result) setRes(r.data.result);
    else { setRes(null); setErr(r.data.error || 'crispr-design failed'); }
    setBusy(false);
  }, [seq]);

  const scoreColor = (s: number) => s >= 75 ? 'text-emerald-300' : s >= 50 ? 'text-yellow-300' : 'text-rose-300';

  return (
    <div className="space-y-3">
      <button type="button" className={btn()} disabled={busy || !seq.trim()} onClick={run}>
        {busy ? <Loader2 className="w-3 h-3 animate-spin" /> : <Crosshair className="w-3 h-3" />} Design guides (SpCas9 NGG)
      </button>
      <textarea value={seq} onChange={(e) => setSeq(e.target.value)} rows={4} placeholder="Paste target DNA (≥30 bp)…" className={ta} />
      {err && <Err msg={err} />}
      {res && (
        <div className="space-y-2">
          {res.message && <p className="text-[11px] text-gray-400">{res.message}</p>}
          <div className="grid grid-cols-3 gap-2 text-xs">
            <Stat label="PAM" value={res.pam} />
            <Stat label="Target" value={`${res.targetLength} bp`} />
            <Stat label="Guides" value={`${res.guideCount}`} />
          </div>
          {res.guides.length > 0 && (
            <div className="border border-white/10 rounded overflow-x-auto">
              <table className="w-full text-[11px]">
                <thead className="bg-black/40 text-gray-400 uppercase text-[9px]">
                  <tr>
                    <th className="text-left px-2 py-1">Protospacer (20 nt)</th>
                    <th className="text-left px-2 py-1">PAM</th>
                    <th className="text-center px-2 py-1">Strand</th>
                    <th className="text-right px-2 py-1">Pos</th>
                    <th className="text-right px-2 py-1">GC%</th>
                    <th className="text-right px-2 py-1">On-target</th>
                    <th className="text-right px-2 py-1">Off-hits</th>
                    <th className="text-right px-2 py-1">Composite</th>
                  </tr>
                </thead>
                <tbody>
                  {res.guides.map((g, i) => (
                    <tr key={i} className={cn('border-t border-white/5', i === 0 && 'bg-emerald-500/5')}>
                      <td className="px-2 py-1 font-mono text-gray-200">{g.guide}</td>
                      <td className="px-2 py-1 font-mono text-amber-300">{g.pam}</td>
                      <td className="px-2 py-1 text-center text-gray-400">{g.strand}</td>
                      <td className="px-2 py-1 text-right font-mono text-gray-400">{g.position}</td>
                      <td className="px-2 py-1 text-right font-mono text-gray-300">{g.gcPercent}</td>
                      <td className={cn('px-2 py-1 text-right font-mono', scoreColor(g.onTargetScore))}>{g.onTargetScore}</td>
                      <td className="px-2 py-1 text-right font-mono text-gray-300">{g.offTargetHits}</td>
                      <td className={cn('px-2 py-1 text-right font-mono font-semibold', scoreColor(g.compositeScore))}>{g.compositeScore}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

/* ─────────────── Lab notebook ─────────────── */

interface SavedSeqLite { id: string; name: string }
interface NotebookEntry {
  id: string; title: string; body: string; tags: string[];
  linkedSequenceIds: string[]; linkedProtocol: string | null;
  status: 'draft' | 'in_progress' | 'complete';
  createdAt: string; updatedAt: string;
}
const STATUS_COLOR: Record<string, string> = {
  draft: 'text-gray-400 bg-gray-500/15',
  in_progress: 'text-cyan-300 bg-cyan-500/15',
  complete: 'text-emerald-300 bg-emerald-500/15',
};

function NotebookTab() {
  const [entries, setEntries] = useState<NotebookEntry[]>([]);
  const [seqs, setSeqs] = useState<SavedSeqLite[]>([]);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState<string | null>(null);
  const [editing, setEditing] = useState<string | null>(null);
  const [draft, setDraft] = useState({
    title: '', body: '', tags: '', linkedProtocol: '',
    status: 'draft' as NotebookEntry['status'], linkedSequenceIds: [] as string[],
  });
  const [showForm, setShowForm] = useState(false);

  const refresh = useCallback(async () => {
    setLoading(true); setErr(null);
    const [nb, sl] = await Promise.all([
      lensRun<{ entries: NotebookEntry[] }>('bio', 'notebook-list', {}),
      lensRun<{ sequences: SavedSeqLite[] }>('bio', 'sequence-list', {}),
    ]);
    if (nb.data.ok && nb.data.result) setEntries(nb.data.result.entries || []);
    else setErr(nb.data.error || 'notebook-list failed');
    if (sl.data.ok && sl.data.result) setSeqs((sl.data.result.sequences || []).map((s) => ({ id: s.id, name: s.name })));
    setLoading(false);
  }, []);

  useEffect(() => { refresh(); }, [refresh]);

  const resetDraft = () => {
    setDraft({ title: '', body: '', tags: '', linkedProtocol: '', status: 'draft', linkedSequenceIds: [] });
    setEditing(null); setShowForm(false);
  };

  const save = useCallback(async () => {
    const payload = {
      title: draft.title.trim(),
      body: draft.body,
      tags: draft.tags.split(',').map((t) => t.trim()).filter(Boolean),
      linkedProtocol: draft.linkedProtocol.trim() || undefined,
      status: draft.status,
      linkedSequenceIds: draft.linkedSequenceIds,
    };
    const r = editing
      ? await lensRun('bio', 'notebook-update', { id: editing, ...payload })
      : await lensRun('bio', 'notebook-create', payload);
    if (r.data.ok) { resetDraft(); await refresh(); }
    else setErr(r.data.error || 'notebook save failed');
  }, [draft, editing, refresh]);

  const remove = useCallback(async (id: string) => {
    const r = await lensRun('bio', 'notebook-delete', { id });
    if (r.data.ok) await refresh();
    else setErr(r.data.error || 'notebook-delete failed');
  }, [refresh]);

  const startEdit = (e: NotebookEntry) => {
    setEditing(e.id);
    setDraft({
      title: e.title, body: e.body, tags: e.tags.join(', '),
      linkedProtocol: e.linkedProtocol || '', status: e.status,
      linkedSequenceIds: e.linkedSequenceIds,
    });
    setShowForm(true);
  };

  return (
    <div className="space-y-3">
      <div className="flex items-center gap-2">
        <button type="button" className={btn()} onClick={() => { resetDraft(); setShowForm((v) => !v); }}>
          <NotebookPen className="w-3 h-3" /> {showForm && !editing ? 'Close' : 'New entry'}
        </button>
        <span className="text-[10px] text-gray-400">{entries.length} entr{entries.length === 1 ? 'y' : 'ies'}</span>
      </div>
      {err && <Err msg={err} />}

      {showForm && (
        <div className="rounded border border-emerald-500/30 bg-emerald-500/5 p-3 space-y-2">
          <input value={draft.title} onChange={(e) => setDraft({ ...draft, title: e.target.value })}
            placeholder="Entry title" maxLength={120} className={cn(inp, 'w-full')} />
          <textarea value={draft.body} onChange={(e) => setDraft({ ...draft, body: e.target.value })}
            rows={4} placeholder="Observations, methods, results…" className={ta} />
          <div className="grid md:grid-cols-2 gap-2">
            <input value={draft.tags} onChange={(e) => setDraft({ ...draft, tags: e.target.value })}
              placeholder="tags (comma-separated)" className={cn(inp, 'w-full')} />
            <input value={draft.linkedProtocol} onChange={(e) => setDraft({ ...draft, linkedProtocol: e.target.value })}
              placeholder="linked protocol (optional)" className={cn(inp, 'w-full')} />
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <select value={draft.status} onChange={(e) => setDraft({ ...draft, status: e.target.value as NotebookEntry['status'] })} className={inp}>
              <option value="draft">Draft</option>
              <option value="in_progress">In progress</option>
              <option value="complete">Complete</option>
            </select>
          </div>
          {seqs.length > 0 && (
            <div>
              <p className="text-[10px] uppercase tracking-wider text-gray-400 mb-1">Link saved sequences</p>
              <div className="flex flex-wrap gap-1.5">
                {seqs.map((s) => {
                  const on = draft.linkedSequenceIds.includes(s.id);
                  return (
                    <button key={s.id} type="button"
                      onClick={() => setDraft((d) => ({
                        ...d,
                        linkedSequenceIds: on ? d.linkedSequenceIds.filter((x) => x !== s.id) : [...d.linkedSequenceIds, s.id],
                      }))}
                      className={cn('px-2 py-0.5 text-[10px] rounded border',
                        on ? 'bg-emerald-500/15 border-emerald-500/40 text-emerald-200' : 'border-white/10 text-gray-400')}>
                      {s.name}
                    </button>
                  );
                })}
              </div>
            </div>
          )}
          <div className="flex gap-2">
            <button type="button" className={btn()} disabled={!draft.title.trim()} onClick={save}>
              <Save className="w-3 h-3" /> {editing ? 'Update' : 'Create'}
            </button>
            <button type="button" onClick={resetDraft} className="px-3 py-1.5 text-xs text-gray-400 hover:text-gray-200">Cancel</button>
          </div>
        </div>
      )}

      {loading ? (
        <div className="flex items-center justify-center py-8 text-xs text-gray-400">
          <Loader2 className="w-4 h-4 animate-spin mr-2" /> Loading…
        </div>
      ) : entries.length === 0 ? (
        <p className="text-center text-xs text-gray-400 py-8">No notebook entries yet.</p>
      ) : (
        <div className="space-y-2">
          {entries.map((e) => (
            <div key={e.id} className="rounded border border-white/10 bg-black/20 p-3 group">
              <div className="flex items-start justify-between gap-2">
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2">
                    <p className="text-sm font-medium text-gray-100">{e.title}</p>
                    <span className={cn('text-[9px] px-1.5 py-0.5 rounded uppercase', STATUS_COLOR[e.status])}>{e.status.replace('_', ' ')}</span>
                  </div>
                  {e.body && <p className="text-[11px] text-gray-400 mt-1 whitespace-pre-wrap line-clamp-3">{e.body}</p>}
                  <div className="flex flex-wrap gap-1.5 mt-1.5">
                    {e.tags.map((t) => <span key={t} className="text-[9px] px-1.5 py-0.5 rounded bg-white/5 text-gray-400">#{t}</span>)}
                    {e.linkedSequenceIds.length > 0 && (
                      <span className="text-[9px] px-1.5 py-0.5 rounded bg-emerald-500/10 text-emerald-300">
                        <Dna className="w-2.5 h-2.5 inline mr-0.5" />{e.linkedSequenceIds.length} seq
                      </span>
                    )}
                    {e.linkedProtocol && <span className="text-[9px] px-1.5 py-0.5 rounded bg-cyan-500/10 text-cyan-300">protocol: {e.linkedProtocol}</span>}
                  </div>
                  <p className="text-[9px] text-gray-400 mt-1">Updated {new Date(e.updatedAt).toLocaleString()}</p>
                </div>
                <div className="flex items-center gap-1 opacity-0 group-hover:opacity-100">
                  <button type="button" onClick={() => startEdit(e)} className="p-1 text-gray-600 hover:text-cyan-300" aria-label="Edit"><NotebookPen className="w-3 h-3" /></button>
                  <button type="button" onClick={() => remove(e.id)} className="p-1 text-gray-600 hover:text-rose-300" aria-label="Delete"><Trash2 className="w-3 h-3" /></button>
                </div>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

/* ─────────────── shared ─────────────── */

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded border border-white/10 bg-black/30 px-2 py-1.5">
      <p className="text-[9px] uppercase tracking-wider text-gray-400">{label}</p>
      <p className="text-sm font-mono text-gray-100 flex items-center gap-1">
        {value}
        {value === 'clean' && <Check className="w-3 h-3 text-emerald-400" />}
      </p>
    </div>
  );
}

export default MolecularWorkbench;
