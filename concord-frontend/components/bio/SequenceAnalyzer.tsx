'use client';

/**
 * SequenceAnalyzer — bespoke DNA/RNA/protein analysis for the bio lens.
 * Backed by:
 *   bio.sequence-analyze — length / GC% / Tm / ORFs (DNA), composition (protein)
 *   bio.primer-design     — forward + reverse primer for a target sequence
 *   bio.align-pairwise    — Needleman-Wunsch global alignment of two sequences
 *
 * Per category-leader research (Benchling, SnapGene, UniProt, NCBI):
 * monospace sequence viewer with base-color coding (A=green, T/U=red,
 * C=blue, G=amber), Save-as-DTU on the analysis result with full primer
 * + ORF metadata embedded.
 */

import { useState } from 'react';
import { useMutation } from '@tanstack/react-query';
import { motion } from 'framer-motion';
import { Dna, Loader2, Beaker, GitCompare } from 'lucide-react';
import { apiHelpers } from '@/lib/api/client';
import { SaveAsDtuButton } from '@/components/dtu/SaveAsDtuButton';

type Kind = 'dna' | 'rna' | 'protein';
type Tab = 'analyze' | 'primer' | 'align';

interface AnalysisResult {
  length: number;
  kind: Kind;
  gcPercent?: number;
  tm?: number;
  orfs?: Array<{ frame: number; start: number; end: number; length: number; protein?: string }>;
  composition?: Record<string, number>;
  molecularWeight?: number;
}

interface PrimerResult {
  forward: { sequence: string; length: number; tm: number; gcPercent: number };
  reverse: { sequence: string; length: number; tm: number; gcPercent: number };
  productSize: number;
  notes: string;
}

interface AlignResult {
  score?: number;
  // Handler (bio.align-pairwise) returns these exact field names — see
  // server/domains/bio.js. Earlier this component read alignedA/alignedB/
  // midline/identityPercent, none of which the handler emits, so the align
  // result rendered blank in production (the block was gated on alignedA).
  alignA?: string;
  alignB?: string;
  alignBars?: string;
  identity?: number;
  alignmentLength?: number;
}

interface MacroEnvelope<T> { ok: boolean; result?: T; error?: string }

async function callMacro<T>(action: string, input: Record<string, unknown>): Promise<MacroEnvelope<T>> {
  const r = await apiHelpers.lens.runDomain('bio', action, { input });
  const data = (r as { data?: { ok: boolean; result?: T } }).data;
  if (!data) return { ok: false, error: 'empty response' };
  if (data.ok && data.result && typeof data.result === 'object' && 'ok' in data.result) {
    return data.result as MacroEnvelope<T>;
  }
  return data as MacroEnvelope<T>;
}

const BASE_COLOR: Record<string, string> = {
  A: 'text-emerald-400',
  T: 'text-rose-400',
  U: 'text-rose-400',
  C: 'text-sky-400',
  G: 'text-amber-400',
  N: 'text-zinc-400',
};

export function SequenceAnalyzer() {
  const [tab, setTab] = useState<Tab>('analyze');
  const [sequence, setSequence] = useState('');
  const [secondSequence, setSecondSequence] = useState('');
  const [kind, setKind] = useState<Kind>('dna');
  const [analysis, setAnalysis] = useState<AnalysisResult | null>(null);
  const [primer, setPrimer] = useState<PrimerResult | null>(null);
  const [align, setAlign] = useState<AlignResult | null>(null);

  const analyzeMutation = useMutation({
    mutationFn: async () => callMacro<AnalysisResult>('sequence-analyze', { sequence, kind }),
    onSuccess: (env) => { if (env.ok && env.result) setAnalysis(env.result); else setAnalysis(null); },
  });
  const primerMutation = useMutation({
    mutationFn: async () => callMacro<PrimerResult>('primer-design', { sequence }),
    onSuccess: (env) => { if (env.ok && env.result) setPrimer(env.result); else setPrimer(null); },
  });
  const alignMutation = useMutation({
    mutationFn: async () => callMacro<AlignResult>('align-pairwise', { seqA: sequence, seqB: secondSequence }),
    onSuccess: (env) => { if (env.ok && env.result) setAlign(env.result); else setAlign(null); },
  });

  const cleanedSeq = sequence.replace(/\s/g, '').toUpperCase();

  return (
    <div className="space-y-4">
      <header className="flex items-center justify-between gap-3 border-b border-cyan-500/15 pb-3">
        <div className="flex items-center gap-2">
          <Dna className="h-5 w-5 text-cyan-400" />
          <h2 className="text-sm font-semibold text-white">Sequence Analyzer</h2>
          <span className="rounded bg-zinc-800 px-1.5 py-0.5 font-mono text-[10px] uppercase tracking-wider text-zinc-400">
            dna · rna · protein
          </span>
        </div>
        <div className="flex items-center gap-1 rounded-md border border-zinc-800 bg-zinc-950 p-0.5">
          {(['analyze', 'primer', 'align'] as const).map((t) => (
            <button
              key={t}
              type="button"
              onClick={() => setTab(t)}
              className={`rounded px-2.5 py-1 text-[11px] font-medium transition-colors ${
                tab === t ? 'bg-cyan-500/15 text-cyan-300' : 'text-zinc-400 hover:text-zinc-300'
              }`}
            >
              {t === 'analyze' ? 'Analyze' : t === 'primer' ? 'Primer Design' : 'Align Pair'}
            </button>
          ))}
        </div>
      </header>

      <div className="space-y-2">
        <div className="flex items-center justify-between">
          <label className="text-[10px] uppercase tracking-wider text-zinc-400">
            Sequence {tab === 'align' && '(A)'}
          </label>
          <div className="flex gap-1 rounded-md border border-zinc-800 bg-zinc-950 p-0.5">
            {(['dna', 'rna', 'protein'] as const).map((k) => (
              <button
                key={k}
                type="button"
                onClick={() => setKind(k)}
                className={`rounded px-2 py-0.5 text-[10px] font-medium uppercase transition-colors ${
                  kind === k ? 'bg-cyan-500/15 text-cyan-300' : 'text-zinc-400 hover:text-zinc-300'
                }`}
              >
                {k}
              </button>
            ))}
          </div>
        </div>
        <textarea
          value={sequence}
          onChange={(e) => setSequence(e.target.value)}
          rows={4}
          placeholder="Paste a sequence — ATCGATCG… (DNA), AUCG (RNA), MKVLW (protein)"
          className="w-full rounded-md border border-zinc-800 bg-zinc-950 px-3 py-2 font-mono text-xs uppercase text-white placeholder-zinc-600 focus:border-cyan-500/40 focus:outline-none"
        />
        {tab === 'align' && (
          <>
            <label className="text-[10px] uppercase tracking-wider text-zinc-400">Sequence (B)</label>
            <textarea
              value={secondSequence}
              onChange={(e) => setSecondSequence(e.target.value)}
              rows={4}
              placeholder="Second sequence to align against A"
              className="w-full rounded-md border border-zinc-800 bg-zinc-950 px-3 py-2 font-mono text-xs uppercase text-white placeholder-zinc-600 focus:border-cyan-500/40 focus:outline-none"
            />
          </>
        )}
        <div className="flex items-center gap-2">
          {tab === 'analyze' && (
            <button type="button" onClick={() => analyzeMutation.mutate()} disabled={!cleanedSeq || analyzeMutation.isPending} className="inline-flex items-center gap-1.5 rounded-md border border-cyan-500/30 bg-cyan-500/10 px-3 py-1.5 text-xs font-medium text-cyan-200 transition-colors hover:bg-cyan-500/20 disabled:opacity-50">
              {analyzeMutation.isPending ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Dna className="h-3.5 w-3.5" />}
              Analyze
            </button>
          )}
          {tab === 'primer' && (
            <button type="button" onClick={() => primerMutation.mutate()} disabled={cleanedSeq.length < 100 || primerMutation.isPending} className="inline-flex items-center gap-1.5 rounded-md border border-cyan-500/30 bg-cyan-500/10 px-3 py-1.5 text-xs font-medium text-cyan-200 transition-colors hover:bg-cyan-500/20 disabled:opacity-50">
              {primerMutation.isPending ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Beaker className="h-3.5 w-3.5" />}
              Design Primers
            </button>
          )}
          {tab === 'align' && (
            <button type="button" onClick={() => alignMutation.mutate()} disabled={!cleanedSeq || !secondSequence.trim() || alignMutation.isPending} className="inline-flex items-center gap-1.5 rounded-md border border-cyan-500/30 bg-cyan-500/10 px-3 py-1.5 text-xs font-medium text-cyan-200 transition-colors hover:bg-cyan-500/20 disabled:opacity-50">
              {alignMutation.isPending ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <GitCompare className="h-3.5 w-3.5" />}
              Align
            </button>
          )}
          {cleanedSeq && <span className="text-[10px] font-mono text-zinc-400">{cleanedSeq.length} chars</span>}
        </div>
      </div>

      {/* Sequence viewer with base coloring */}
      {cleanedSeq && (
        <details className="rounded-md border border-zinc-800 bg-zinc-950/40">
          <summary className="cursor-pointer px-3 py-2 text-[10px] uppercase tracking-wider text-zinc-400 hover:bg-zinc-900">
            Colored viewer
          </summary>
          <div className="max-h-48 overflow-y-auto px-3 py-2 font-mono text-xs leading-snug tracking-wider">
            {cleanedSeq.match(/.{1,60}/g)?.map((line, i) => (
              <div key={i} className="flex">
                <span className="mr-3 w-12 text-right text-zinc-600">{i * 60 + 1}</span>
                <span className="break-all">
                  {line.split('').map((c, j) => (
                    <span key={j} className={BASE_COLOR[c] || 'text-zinc-400'}>{c}</span>
                  ))}
                </span>
              </div>
            ))}
          </div>
        </details>
      )}

      {analysis && tab === 'analyze' && (
        <motion.div initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }} className="space-y-3">
          <div className="rounded-lg border border-cyan-500/20 bg-zinc-950/60 p-3">
            <div className="flex items-center justify-between gap-3">
              <div className="text-xs font-semibold text-cyan-300">Analysis result</div>
              <SaveAsDtuButton
                compact
                apiSource="concord-bio-analyze"
                title={`${analysis.kind.toUpperCase()} analysis (${analysis.length} chars)`}
                content={JSON.stringify(analysis, null, 2)}
                extraTags={['bio', 'sequence', analysis.kind]}
                rawData={analysis}
              />
            </div>
            <dl className="mt-2 grid grid-cols-2 gap-2 text-xs sm:grid-cols-4">
              <Stat label="Length" value={`${analysis.length}`} />
              <Stat label="Kind" value={analysis.kind.toUpperCase()} />
              {analysis.gcPercent !== undefined && <Stat label="GC %" value={`${analysis.gcPercent.toFixed(1)}%`} />}
              {analysis.tm !== undefined && <Stat label="Tm" value={`${analysis.tm.toFixed(1)}°C`} />}
              {analysis.molecularWeight !== undefined && <Stat label="MW (avg)" value={`${analysis.molecularWeight} Da`} />}
              {analysis.orfs !== undefined && <Stat label="ORFs" value={`${analysis.orfs.length}`} />}
            </dl>
          </div>
          {analysis.orfs && analysis.orfs.length > 0 && (
            <div className="rounded-md border border-zinc-800 bg-zinc-950/40 p-3">
              <div className="mb-2 text-[10px] uppercase tracking-wider text-zinc-400">Open Reading Frames</div>
              <div className="space-y-1">
                {analysis.orfs.slice(0, 10).map((orf, i) => (
                  <div key={i} className="rounded border border-zinc-800 bg-zinc-950 px-2 py-1 text-[11px]">
                    <span className="font-mono text-cyan-300">Frame {orf.frame > 0 ? '+' : ''}{orf.frame}</span>
                    <span className="ml-2 font-mono text-zinc-400">{orf.start}–{orf.end} ({orf.length} bp)</span>
                  </div>
                ))}
              </div>
            </div>
          )}
        </motion.div>
      )}

      {primer && tab === 'primer' && (
        <motion.div initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }} className="rounded-lg border border-cyan-500/20 bg-zinc-950/60 p-3 space-y-2">
          <div className="flex items-center justify-between">
            <div className="text-xs font-semibold text-cyan-300">Primer pair</div>
            <SaveAsDtuButton
              compact
              apiSource="concord-bio-primer"
              title={`Primer pair (${primer.productSize} bp product)`}
              content={`Forward: ${primer.forward.sequence}\n  Tm ${primer.forward.tm.toFixed(1)}°C · GC ${primer.forward.gcPercent.toFixed(1)}%\nReverse: ${primer.reverse.sequence}\n  Tm ${primer.reverse.tm.toFixed(1)}°C · GC ${primer.reverse.gcPercent.toFixed(1)}%\nProduct size: ${primer.productSize} bp\n${primer.notes}`}
              extraTags={['bio', 'primer']}
              rawData={primer}
            />
          </div>
          <PrimerCard label="Forward (5′ → 3′)" p={primer.forward} />
          <PrimerCard label="Reverse (5′ → 3′)" p={primer.reverse} />
          <p className="text-[10px] text-zinc-400">{primer.notes}</p>
        </motion.div>
      )}

      {align && tab === 'align' && align.alignA && (
        <motion.div initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }} className="rounded-lg border border-cyan-500/20 bg-zinc-950/60 p-3 space-y-2">
          <div className="flex items-center justify-between">
            <div className="text-xs font-semibold text-cyan-300">
              Alignment · score {align.score} · {align.identity?.toFixed(1) || '—'}% identity
            </div>
            <SaveAsDtuButton
              compact
              apiSource="concord-bio-align"
              title={`Alignment (${align.identity?.toFixed(0) || '—'}% identity)`}
              content={`A: ${align.alignA}\n   ${align.alignBars || ''}\nB: ${align.alignB || ''}\nScore: ${align.score} · Identity: ${align.identity}%`}
              extraTags={['bio', 'alignment']}
              rawData={align}
            />
          </div>
          <pre className="overflow-x-auto whitespace-pre rounded border border-zinc-800 bg-zinc-950 p-2 font-mono text-[11px] leading-tight">
            <span className="text-emerald-400">A: {align.alignA}</span>{'\n'}
            <span className="text-zinc-600">   {align.alignBars || ''}</span>{'\n'}
            <span className="text-cyan-400">B: {align.alignB}</span>
          </pre>
        </motion.div>
      )}
    </div>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded border border-zinc-800 bg-zinc-950 px-2.5 py-1.5">
      <div className="text-[10px] uppercase tracking-wider text-zinc-400">{label}</div>
      <div className="mt-0.5 font-mono text-sm text-cyan-300">{value}</div>
    </div>
  );
}

function PrimerCard({ label, p }: { label: string; p: PrimerResult['forward'] }) {
  return (
    <div className="rounded border border-zinc-800 bg-zinc-950 p-2 text-xs">
      <div className="text-[10px] uppercase tracking-wider text-zinc-400">{label}</div>
      <div className="mt-1 break-all font-mono text-emerald-300">{p.sequence}</div>
      <div className="mt-1 flex gap-3 text-[10px] text-zinc-400">
        <span>Length: <span className="font-mono">{p.length} bp</span></span>
        <span>Tm: <span className="font-mono">{p.tm.toFixed(1)}°C</span></span>
        <span>GC: <span className="font-mono">{p.gcPercent.toFixed(1)}%</span></span>
      </div>
    </div>
  );
}
