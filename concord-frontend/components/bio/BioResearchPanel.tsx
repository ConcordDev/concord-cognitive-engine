'use client';

/**
 * BioResearchPanel — the bio lens's research bench, covering every bio.*
 * macro that had zero bespoke UI before this rebuild: sequenceAlign (global
 * Needleman-Wunsch alignment scoring), geneExpression (differential
 * expression / fold-change / Welch's t-test approximation), phylogeneticDistance
 * (Jukes-Cantor / Kimura pairwise distance matrix), motifDetection (conserved
 * k-mer scan), profile-organism, map-pathway, review-protocol (lab protocol
 * QA), link-gene-function, trace-evolution, and parse-fasta.
 *
 * MolecularWorkbench/SequenceAnalyzer/BioWorkbench/BioActionPanel already
 * cover the Benchling/SnapGene-style sequence-handling macros (primer
 * design, restriction mapping, cloning, BLAST, CRISPR, plasmid maps). This
 * panel is the complementary NCBI/UniProt-style analysis bench — each tool
 * gets its own tailored inputs, never a generic auto-discovered button wall.
 */

import { useState } from 'react';
import {
  GitCompare, BarChart3, Network, ScanSearch, Bug, Route, ClipboardCheck,
  Dna, GitBranch, FileText, Loader2, AlertTriangle, Plus, X,
} from 'lucide-react';
import { motion, AnimatePresence } from 'framer-motion';
import { apiHelpers } from '@/lib/api/client';
import { cn } from '@/lib/utils';

interface MacroEnvelope<T> { ok: boolean; result?: T; error?: string; message?: string }
async function callMacro<T>(action: string, input: Record<string, unknown>): Promise<MacroEnvelope<T>> {
  const r = await apiHelpers.lens.runDomain('bio', action, { input });
  const data = (r as { data?: { ok: boolean; result?: T; error?: string; message?: string } }).data;
  if (!data) return { ok: false, error: 'empty response' };
  if (data.ok && data.result && typeof data.result === 'object' && 'ok' in data.result) return data.result as MacroEnvelope<T>;
  return data as MacroEnvelope<T>;
}
function pickMessage(e: unknown): string { const ax = e as { response?: { data?: { error?: string } }; message?: string }; return ax?.response?.data?.error ?? ax?.message ?? 'request failed'; }

interface AlignResult { alignment: { sequenceA: string; midline: string; sequenceB: string }; score: number; statistics: { length: number; matches: number; mismatches: number; gaps: number; identity: number; similarity: number; sequenceType: string } }
interface ExpressionResult { message?: string; conditions?: { conditionA: string; conditionB: string }; summary?: { totalGenes: number; significantGenes: number; upregulated: number; downregulated: number; topUpregulated: { gene: string; log2FC: number }[]; topDownregulated: { gene: string; log2FC: number }[] } }
interface PhyloResult { model: string; sequenceCount: number; labels: string[]; distanceMatrix: number[][]; closest: { a: string; b: string; distance: number } | null; farthest: { a: string; b: string; distance: number } | null }
interface MotifResult { message?: string; totalMotifs?: number; topMotifs?: { motif: string; occurrences: number; conservation: number; gcContent: number; isPalindromic: boolean }[]; consensusMotifs?: { motif: string; conservation: number }[] }
interface OrganismResult { name: string; kingdom: string; taxonomyRanks: string[]; habitat: string; traits: string[]; evolutionaryNotes: string; summary: string }
interface PathwayResult { pathway: string; stepCount: number; chainBreaks: { at: number; expected: string; actual: string }[]; totalDeltaG: number | null; thermodynamicallyFavorable: boolean; summary: string }
interface ProtocolResult { stepCount: number; totalEstimatedMinutes: number | null; gaps: { kind: string; severity: string; suggestion: string }[]; severity: string; summary: string }
interface GeneFunctionResult { gene: string; protein: string; organism: string; chain: { stage: string; entity: string; role: string }[]; externalLinks: { source: string; url: string }[]; summary: string }
interface EvolutionResult { organisms: { name: string; group: string }[]; groups: string[]; sharedGroup: string | null; commonality: string; suggestion: string }
interface FastaResult { records: { id: string; description: string; sequence: string; length: number }[]; count: number }

type Tool = 'align' | 'expression' | 'phylo' | 'motif' | 'organism' | 'pathway' | 'protocol' | 'gene' | 'evolution' | 'fasta';

const TOOLS: { id: Tool; label: string; icon: typeof GitCompare; macro: string }[] = [
  { id: 'align', label: 'Sequence Align', icon: GitCompare, macro: 'sequenceAlign' },
  { id: 'expression', label: 'Gene Expression', icon: BarChart3, macro: 'geneExpression' },
  { id: 'phylo', label: 'Phylogenetics', icon: Network, macro: 'phylogeneticDistance' },
  { id: 'motif', label: 'Motif Scan', icon: ScanSearch, macro: 'motifDetection' },
  { id: 'organism', label: 'Organism Profile', icon: Bug, macro: 'profile-organism' },
  { id: 'pathway', label: 'Pathway Map', icon: Route, macro: 'map-pathway' },
  { id: 'protocol', label: 'Protocol Review', icon: ClipboardCheck, macro: 'review-protocol' },
  { id: 'gene', label: 'Gene → Function', icon: Dna, macro: 'link-gene-function' },
  { id: 'evolution', label: 'Evolution Trace', icon: GitBranch, macro: 'trace-evolution' },
  { id: 'fasta', label: 'FASTA Parser', icon: FileText, macro: 'parse-fasta' },
];

export function BioResearchPanel() {
  const [tool, setTool] = useState<Tool>('align');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  // Sequence align
  const [seqA, setSeqA] = useState('ACGTACGT');
  const [seqB, setSeqB] = useState('ACGTTCGT');
  const [alignResult, setAlignResult] = useState<AlignResult | null>(null);

  // Gene expression — CSV rows "gene,condition,expression"
  const [exprRows, setExprRows] = useState('TP53,control,3.1\nTP53,treated,7.4\nMYC,control,5.0\nMYC,treated,4.8');
  const [exprResult, setExprResult] = useState<ExpressionResult | null>(null);

  // Phylogenetics
  const [phyloSeqs, setPhyloSeqs] = useState([{ id: 'seqA', sequence: 'ACGTACGTAC' }, { id: 'seqB', sequence: 'ACGTACGTTC' }, { id: 'seqC', sequence: 'ACGGACGTAC' }]);
  const [phyloModel, setPhyloModel] = useState<'jukes-cantor' | 'kimura'>('jukes-cantor');
  const [phyloResult, setPhyloResult] = useState<PhyloResult | null>(null);

  // Motif
  const [motifSeqs, setMotifSeqs] = useState([{ id: 'seq1', sequence: 'ACGTGCATGCACGTGCATTT' }, { id: 'seq2', sequence: 'TTACGTGCATCCACGTGCAT' }]);
  const [motifLen, setMotifLen] = useState('6');
  const [motifResult, setMotifResult] = useState<MotifResult | null>(null);

  // Organism
  const [orgName, setOrgName] = useState('');
  const [orgKingdom, setOrgKingdom] = useState('Animalia');
  const [orgHabitat, setOrgHabitat] = useState('');
  const [orgTraits, setOrgTraits] = useState('');
  const [orgResult, setOrgResult] = useState<OrganismResult | null>(null);

  // Pathway
  const [pathwaySteps, setPathwaySteps] = useState([{ substrate: 'glucose', enzyme: 'hexokinase', product: 'glucose-6-phosphate', deltaG: '-33.4' }]);
  const [pathwayResult, setPathwayResult] = useState<PathwayResult | null>(null);

  // Protocol
  const [protocolSteps, setProtocolSteps] = useState('Prepare samples\nIncubate at 37C for 30 min\nRun gel electrophoresis\nImage and record results');
  const [protocolResult, setProtocolResult] = useState<ProtocolResult | null>(null);

  // Gene function
  const [geneSymbol, setGeneSymbol] = useState('');
  const [geneOrganism, setGeneOrganism] = useState('Homo sapiens');
  const [geneFunction, setGeneFunction] = useState('');
  const [geneResult, setGeneResult] = useState<GeneFunctionResult | null>(null);

  // Evolution
  const [evoOrganisms, setEvoOrganisms] = useState('human, chimpanzee, mouse');
  const [evoResult, setEvoResult] = useState<EvolutionResult | null>(null);

  // FASTA
  const [fastaText, setFastaText] = useState('>seq1 example\nACGTACGTACGT\n>seq2 example\nTTGGCCAATTGG');
  const [fastaResult, setFastaResult] = useState<FastaResult | null>(null);

  async function run<T>(action: string, input: Record<string, unknown>, onOk: (r: T) => void) {
    setBusy(true); setErr(null);
    try {
      const r = await callMacro<T>(action, input);
      if (r.ok && r.result) onOk(r.result); else setErr(r.error ?? r.message ?? `${action} failed`);
    } catch (e) { setErr(pickMessage(e)); } finally { setBusy(false); }
  }

  function updateSeqList(list: { id: string; sequence: string }[], setList: (v: { id: string; sequence: string }[]) => void, i: number, field: 'id' | 'sequence', v: string) {
    setList(list.map((s, idx) => idx === i ? { ...s, [field]: v } : s));
  }

  return (
    <div className="rounded-lg border border-emerald-500/20 bg-zinc-950/60 p-3 space-y-3">
      <header className="flex items-center gap-2 border-b border-emerald-500/10 pb-2">
        <Network className="h-4 w-4 text-emerald-400" />
        <h3 className="text-sm font-semibold text-white">Research bench</h3>
        <span className="rounded bg-zinc-800 px-1.5 py-0.5 font-mono text-[10px] uppercase tracking-wider text-zinc-400">alignment · expression · phylogenetics · pathways</span>
      </header>

      <div className="flex flex-wrap gap-1">
        {TOOLS.map(t => {
          const Icon = t.icon;
          return (
            <button key={t.id} type="button" onClick={() => { setTool(t.id); setErr(null); }}
              className={cn('flex items-center gap-1.5 px-2.5 py-1.5 rounded text-xs font-medium transition-colors',
                tool === t.id ? 'bg-zinc-800 text-white' : 'text-zinc-400 hover:text-zinc-200')}>
              <Icon className="w-3.5 h-3.5" /> {t.label}
            </button>
          );
        })}
      </div>

      {err && <p className="text-xs text-red-400 flex items-center gap-1"><AlertTriangle className="w-3 h-3" /> {err}</p>}

      {tool === 'align' && (
        <div className="space-y-2 text-xs">
          <textarea value={seqA} onChange={(e) => setSeqA(e.target.value)} rows={2} className="w-full bg-zinc-900 border border-zinc-800 rounded px-2 py-1.5 text-white font-mono" placeholder="Sequence A" />
          <textarea value={seqB} onChange={(e) => setSeqB(e.target.value)} rows={2} className="w-full bg-zinc-900 border border-zinc-800 rounded px-2 py-1.5 text-white font-mono" placeholder="Sequence B" />
          <button type="button" disabled={busy} onClick={() => run<AlignResult>('sequenceAlign', { sequenceA: seqA, sequenceB: seqB }, setAlignResult)}
            className="px-3 py-1.5 rounded bg-emerald-500/20 text-emerald-300 hover:bg-emerald-500/30 disabled:opacity-40 flex items-center gap-1.5">
            {busy ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <GitCompare className="w-3.5 h-3.5" />} Align (Needleman-Wunsch)
          </button>
          <AnimatePresence>
            {alignResult && (
              <motion.div initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }} className="rounded-md border border-emerald-500/25 bg-emerald-500/5 p-3 space-y-1 font-mono">
                <div>{alignResult.alignment.sequenceA}</div>
                <div className="text-emerald-400">{alignResult.alignment.midline}</div>
                <div>{alignResult.alignment.sequenceB}</div>
                <div className="font-sans text-zinc-400 pt-1">Score {alignResult.score} · Identity {alignResult.statistics.identity}% · Similarity {alignResult.statistics.similarity}% · {alignResult.statistics.matches} matches / {alignResult.statistics.mismatches} mismatches / {alignResult.statistics.gaps} gaps · {alignResult.statistics.sequenceType}</div>
              </motion.div>
            )}
          </AnimatePresence>
        </div>
      )}

      {tool === 'expression' && (
        <div className="space-y-2 text-xs">
          <p className="text-zinc-500">gene,condition,expression — one row per sample, needs exactly 2 conditions.</p>
          <textarea value={exprRows} onChange={(e) => setExprRows(e.target.value)} rows={5} className="w-full bg-zinc-900 border border-zinc-800 rounded px-2 py-1.5 text-white font-mono" />
          <button type="button" disabled={busy} onClick={() => {
            const samples = exprRows.split('\n').map(l => l.trim()).filter(Boolean).map(line => {
              const [gene, condition, expression] = line.split(',').map(s => s.trim());
              return { gene, condition, expression: parseFloat(expression) };
            }).filter(s => s.gene && s.condition && Number.isFinite(s.expression));
            run<ExpressionResult>('geneExpression', { samples }, setExprResult);
          }} className="px-3 py-1.5 rounded bg-emerald-500/20 text-emerald-300 hover:bg-emerald-500/30 disabled:opacity-40 flex items-center gap-1.5">
            {busy ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <BarChart3 className="w-3.5 h-3.5" />} Analyze differential expression
          </button>
          <AnimatePresence>
            {exprResult && (
              <motion.div initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }} className="rounded-md border border-emerald-500/25 bg-emerald-500/5 p-3 space-y-1.5">
                {exprResult.message ? <p className="text-zinc-400">{exprResult.message}</p> : exprResult.summary && (
                  <>
                    <p className="text-zinc-300">{exprResult.conditions?.conditionA} vs {exprResult.conditions?.conditionB} · {exprResult.summary.totalGenes} genes, {exprResult.summary.significantGenes} significant ({exprResult.summary.upregulated} up / {exprResult.summary.downregulated} down)</p>
                    {exprResult.summary.topUpregulated.map(g => <div key={g.gene} className="font-mono text-emerald-300">↑ {g.gene} log2FC {g.log2FC}</div>)}
                    {exprResult.summary.topDownregulated.map(g => <div key={g.gene} className="font-mono text-rose-300">↓ {g.gene} log2FC {g.log2FC}</div>)}
                  </>
                )}
              </motion.div>
            )}
          </AnimatePresence>
        </div>
      )}

      {tool === 'phylo' && (
        <div className="space-y-2 text-xs">
          {phyloSeqs.map((s, i) => (
            <div key={i} className="flex gap-1.5">
              <input value={s.id} onChange={(e) => updateSeqList(phyloSeqs, setPhyloSeqs, i, 'id', e.target.value)} className="w-20 bg-zinc-900 border border-zinc-800 rounded px-2 py-1 text-white" placeholder="label" />
              <input value={s.sequence} onChange={(e) => updateSeqList(phyloSeqs, setPhyloSeqs, i, 'sequence', e.target.value)} className="flex-1 bg-zinc-900 border border-zinc-800 rounded px-2 py-1 text-white font-mono" placeholder="sequence" />
              {phyloSeqs.length > 2 && <button type="button" onClick={() => setPhyloSeqs(phyloSeqs.filter((_, idx) => idx !== i))} className="text-zinc-500 hover:text-red-400" aria-label={`Remove sequence ${s.id || i + 1}`}><X className="w-3.5 h-3.5" aria-hidden="true" /></button>}
            </div>
          ))}
          <div className="flex items-center gap-2">
            <button type="button" onClick={() => phyloSeqs.length < 20 && setPhyloSeqs([...phyloSeqs, { id: `seq${phyloSeqs.length + 1}`, sequence: '' }])} className="px-2 py-1 rounded bg-zinc-800 text-zinc-300 hover:bg-zinc-700 flex items-center gap-1"><Plus className="w-3 h-3" /> Add sequence</button>
            <select value={phyloModel} onChange={(e) => setPhyloModel(e.target.value as typeof phyloModel)} className="bg-zinc-900 border border-zinc-800 rounded px-2 py-1 text-white">
              <option value="jukes-cantor">Jukes-Cantor</option>
              <option value="kimura">Kimura 2-parameter</option>
            </select>
            <button type="button" disabled={busy} onClick={() => run<PhyloResult>('phylogeneticDistance', { sequences: phyloSeqs.filter(s => s.sequence.trim()), model: phyloModel }, setPhyloResult)}
              className="px-3 py-1.5 rounded bg-emerald-500/20 text-emerald-300 hover:bg-emerald-500/30 disabled:opacity-40 flex items-center gap-1.5">
              {busy ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Network className="w-3.5 h-3.5" />} Compute distance matrix
            </button>
          </div>
          <AnimatePresence>
            {phyloResult && (
              <motion.div initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }} className="rounded-md border border-emerald-500/25 bg-emerald-500/5 p-3 space-y-2 overflow-x-auto">
                <table className="text-[11px] font-mono">
                  <thead><tr><td /> {phyloResult.labels.map(l => <td key={l} className="px-2 text-zinc-400">{l}</td>)}</tr></thead>
                  <tbody>
                    {phyloResult.distanceMatrix.map((row, i) => (
                      <tr key={i}><td className="pr-2 text-zinc-400">{phyloResult.labels[i]}</td>{row.map((d, j) => <td key={j} className="px-2 text-emerald-200">{Number.isFinite(d) ? d : '∞'}</td>)}</tr>
                    ))}
                  </tbody>
                </table>
                {phyloResult.closest && <p className="font-sans text-zinc-400">Closest: {phyloResult.closest.a} ↔ {phyloResult.closest.b} ({phyloResult.closest.distance})</p>}
                {phyloResult.farthest && <p className="font-sans text-zinc-400">Farthest: {phyloResult.farthest.a} ↔ {phyloResult.farthest.b} ({phyloResult.farthest.distance})</p>}
              </motion.div>
            )}
          </AnimatePresence>
        </div>
      )}

      {tool === 'motif' && (
        <div className="space-y-2 text-xs">
          {motifSeqs.map((s, i) => (
            <div key={i} className="flex gap-1.5">
              <input value={s.id} onChange={(e) => updateSeqList(motifSeqs, setMotifSeqs, i, 'id', e.target.value)} className="w-20 bg-zinc-900 border border-zinc-800 rounded px-2 py-1 text-white" placeholder="label" />
              <input value={s.sequence} onChange={(e) => updateSeqList(motifSeqs, setMotifSeqs, i, 'sequence', e.target.value)} className="flex-1 bg-zinc-900 border border-zinc-800 rounded px-2 py-1 text-white font-mono" placeholder="sequence" />
              {motifSeqs.length > 1 && <button type="button" onClick={() => setMotifSeqs(motifSeqs.filter((_, idx) => idx !== i))} className="text-zinc-500 hover:text-red-400" aria-label={`Remove sequence ${s.id || i + 1}`}><X className="w-3.5 h-3.5" aria-hidden="true" /></button>}
            </div>
          ))}
          <div className="flex items-center gap-2">
            <button type="button" onClick={() => motifSeqs.length < 20 && setMotifSeqs([...motifSeqs, { id: `seq${motifSeqs.length + 1}`, sequence: '' }])} className="px-2 py-1 rounded bg-zinc-800 text-zinc-300 hover:bg-zinc-700 flex items-center gap-1"><Plus className="w-3 h-3" /> Add sequence</button>
            <input type="number" min={3} max={20} value={motifLen} onChange={(e) => setMotifLen(e.target.value)} className="w-16 bg-zinc-900 border border-zinc-800 rounded px-2 py-1 text-white" placeholder="k-mer len" />
            <button type="button" disabled={busy} onClick={() => run<MotifResult>('motifDetection', { sequences: motifSeqs.filter(s => s.sequence.trim()), motifLength: parseInt(motifLen) || 6 }, setMotifResult)}
              className="px-3 py-1.5 rounded bg-emerald-500/20 text-emerald-300 hover:bg-emerald-500/30 disabled:opacity-40 flex items-center gap-1.5">
              {busy ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <ScanSearch className="w-3.5 h-3.5" />} Find conserved motifs
            </button>
          </div>
          <AnimatePresence>
            {motifResult && (
              <motion.div initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }} className="rounded-md border border-emerald-500/25 bg-emerald-500/5 p-3 space-y-1">
                {motifResult.message ? <p className="text-zinc-400">{motifResult.message}</p> : (
                  <>
                    <p className="text-zinc-400">{motifResult.totalMotifs} motif(s) found · {motifResult.consensusMotifs?.length ?? 0} consensus (&gt;50% conservation)</p>
                    {motifResult.topMotifs?.slice(0, 8).map(m => (
                      <div key={m.motif} className="font-mono flex items-center gap-3">
                        <span className="text-emerald-300">{m.motif}</span>
                        <span className="text-zinc-400 font-sans">×{m.occurrences} · {m.conservation}% conserved · GC {m.gcContent}%{m.isPalindromic && ' · palindromic'}</span>
                      </div>
                    ))}
                  </>
                )}
              </motion.div>
            )}
          </AnimatePresence>
        </div>
      )}

      {tool === 'organism' && (
        <div className="space-y-2 text-xs">
          <div className="grid grid-cols-2 gap-1.5">
            <input value={orgName} onChange={(e) => setOrgName(e.target.value)} className="bg-zinc-900 border border-zinc-800 rounded px-2 py-1.5 text-white" placeholder="Species name" />
            <select value={orgKingdom} onChange={(e) => setOrgKingdom(e.target.value)} className="bg-zinc-900 border border-zinc-800 rounded px-2 py-1.5 text-white">
              {['Animalia', 'Plantae', 'Fungi', 'Bacteria', 'Archaea', 'Protista'].map(k => <option key={k} value={k}>{k}</option>)}
            </select>
            <input value={orgHabitat} onChange={(e) => setOrgHabitat(e.target.value)} className="bg-zinc-900 border border-zinc-800 rounded px-2 py-1.5 text-white" placeholder="Habitat" />
            <input value={orgTraits} onChange={(e) => setOrgTraits(e.target.value)} className="bg-zinc-900 border border-zinc-800 rounded px-2 py-1.5 text-white" placeholder="Traits (comma-separated)" />
          </div>
          <button type="button" disabled={busy || !orgName.trim()} onClick={() => run<OrganismResult>('profile-organism', { name: orgName, kingdom: orgKingdom, habitat: orgHabitat, traits: orgTraits }, setOrgResult)}
            className="px-3 py-1.5 rounded bg-emerald-500/20 text-emerald-300 hover:bg-emerald-500/30 disabled:opacity-40 flex items-center gap-1.5">
            {busy ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Bug className="w-3.5 h-3.5" />} Build profile
          </button>
          <AnimatePresence>
            {orgResult && (
              <motion.div initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }} className="rounded-md border border-emerald-500/25 bg-emerald-500/5 p-3 space-y-1">
                <p className="text-white font-semibold">{orgResult.name} <span className="text-zinc-400 font-normal">({orgResult.kingdom})</span></p>
                <p className="text-zinc-300">{orgResult.summary}</p>
                <p className="text-zinc-500">{orgResult.evolutionaryNotes}</p>
              </motion.div>
            )}
          </AnimatePresence>
        </div>
      )}

      {tool === 'pathway' && (
        <div className="space-y-2 text-xs">
          {pathwaySteps.map((s, i) => (
            <div key={i} className="grid grid-cols-4 gap-1.5">
              <input value={s.substrate} onChange={(e) => setPathwaySteps(pathwaySteps.map((p, idx) => idx === i ? { ...p, substrate: e.target.value } : p))} className="bg-zinc-900 border border-zinc-800 rounded px-2 py-1 text-white" placeholder="substrate" />
              <input value={s.enzyme} onChange={(e) => setPathwaySteps(pathwaySteps.map((p, idx) => idx === i ? { ...p, enzyme: e.target.value } : p))} className="bg-zinc-900 border border-zinc-800 rounded px-2 py-1 text-white" placeholder="enzyme" />
              <input value={s.product} onChange={(e) => setPathwaySteps(pathwaySteps.map((p, idx) => idx === i ? { ...p, product: e.target.value } : p))} className="bg-zinc-900 border border-zinc-800 rounded px-2 py-1 text-white" placeholder="product" />
              <div className="flex gap-1">
                <input value={s.deltaG} onChange={(e) => setPathwaySteps(pathwaySteps.map((p, idx) => idx === i ? { ...p, deltaG: e.target.value } : p))} className="w-full bg-zinc-900 border border-zinc-800 rounded px-2 py-1 text-white" placeholder="ΔG kJ/mol" />
                {pathwaySteps.length > 1 && <button type="button" onClick={() => setPathwaySteps(pathwaySteps.filter((_, idx) => idx !== i))} className="text-zinc-500 hover:text-red-400" aria-label={`Remove pathway step ${s.substrate ? `"${s.substrate}"` : i + 1}`}><X className="w-3.5 h-3.5" aria-hidden="true" /></button>}
              </div>
            </div>
          ))}
          <div className="flex gap-2">
            <button type="button" onClick={() => setPathwaySteps([...pathwaySteps, { substrate: '', enzyme: '', product: '', deltaG: '' }])} className="px-2 py-1 rounded bg-zinc-800 text-zinc-300 hover:bg-zinc-700 flex items-center gap-1"><Plus className="w-3 h-3" /> Add step</button>
            <button type="button" disabled={busy} onClick={() => run<PathwayResult>('map-pathway', { steps: pathwaySteps.map(s => ({ ...s, deltaG: parseFloat(s.deltaG) || undefined })) }, setPathwayResult)}
              className="px-3 py-1.5 rounded bg-emerald-500/20 text-emerald-300 hover:bg-emerald-500/30 disabled:opacity-40 flex items-center gap-1.5">
              {busy ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Route className="w-3.5 h-3.5" />} Map pathway
            </button>
          </div>
          <AnimatePresence>
            {pathwayResult && (
              <motion.div initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }} className="rounded-md border border-emerald-500/25 bg-emerald-500/5 p-3 space-y-1">
                <p className="text-zinc-300">{pathwayResult.summary}</p>
                {pathwayResult.totalDeltaG != null && <p className="text-zinc-400">Total ΔG: {pathwayResult.totalDeltaG} kJ/mol — {pathwayResult.thermodynamicallyFavorable ? 'favorable' : 'unfavorable'}</p>}
                {pathwayResult.chainBreaks.length > 0 && pathwayResult.chainBreaks.map((b, i) => <p key={i} className="text-amber-300">Break at step {b.at}: expected {b.expected}, got {b.actual}</p>)}
              </motion.div>
            )}
          </AnimatePresence>
        </div>
      )}

      {tool === 'protocol' && (
        <div className="space-y-2 text-xs">
          <p className="text-zinc-500">One step per line.</p>
          <textarea value={protocolSteps} onChange={(e) => setProtocolSteps(e.target.value)} rows={5} className="w-full bg-zinc-900 border border-zinc-800 rounded px-2 py-1.5 text-white" />
          <button type="button" disabled={busy} onClick={() => run<ProtocolResult>('review-protocol', { steps: protocolSteps.split('\n').map(s => s.trim()).filter(Boolean) }, setProtocolResult)}
            className="px-3 py-1.5 rounded bg-emerald-500/20 text-emerald-300 hover:bg-emerald-500/30 disabled:opacity-40 flex items-center gap-1.5">
            {busy ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <ClipboardCheck className="w-3.5 h-3.5" />} Review protocol
          </button>
          <AnimatePresence>
            {protocolResult && (
              <motion.div initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }} className={cn('rounded-md border p-3 space-y-1', protocolResult.severity === 'high' ? 'border-red-500/30 bg-red-500/5' : protocolResult.severity === 'medium' ? 'border-amber-500/30 bg-amber-500/5' : 'border-emerald-500/30 bg-emerald-500/5')}>
                <p className="text-zinc-300">{protocolResult.summary}</p>
                {protocolResult.gaps.map((g, i) => (
                  <p key={i} className="text-zinc-400"><span className={cn('px-1.5 py-0.5 rounded text-[10px] uppercase mr-1.5', g.severity === 'high' ? 'bg-red-500/20 text-red-300' : 'bg-amber-500/20 text-amber-300')}>{g.kind}</span>{g.suggestion}</p>
                ))}
              </motion.div>
            )}
          </AnimatePresence>
        </div>
      )}

      {tool === 'gene' && (
        <div className="space-y-2 text-xs">
          <div className="grid grid-cols-3 gap-1.5">
            <input value={geneSymbol} onChange={(e) => setGeneSymbol(e.target.value)} className="bg-zinc-900 border border-zinc-800 rounded px-2 py-1.5 text-white font-mono" placeholder="Gene symbol (TP53)" />
            <input value={geneOrganism} onChange={(e) => setGeneOrganism(e.target.value)} className="bg-zinc-900 border border-zinc-800 rounded px-2 py-1.5 text-white" placeholder="Organism" />
            <input value={geneFunction} onChange={(e) => setGeneFunction(e.target.value)} className="bg-zinc-900 border border-zinc-800 rounded px-2 py-1.5 text-white" placeholder="Known function (optional)" />
          </div>
          <button type="button" disabled={busy || !geneSymbol.trim()} onClick={() => run<GeneFunctionResult>('link-gene-function', { gene: geneSymbol, organism: geneOrganism, function: geneFunction }, setGeneResult)}
            className="px-3 py-1.5 rounded bg-emerald-500/20 text-emerald-300 hover:bg-emerald-500/30 disabled:opacity-40 flex items-center gap-1.5">
            {busy ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Dna className="w-3.5 h-3.5" />} Trace gene → function
          </button>
          <AnimatePresence>
            {geneResult && (
              <motion.div initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }} className="rounded-md border border-emerald-500/25 bg-emerald-500/5 p-3 space-y-1.5">
                <div className="flex items-center gap-2 flex-wrap">
                  {geneResult.chain.map((c, i) => (
                    <span key={i} className="flex items-center gap-1">
                      <span className="px-1.5 py-0.5 rounded bg-zinc-800 text-emerald-200">{c.entity}</span>
                      {i < geneResult.chain.length - 1 && <span className="text-zinc-500">→</span>}
                    </span>
                  ))}
                </div>
                <div className="flex items-center gap-3">
                  {geneResult.externalLinks.map(l => <a key={l.url} href={l.url} target="_blank" rel="noopener noreferrer" className="text-cyan-400 hover:text-cyan-300">{l.source}</a>)}
                </div>
              </motion.div>
            )}
          </AnimatePresence>
        </div>
      )}

      {tool === 'evolution' && (
        <div className="space-y-2 text-xs">
          <input value={evoOrganisms} onChange={(e) => setEvoOrganisms(e.target.value)} className="w-full bg-zinc-900 border border-zinc-800 rounded px-2 py-1.5 text-white" placeholder="Organisms, comma-separated" />
          <button type="button" disabled={busy} onClick={() => run<EvolutionResult>('trace-evolution', { organisms: evoOrganisms.split(',').map(s => s.trim()).filter(Boolean) }, setEvoResult)}
            className="px-3 py-1.5 rounded bg-emerald-500/20 text-emerald-300 hover:bg-emerald-500/30 disabled:opacity-40 flex items-center gap-1.5">
            {busy ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <GitBranch className="w-3.5 h-3.5" />} Trace relationship
          </button>
          <AnimatePresence>
            {evoResult && (
              <motion.div initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }} className="rounded-md border border-emerald-500/25 bg-emerald-500/5 p-3 space-y-1">
                <p className="text-zinc-300">{evoResult.commonality}</p>
                <p className="text-zinc-500">{evoResult.suggestion}</p>
                <div className="flex flex-wrap gap-1.5 pt-1">
                  {evoResult.organisms.map(o => <span key={o.name} className="px-1.5 py-0.5 rounded bg-zinc-800 text-zinc-300">{o.name} · {o.group}</span>)}
                </div>
              </motion.div>
            )}
          </AnimatePresence>
        </div>
      )}

      {tool === 'fasta' && (
        <div className="space-y-2 text-xs">
          <textarea value={fastaText} onChange={(e) => setFastaText(e.target.value)} rows={6} className="w-full bg-zinc-900 border border-zinc-800 rounded px-2 py-1.5 text-white font-mono" placeholder=">header&#10;SEQUENCE" />
          <button type="button" disabled={busy} onClick={() => run<FastaResult>('parse-fasta', { text: fastaText }, setFastaResult)}
            className="px-3 py-1.5 rounded bg-emerald-500/20 text-emerald-300 hover:bg-emerald-500/30 disabled:opacity-40 flex items-center gap-1.5">
            {busy ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <FileText className="w-3.5 h-3.5" />} Parse FASTA
          </button>
          <AnimatePresence>
            {fastaResult && (
              <motion.div initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }} className="rounded-md border border-emerald-500/25 bg-emerald-500/5 p-3 space-y-1.5">
                <p className="text-zinc-400">{fastaResult.count} record(s)</p>
                {fastaResult.records.map(r => (
                  <div key={r.id} className="font-mono">
                    <span className="text-emerald-300">{r.id}</span> <span className="text-zinc-500 font-sans">({r.length} bp)</span>
                    <p className="text-zinc-400 truncate">{r.sequence.slice(0, 60)}{r.sequence.length > 60 ? '…' : ''}</p>
                  </div>
                ))}
              </motion.div>
            )}
          </AnimatePresence>
        </div>
      )}
    </div>
  );
}

export default BioResearchPanel;
