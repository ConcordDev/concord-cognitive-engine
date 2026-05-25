'use client';

/**
 * KnowledgeBaseWorkbench — the intelligent layer of the commonsense lens.
 *
 * Wires the seven backlog macros against the per-user fact store:
 *  - knowledgeGraph      → interactive concept-graph (TreeDiagram)
 *  - inferChain          → inference chaining — derive new facts
 *  - contradictionScan   → contradiction detection across the fact store
 *  - relationTaxonomy    → IsA / PartOf / Causes / UsedFor browsing
 *  - confidenceQuery     → confidence-weighted "very likely true about X"
 *  - extractFacts        → import facts from free text
 *  - provenanceChain     → fact provenance / derivation citation chain
 *
 * Every value rendered comes from a real macro call. No seed/mock data.
 */

import { useState, useCallback, useEffect, useMemo } from 'react';
import {
  Network, GitBranch, AlertTriangle, Layers3, Filter, FileText,
  ScrollText, Loader2, Plus, Trash2, RefreshCw, ArrowRight, CheckCircle2,
} from 'lucide-react';
import { lensRun } from '@/lib/api/client';
import { TreeDiagram, ChartKit } from '@/components/viz';
import type { TreeNode } from '@/components/viz';

// ---------------------------------------------------------------------------
// Shared types — every shape mirrors the commonsense.js macro result.
// ---------------------------------------------------------------------------

interface StoredFact {
  id: string;
  subject: string;
  relation: string;
  object: string;
  confidence: number;
  source?: string;
  createdAt?: string;
}

interface GraphNode { id: string; label: string; degree: number; isFocus: boolean }
interface GraphEdge {
  id: string; source: string; target: string;
  relation: string; label: string; weight: number; source_kind?: string;
}
interface GraphResult {
  focus: string | null; depth: number;
  nodes: GraphNode[]; edges: GraphEdge[];
  stats: { nodeCount: number; edgeCount: number; conceptNetEdges: number; maxDegree: number };
}

interface InferenceRow {
  subject: string; relation: string; relationLabel: string; object: string;
  confidence: number; hops: number; rationale: string;
  derivation: { subject: string; relation: string; object: string; confidence: number }[];
}
interface InferResult {
  inferences: InferenceRow[]; count: number; baseFactCount: number;
  maxHops: number; minConfidence: number;
}

interface ContradictionRow {
  kind: string; severity: string; subject: string; relation: string;
  description: string;
  factA: { id: string; object: string; confidence: number };
  factB: { id: string; object: string; confidence: number };
}
interface ContradictionResult {
  contradictions: ContradictionRow[]; count: number;
  factsScanned: number; consistent: boolean; highSeverity: number;
}

interface TaxRelation {
  id: string; label: string; inverse: string | null;
  symmetric: boolean; transitive: boolean; usageCount: number;
}
interface TaxGroup { group: string; description: string; relations: TaxRelation[] }
interface TaxResult {
  taxonomy: TaxGroup[]; totalRelationTypes: number; relationsInUse: number;
}

interface QueryMatch {
  subject: string; relation: string; relationLabel: string; object: string;
  confidence: number; source: string; origin: string;
}
interface QueryResult {
  subject: string; minConfidence: number; matches: QueryMatch[];
  count: number; localCount: number; conceptNetCount: number; interpretation: string;
}

interface ExtractedRow {
  subject: string; relation: string; relationLabel: string; object: string;
  confidence: number; sourceSentence: string;
}
interface ExtractResult {
  extracted: ExtractedRow[]; count: number; committed: number; charactersAnalyzed: number;
}

interface ProvStep {
  step: number; kind: string; detail?: string;
  fact?: { id: string; subject: string; relation: string; object: string };
  source?: string; confidence?: number; count?: number;
  facts?: { id: string; subject: string; relation: string; object: string; confidence: number }[];
  derivation?: { subject: string; relation: string; object: string; confidence: number }[];
  inferredConfidence?: number;
}
interface ProvResult {
  factId: string;
  fact: { subject: string; relation: string; object: string; confidence: number };
  chain: ProvStep[]; depth: number; independentlyVerified: boolean; rootSource: string;
}

type TabId = 'graph' | 'infer' | 'contradict' | 'taxonomy' | 'query' | 'extract' | 'provenance';

const TABS: { id: TabId; label: string; icon: typeof Network }[] = [
  { id: 'graph', label: 'Knowledge Graph', icon: Network },
  { id: 'infer', label: 'Inference Chain', icon: GitBranch },
  { id: 'contradict', label: 'Contradictions', icon: AlertTriangle },
  { id: 'taxonomy', label: 'Relation Taxonomy', icon: Layers3 },
  { id: 'query', label: 'Confidence Query', icon: Filter },
  { id: 'extract', label: 'Text Import', icon: FileText },
  { id: 'provenance', label: 'Provenance', icon: ScrollText },
];

async function runMacro<T>(action: string, input: Record<string, unknown>): Promise<{ ok: boolean; result: T | null; error: string | null }> {
  const r = await lensRun<T>('commonsense', action, input);
  return r.data;
}

function confTone(c: number): TreeNode['tone'] {
  if (c >= 0.75) return 'good';
  if (c >= 0.45) return 'info';
  return 'warn';
}

// ===========================================================================

export function KnowledgeBaseWorkbench() {
  const [tab, setTab] = useState<TabId>('graph');
  const [facts, setFacts] = useState<StoredFact[]>([]);
  const [factsLoading, setFactsLoading] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);

  // --- Fact store ----------------------------------------------------------
  const loadFacts = useCallback(async () => {
    setFactsLoading(true);
    const r = await runMacro<{ facts: StoredFact[] }>('factList', {});
    if (r.ok && r.result) setFacts(r.result.facts);
    setFactsLoading(false);
  }, []);

  useEffect(() => { loadFacts(); }, [loadFacts]);

  // --- Add-fact form -------------------------------------------------------
  const [fSubject, setFSubject] = useState('');
  const [fRelation, setFRelation] = useState('is_a');
  const [fObject, setFObject] = useState('');
  const [fConfidence, setFConfidence] = useState(0.8);

  const addFact = useCallback(async () => {
    if (!fSubject.trim() || !fObject.trim()) { setErr('Subject and object are required.'); return; }
    setBusy('add'); setErr(null);
    const r = await runMacro<{ fact: StoredFact }>('factAdd', {
      subject: fSubject.trim(), relation: fRelation, object: fObject.trim(), confidence: fConfidence,
    });
    setBusy(null);
    if (!r.ok) { setErr(r.error || 'Failed to add fact.'); return; }
    setFSubject(''); setFObject('');
    await loadFacts();
  }, [fSubject, fRelation, fObject, fConfidence, loadFacts]);

  const deleteFact = useCallback(async (id: string) => {
    setBusy(`del-${id}`);
    await runMacro('factDelete', { id });
    setBusy(null);
    await loadFacts();
  }, [loadFacts]);

  // --- Knowledge Graph -----------------------------------------------------
  const [graphFocus, setGraphFocus] = useState('');
  const [graphDepth, setGraphDepth] = useState(2);
  const [graphCN, setGraphCN] = useState(true);
  const [graph, setGraph] = useState<GraphResult | null>(null);

  const runGraph = useCallback(async () => {
    setBusy('graph'); setErr(null);
    const r = await runMacro<GraphResult>('knowledgeGraph', {
      focus: graphFocus.trim() || undefined, depth: graphDepth, includeConceptNet: graphCN,
    });
    setBusy(null);
    if (!r.ok || !r.result) { setErr(r.error || 'Graph build failed.'); setGraph(null); return; }
    setGraph(r.result);
  }, [graphFocus, graphDepth, graphCN]);

  // Build a TreeDiagram from the graph: focus (or top-degree) node at the root,
  // its outgoing edges as children, recursively to depth 2.
  const graphTree = useMemo<TreeNode | null>(() => {
    if (!graph || graph.nodes.length === 0) return null;
    const nodeById = new Map(graph.nodes.map((n) => [n.id, n]));
    const outgoing = new Map<string, GraphEdge[]>();
    for (const e of graph.edges) {
      if (!outgoing.has(e.source)) outgoing.set(e.source, []);
      outgoing.get(e.source)!.push(e);
    }
    const rootNode = graph.nodes.find((n) => n.isFocus) || graph.nodes[0];
    const build = (nodeId: string, depth: number, seen: Set<string>): TreeNode => {
      const node = nodeById.get(nodeId);
      const edges = depth < 3 ? (outgoing.get(nodeId) || []) : [];
      const children: TreeNode[] = [];
      for (const e of edges) {
        if (seen.has(e.id)) continue;
        const next = new Set(seen); next.add(e.id);
        const targetNode = nodeById.get(e.target);
        children.push({
          id: `${e.id}`,
          label: `${e.label} → ${targetNode?.label || e.target}`,
          detail: `weight ${e.weight.toFixed(2)}${e.source_kind === 'conceptnet' ? ' · ConceptNet' : ' · local'}`,
          tone: e.source_kind === 'conceptnet' ? 'info' : confTone(e.weight),
          children: build(e.target, depth + 1, next).children,
        });
      }
      return {
        id: nodeId,
        label: node?.label || nodeId,
        detail: `degree ${node?.degree ?? 0}`,
        tone: node?.isFocus ? 'good' : 'default',
        children,
      };
    };
    return build(rootNode.id, 0, new Set());
  }, [graph]);

  // --- Inference Chain -----------------------------------------------------
  const [inferHops, setInferHops] = useState(3);
  const [inferMinConf, setInferMinConf] = useState(0.3);
  const [infer, setInfer] = useState<InferResult | null>(null);

  const runInfer = useCallback(async () => {
    setBusy('infer'); setErr(null);
    const r = await runMacro<InferResult>('inferChain', { maxHops: inferHops, minConfidence: inferMinConf });
    setBusy(null);
    if (!r.ok || !r.result) { setErr(r.error || 'Inference failed.'); setInfer(null); return; }
    setInfer(r.result);
  }, [inferHops, inferMinConf]);

  const commitInference = useCallback(async (row: InferenceRow) => {
    setBusy(`commit-${row.subject}-${row.object}`);
    await runMacro('factAdd', {
      subject: row.subject, relation: row.relation, object: row.object,
      confidence: row.confidence, source: 'inference',
    });
    setBusy(null);
    await loadFacts();
    await runInfer();
  }, [loadFacts, runInfer]);

  // --- Contradiction Scan --------------------------------------------------
  const [contra, setContra] = useState<ContradictionResult | null>(null);
  const runContra = useCallback(async () => {
    setBusy('contra'); setErr(null);
    const r = await runMacro<ContradictionResult>('contradictionScan', {});
    setBusy(null);
    if (!r.ok || !r.result) { setErr(r.error || 'Scan failed.'); setContra(null); return; }
    setContra(r.result);
  }, []);

  // --- Relation Taxonomy ---------------------------------------------------
  const [tax, setTax] = useState<TaxResult | null>(null);
  const runTax = useCallback(async () => {
    setBusy('tax'); setErr(null);
    const r = await runMacro<TaxResult>('relationTaxonomy', {});
    setBusy(null);
    if (!r.ok || !r.result) { setErr(r.error || 'Taxonomy load failed.'); return; }
    setTax(r.result);
  }, []);

  // --- Confidence Query ----------------------------------------------------
  const [qSubject, setQSubject] = useState('');
  const [qMinConf, setQMinConf] = useState(0.5);
  const [qUseCN, setQUseCN] = useState(true);
  const [query, setQuery] = useState<QueryResult | null>(null);
  const runQuery = useCallback(async () => {
    if (!qSubject.trim()) { setErr('Enter a subject to query.'); return; }
    setBusy('query'); setErr(null);
    const r = await runMacro<QueryResult>('confidenceQuery', {
      subject: qSubject.trim(), minConfidence: qMinConf, useConceptNet: qUseCN,
    });
    setBusy(null);
    if (!r.ok || !r.result) { setErr(r.error || 'Query failed.'); setQuery(null); return; }
    setQuery(r.result);
  }, [qSubject, qMinConf, qUseCN]);

  // --- Text Import / Extraction --------------------------------------------
  const [extractText, setExtractText] = useState('');
  const [extract, setExtract] = useState<ExtractResult | null>(null);
  const runExtract = useCallback(async (commit: boolean) => {
    if (!extractText.trim()) { setErr('Paste some text to extract from.'); return; }
    setBusy(commit ? 'extract-commit' : 'extract'); setErr(null);
    const r = await runMacro<ExtractResult>('extractFacts', { text: extractText, commit });
    setBusy(null);
    if (!r.ok || !r.result) { setErr(r.error || 'Extraction failed.'); setExtract(null); return; }
    setExtract(r.result);
    if (commit) await loadFacts();
  }, [extractText, loadFacts]);

  // --- Provenance ----------------------------------------------------------
  const [provFactId, setProvFactId] = useState('');
  const [prov, setProv] = useState<ProvResult | null>(null);
  const runProv = useCallback(async (factId: string) => {
    if (!factId) { setErr('Select a fact to trace.'); return; }
    setBusy('prov'); setErr(null);
    setProvFactId(factId);
    const r = await runMacro<ProvResult>('provenanceChain', { factId });
    setBusy(null);
    if (!r.ok || !r.result) { setErr(r.error || 'Provenance trace failed.'); setProv(null); return; }
    setProv(r.result);
  }, []);

  const relationOptions = useMemo(() => {
    if (tax) return tax.taxonomy.flatMap((g) => g.relations.map((rel) => rel.id));
    return ['is_a', 'part_of', 'has_a', 'made_of', 'used_for', 'capable_of', 'has_property',
      'causes', 'has_prerequisite', 'located_at', 'synonym', 'antonym', 'related_to'];
  }, [tax]);

  return (
    <div className="space-y-4">
      <header className="flex items-center justify-between gap-3 border-b border-amber-500/15 pb-3">
        <div className="flex items-center gap-2">
          <Network className="h-5 w-5 text-amber-400" />
          <h2 className="text-sm font-semibold text-white">Knowledge Base Workbench</h2>
          <span className="rounded bg-zinc-800 px-1.5 py-0.5 font-mono text-[10px] uppercase tracking-wider text-zinc-400">
            {facts.length} facts
          </span>
        </div>
        <button
          type="button" onClick={loadFacts}
          className="inline-flex items-center gap-1 rounded-md border border-zinc-800 px-2 py-1 text-[11px] text-zinc-400 hover:text-white hover:border-zinc-600"
        >
          {factsLoading ? <Loader2 className="h-3 w-3 animate-spin" /> : <RefreshCw className="h-3 w-3" />}
          Reload
        </button>
      </header>

      {/* Add-fact bar — feeds every downstream feature */}
      <div className="grid grid-cols-1 gap-2 rounded-lg border border-amber-500/15 bg-amber-500/[0.03] p-3 md:grid-cols-[1fr_auto_1fr_auto_auto]">
        <input
          type="text" value={fSubject} onChange={(e) => setFSubject(e.target.value)}
          placeholder="Subject — e.g. dog"
          className="rounded-md border border-zinc-800 bg-zinc-950 px-2.5 py-1.5 text-xs text-white placeholder-zinc-600 focus:border-amber-500/40 focus:outline-none"
        />
        <select
          value={fRelation} onChange={(e) => setFRelation(e.target.value)}
          className="rounded-md border border-zinc-800 bg-zinc-950 px-2 py-1.5 text-xs text-white focus:border-amber-500/40 focus:outline-none"
        >
          {relationOptions.map((rel) => <option key={rel} value={rel}>{rel.replace(/_/g, ' ')}</option>)}
        </select>
        <input
          type="text" value={fObject} onChange={(e) => setFObject(e.target.value)}
          placeholder="Object — e.g. animal"
          className="rounded-md border border-zinc-800 bg-zinc-950 px-2.5 py-1.5 text-xs text-white placeholder-zinc-600 focus:border-amber-500/40 focus:outline-none"
        />
        <div className="flex items-center gap-1.5">
          <label className="text-[10px] text-zinc-400">conf</label>
          <input
            type="number" min={0} max={1} step={0.05} value={fConfidence}
            onChange={(e) => setFConfidence(Math.max(0, Math.min(1, Number(e.target.value))))}
            className="w-16 rounded-md border border-zinc-800 bg-zinc-950 px-2 py-1.5 text-xs text-white focus:border-amber-500/40 focus:outline-none"
          />
        </div>
        <button
          type="button" onClick={addFact} disabled={busy === 'add'}
          className="inline-flex items-center justify-center gap-1 rounded-md border border-amber-500/30 bg-amber-500/10 px-3 py-1.5 text-xs font-medium text-amber-200 hover:bg-amber-500/20 disabled:opacity-50"
        >
          {busy === 'add' ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Plus className="h-3.5 w-3.5" />}
          Add Fact
        </button>
      </div>

      {err && (
        <div className="flex items-center gap-2 rounded-md border border-rose-500/30 bg-rose-500/10 px-3 py-2 text-[11px] text-rose-300">
          <AlertTriangle className="h-3.5 w-3.5 shrink-0" /> {err}
        </div>
      )}

      {/* Tab strip */}
      <div className="flex flex-wrap gap-1 border-b border-zinc-800">
        {TABS.map(({ id, label, icon: Icon }) => (
          <button
            key={id} type="button" onClick={() => { setTab(id); setErr(null); if (id === 'taxonomy' && !tax) runTax(); }}
            className={`flex items-center gap-1.5 rounded-t-md px-3 py-2 text-xs font-medium transition-colors ${
              tab === id ? 'bg-amber-500/10 text-amber-200 border-b-2 border-amber-400' : 'text-zinc-400 hover:text-zinc-200'
            }`}
          >
            <Icon className="h-3.5 w-3.5" /> {label}
          </button>
        ))}
      </div>

      {/* ---------- Knowledge Graph ---------- */}
      {tab === 'graph' && (
        <div className="space-y-3">
          <div className="flex flex-wrap items-center gap-2">
            <input
              type="text" value={graphFocus} onChange={(e) => setGraphFocus(e.target.value)}
              placeholder="Focus concept (blank = whole store)"
              className="flex-1 min-w-[180px] rounded-md border border-zinc-800 bg-zinc-950 px-2.5 py-1.5 text-xs text-white placeholder-zinc-600 focus:border-amber-500/40 focus:outline-none"
            />
            <label className="flex items-center gap-1 text-[11px] text-zinc-400">
              depth
              <select
                value={graphDepth} onChange={(e) => setGraphDepth(Number(e.target.value))}
                className="rounded-md border border-zinc-800 bg-zinc-950 px-2 py-1 text-xs text-white"
              >
                {[1, 2, 3, 4].map((d) => <option key={d} value={d}>{d}</option>)}
              </select>
            </label>
            <label className="flex items-center gap-1.5 text-[11px] text-zinc-400">
              <input type="checkbox" checked={graphCN} onChange={(e) => setGraphCN(e.target.checked)} className="accent-amber-500" />
              enrich with ConceptNet
            </label>
            <button
              type="button" onClick={runGraph} disabled={busy === 'graph'}
              className="inline-flex items-center gap-1 rounded-md border border-amber-500/30 bg-amber-500/10 px-3 py-1.5 text-xs font-medium text-amber-200 hover:bg-amber-500/20 disabled:opacity-50"
            >
              {busy === 'graph' ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Network className="h-3.5 w-3.5" />}
              Build Graph
            </button>
          </div>
          {graph && (
            <>
              <div className="grid grid-cols-4 gap-2">
                {[
                  { label: 'Nodes', value: graph.stats.nodeCount },
                  { label: 'Edges', value: graph.stats.edgeCount },
                  { label: 'ConceptNet edges', value: graph.stats.conceptNetEdges },
                  { label: 'Max degree', value: graph.stats.maxDegree },
                ].map((s) => (
                  <div key={s.label} className="rounded-md border border-zinc-800 bg-zinc-950 p-2 text-center">
                    <div className="text-lg font-bold text-amber-300">{s.value}</div>
                    <div className="text-[10px] text-zinc-400">{s.label}</div>
                  </div>
                ))}
              </div>
              {graphTree ? (
                <TreeDiagram root={graphTree} onSelect={(n) => setGraphFocus(n.label.split(' → ').pop() || graphFocus)} />
              ) : (
                <p className="rounded-md border border-zinc-800 bg-zinc-950 p-4 text-center text-xs text-zinc-400">
                  No connected facts. Add facts above, then build the graph.
                </p>
              )}
              {graph.nodes.length > 0 && (
                <ChartKit
                  kind="bar"
                  data={graph.nodes.slice(0, 12).map((n) => ({ name: n.label, degree: n.degree }))}
                  xKey="name"
                  series={[{ key: 'degree', label: 'Connections', color: '#f59e0b' }]}
                  height={180}
                />
              )}
            </>
          )}
        </div>
      )}

      {/* ---------- Inference Chain ---------- */}
      {tab === 'infer' && (
        <div className="space-y-3">
          <div className="flex flex-wrap items-center gap-2">
            <label className="flex items-center gap-1 text-[11px] text-zinc-400">
              max hops
              <select value={inferHops} onChange={(e) => setInferHops(Number(e.target.value))}
                className="rounded-md border border-zinc-800 bg-zinc-950 px-2 py-1 text-xs text-white">
                {[1, 2, 3, 4, 5].map((d) => <option key={d} value={d}>{d}</option>)}
              </select>
            </label>
            <label className="flex items-center gap-1 text-[11px] text-zinc-400">
              min confidence {inferMinConf.toFixed(2)}
              <input type="range" min={0} max={1} step={0.05} value={inferMinConf}
                onChange={(e) => setInferMinConf(Number(e.target.value))} className="accent-amber-500" />
            </label>
            <button
              type="button" onClick={runInfer} disabled={busy === 'infer'}
              className="inline-flex items-center gap-1 rounded-md border border-amber-500/30 bg-amber-500/10 px-3 py-1.5 text-xs font-medium text-amber-200 hover:bg-amber-500/20 disabled:opacity-50"
            >
              {busy === 'infer' ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <GitBranch className="h-3.5 w-3.5" />}
              Derive Facts
            </button>
          </div>
          {infer && (
            <div className="space-y-2">
              <p className="text-[11px] text-zinc-400">
                {infer.count} new fact(s) derivable via transitive closure over {infer.baseFactCount} base fact(s).
              </p>
              {infer.inferences.map((row, i) => (
                <div key={`${row.subject}-${row.object}-${i}`} className="rounded-md border border-indigo-500/25 bg-indigo-500/[0.04] p-2.5">
                  <div className="flex items-center gap-2 text-xs">
                    <span className="font-mono text-cyan-300">{row.subject}</span>
                    <span className="rounded-full border border-indigo-500/40 bg-indigo-500/10 px-1.5 py-0.5 text-[10px] text-indigo-200">{row.relationLabel}</span>
                    <span className="font-mono text-violet-300">{row.object}</span>
                    <span className="ml-auto font-mono text-[10px] text-zinc-400">conf {row.confidence.toFixed(3)} · {row.hops} hops</span>
                    <button
                      type="button" onClick={() => commitInference(row)}
                      disabled={busy === `commit-${row.subject}-${row.object}`}
                      className="inline-flex items-center gap-1 rounded border border-emerald-500/30 bg-emerald-500/10 px-1.5 py-0.5 text-[10px] text-emerald-200 hover:bg-emerald-500/20 disabled:opacity-50"
                    >
                      {busy === `commit-${row.subject}-${row.object}` ? <Loader2 className="h-3 w-3 animate-spin" /> : <Plus className="h-3 w-3" />}
                      Commit
                    </button>
                  </div>
                  <div className="mt-1.5 flex flex-wrap items-center gap-1 text-[10px] text-zinc-400">
                    <span className="italic">{row.rationale}:</span>
                    {row.derivation.map((d, j) => (
                      <span key={j} className="flex items-center gap-1">
                        {j > 0 && <ArrowRight className="h-2.5 w-2.5 text-zinc-700" />}
                        <span className="rounded bg-zinc-900 px-1 py-0.5 font-mono text-zinc-400">{d.subject} {d.relation} {d.object}</span>
                      </span>
                    ))}
                  </div>
                </div>
              ))}
              {infer.count === 0 && (
                <p className="rounded-md border border-zinc-800 bg-zinc-950 p-4 text-center text-xs text-zinc-400">
                  No new facts derivable. Add chained transitive facts (e.g. A IsA B, B IsA C).
                </p>
              )}
            </div>
          )}
        </div>
      )}

      {/* ---------- Contradiction Scan ---------- */}
      {tab === 'contradict' && (
        <div className="space-y-3">
          <button
            type="button" onClick={runContra} disabled={busy === 'contra'}
            className="inline-flex items-center gap-1 rounded-md border border-amber-500/30 bg-amber-500/10 px-3 py-1.5 text-xs font-medium text-amber-200 hover:bg-amber-500/20 disabled:opacity-50"
          >
            {busy === 'contra' ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <AlertTriangle className="h-3.5 w-3.5" />}
            Scan Fact Store
          </button>
          {contra && (
            <div className="space-y-2">
              <div className={`flex items-center gap-2 rounded-md border px-3 py-2 text-xs ${
                contra.consistent ? 'border-emerald-500/30 bg-emerald-500/10 text-emerald-300' : 'border-rose-500/30 bg-rose-500/10 text-rose-300'
              }`}>
                {contra.consistent ? <CheckCircle2 className="h-4 w-4" /> : <AlertTriangle className="h-4 w-4" />}
                {contra.consistent
                  ? `Fact store is consistent — scanned ${contra.factsScanned} fact(s).`
                  : `${contra.count} contradiction(s) found across ${contra.factsScanned} fact(s) · ${contra.highSeverity} high-severity.`}
              </div>
              {contra.contradictions.map((c, i) => (
                <div key={i} className="rounded-md border border-rose-500/25 bg-rose-500/[0.04] p-2.5">
                  <div className="flex items-center gap-2">
                    <span className={`rounded-full px-1.5 py-0.5 text-[9px] font-semibold uppercase ${
                      c.severity === 'high' ? 'bg-rose-500/20 text-rose-300' : 'bg-amber-500/20 text-amber-300'
                    }`}>{c.severity}</span>
                    <span className="rounded bg-zinc-900 px-1.5 py-0.5 text-[10px] text-zinc-400">{c.kind}</span>
                  </div>
                  <p className="mt-1 text-xs text-zinc-300">{c.description}</p>
                  <div className="mt-1.5 flex flex-wrap gap-1.5 text-[10px]">
                    <span className="rounded bg-zinc-900 px-1.5 py-0.5 font-mono text-zinc-400">
                      A: {c.subject} {c.relation} {c.factA.object} ({c.factA.confidence})
                    </span>
                    <span className="rounded bg-zinc-900 px-1.5 py-0.5 font-mono text-zinc-400">
                      B: {c.subject} {c.relation} {c.factB.object} ({c.factB.confidence})
                    </span>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {/* ---------- Relation Taxonomy ---------- */}
      {tab === 'taxonomy' && (
        <div className="space-y-3">
          <div className="flex items-center gap-2">
            <button
              type="button" onClick={runTax} disabled={busy === 'tax'}
              className="inline-flex items-center gap-1 rounded-md border border-amber-500/30 bg-amber-500/10 px-3 py-1.5 text-xs font-medium text-amber-200 hover:bg-amber-500/20 disabled:opacity-50"
            >
              {busy === 'tax' ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Layers3 className="h-3.5 w-3.5" />}
              Refresh Taxonomy
            </button>
            {tax && (
              <span className="text-[11px] text-zinc-400">
                {tax.relationsInUse}/{tax.totalRelationTypes} relation types in use
              </span>
            )}
          </div>
          {tax && tax.taxonomy.map((g) => (
            <div key={g.group} className="rounded-md border border-zinc-800 bg-zinc-950 p-3">
              <div className="flex items-baseline gap-2">
                <h3 className="text-xs font-semibold text-amber-200">{g.group}</h3>
                <span className="text-[10px] text-zinc-400">{g.description}</span>
              </div>
              <div className="mt-2 grid grid-cols-1 gap-1.5 sm:grid-cols-2">
                {g.relations.map((rel) => (
                  <button
                    key={rel.id} type="button"
                    onClick={() => { setFRelation(rel.id); }}
                    className="flex items-center gap-2 rounded border border-zinc-800 bg-zinc-900/60 px-2 py-1.5 text-left text-[11px] hover:border-amber-500/30"
                  >
                    <span className="font-mono text-cyan-300">{rel.label}</span>
                    <span className="flex gap-1">
                      {rel.transitive && <span className="rounded bg-indigo-500/15 px-1 text-[9px] text-indigo-300">transitive</span>}
                      {rel.symmetric && <span className="rounded bg-violet-500/15 px-1 text-[9px] text-violet-300">symmetric</span>}
                    </span>
                    {rel.inverse && <span className="text-[10px] text-zinc-400">inv: {rel.inverse}</span>}
                    <span className="ml-auto rounded-full bg-amber-500/15 px-1.5 py-0.5 font-mono text-[10px] text-amber-300">{rel.usageCount}</span>
                  </button>
                ))}
              </div>
            </div>
          ))}
        </div>
      )}

      {/* ---------- Confidence Query ---------- */}
      {tab === 'query' && (
        <div className="space-y-3">
          <div className="flex flex-wrap items-center gap-2">
            <input
              type="text" value={qSubject} onChange={(e) => setQSubject(e.target.value)}
              placeholder="Subject — things very likely true about…"
              className="flex-1 min-w-[180px] rounded-md border border-zinc-800 bg-zinc-950 px-2.5 py-1.5 text-xs text-white placeholder-zinc-600 focus:border-amber-500/40 focus:outline-none"
              onKeyDown={(e) => e.key === 'Enter' && runQuery()}
            />
            <label className="flex items-center gap-1 text-[11px] text-zinc-400">
              min conf {qMinConf.toFixed(2)}
              <input type="range" min={0} max={1} step={0.05} value={qMinConf}
                onChange={(e) => setQMinConf(Number(e.target.value))} className="accent-amber-500" />
            </label>
            <label className="flex items-center gap-1.5 text-[11px] text-zinc-400">
              <input type="checkbox" checked={qUseCN} onChange={(e) => setQUseCN(e.target.checked)} className="accent-amber-500" />
              include ConceptNet
            </label>
            <button
              type="button" onClick={runQuery} disabled={busy === 'query'}
              className="inline-flex items-center gap-1 rounded-md border border-amber-500/30 bg-amber-500/10 px-3 py-1.5 text-xs font-medium text-amber-200 hover:bg-amber-500/20 disabled:opacity-50"
            >
              {busy === 'query' ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Filter className="h-3.5 w-3.5" />}
              Query
            </button>
          </div>
          {query && (
            <div className="space-y-2">
              <p className="text-[11px] text-zinc-400">
                {query.interpretation} <span className="text-zinc-600">· {query.localCount} local · {query.conceptNetCount} ConceptNet</span>
              </p>
              {query.matches.map((m, i) => (
                <div key={i} className="flex items-center gap-2 rounded-md border border-zinc-800 bg-zinc-950 p-2 text-xs">
                  <span className={`rounded px-1.5 py-0.5 text-[9px] font-semibold uppercase ${
                    m.origin === 'conceptnet' ? 'bg-sky-500/15 text-sky-300' : 'bg-emerald-500/15 text-emerald-300'
                  }`}>{m.origin}</span>
                  <span className="rounded-full border border-amber-500/30 bg-amber-500/10 px-1.5 py-0.5 text-[10px] text-amber-200">{m.relationLabel}</span>
                  <span className="font-mono text-violet-300">{m.object}</span>
                  <div className="ml-auto flex items-center gap-1.5">
                    <div className="h-1.5 w-20 overflow-hidden rounded-full bg-zinc-800">
                      <div className="h-full rounded-full bg-emerald-500/70" style={{ width: `${m.confidence * 100}%` }} />
                    </div>
                    <span className="font-mono text-[10px] text-zinc-400">{(m.confidence * 100).toFixed(0)}%</span>
                  </div>
                </div>
              ))}
              {query.count === 0 && (
                <p className="rounded-md border border-zinc-800 bg-zinc-950 p-4 text-center text-xs text-zinc-400">
                  Nothing meets the confidence threshold. Lower the slider or add facts.
                </p>
              )}
            </div>
          )}
        </div>
      )}

      {/* ---------- Text Import ---------- */}
      {tab === 'extract' && (
        <div className="space-y-3">
          <textarea
            value={extractText} onChange={(e) => setExtractText(e.target.value)} rows={5}
            placeholder="Paste text — e.g. 'A dog is an animal. Dogs can bark. A tail is part of a dog. Fire causes smoke.'"
            className="w-full rounded-md border border-zinc-800 bg-zinc-950 px-3 py-2 text-xs text-white placeholder-zinc-600 focus:border-amber-500/40 focus:outline-none"
          />
          <div className="flex items-center gap-2">
            <button
              type="button" onClick={() => runExtract(false)} disabled={busy === 'extract' || busy === 'extract-commit'}
              className="inline-flex items-center gap-1 rounded-md border border-zinc-700 bg-zinc-900 px-3 py-1.5 text-xs font-medium text-zinc-200 hover:bg-zinc-800 disabled:opacity-50"
            >
              {busy === 'extract' ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <FileText className="h-3.5 w-3.5" />}
              Preview Triples
            </button>
            <button
              type="button" onClick={() => runExtract(true)} disabled={busy === 'extract' || busy === 'extract-commit'}
              className="inline-flex items-center gap-1 rounded-md border border-amber-500/30 bg-amber-500/10 px-3 py-1.5 text-xs font-medium text-amber-200 hover:bg-amber-500/20 disabled:opacity-50"
            >
              {busy === 'extract-commit' ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Plus className="h-3.5 w-3.5" />}
              Extract &amp; Import
            </button>
          </div>
          {extract && (
            <div className="space-y-2">
              <p className="text-[11px] text-zinc-400">
                {extract.count} triple(s) from {extract.charactersAnalyzed} chars
                {extract.committed > 0 && <span className="text-emerald-400"> · {extract.committed} imported to store</span>}
              </p>
              {extract.extracted.map((row, i) => (
                <div key={i} className="rounded-md border border-zinc-800 bg-zinc-950 p-2">
                  <div className="flex items-center gap-2 text-xs">
                    <span className="font-mono text-cyan-300">{row.subject}</span>
                    <span className="rounded-full border border-amber-500/30 bg-amber-500/10 px-1.5 py-0.5 text-[10px] text-amber-200">{row.relationLabel}</span>
                    <span className="font-mono text-violet-300">{row.object}</span>
                    <span className="ml-auto font-mono text-[10px] text-zinc-400">conf {row.confidence.toFixed(2)}</span>
                  </div>
                  <p className="mt-1 text-[10px] italic text-zinc-400">&ldquo;{row.sourceSentence}&rdquo;</p>
                </div>
              ))}
              {extract.count === 0 && (
                <p className="rounded-md border border-zinc-800 bg-zinc-950 p-4 text-center text-xs text-zinc-400">
                  No triples matched. Try simple declarative sentences (X is a Y, X can Z, X causes Y).
                </p>
              )}
            </div>
          )}
        </div>
      )}

      {/* ---------- Provenance ---------- */}
      {tab === 'provenance' && (
        <div className="space-y-3">
          <div className="grid grid-cols-1 gap-3 md:grid-cols-[260px_1fr]">
            <div className="rounded-md border border-zinc-800 bg-zinc-950 p-2">
              <h3 className="mb-1.5 text-[11px] font-semibold uppercase tracking-wide text-zinc-400">Fact Store</h3>
              <div className="max-h-80 space-y-1 overflow-y-auto">
                {facts.length === 0 && <p className="p-2 text-[11px] text-zinc-400">No facts yet — add some above.</p>}
                {facts.map((f) => (
                  <div
                    key={f.id}
                    className={`group flex items-center gap-1.5 rounded px-2 py-1.5 text-[11px] cursor-pointer ${
                      provFactId === f.id ? 'bg-amber-500/10 border border-amber-500/30' : 'hover:bg-zinc-900'
                    }`}
                    onClick={() => runProv(f.id)} role="button" tabIndex={0} onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); (e.currentTarget as HTMLElement).click(); } }}>
                    <span className="flex-1 truncate">
                      <span className="font-mono text-cyan-300">{f.subject}</span>{' '}
                      <span className="text-zinc-400">{f.relation.replace(/_/g, ' ')}</span>{' '}
                      <span className="font-mono text-violet-300">{f.object}</span>
                    </span>
                    <span className="font-mono text-[9px] text-zinc-400">{(f.confidence * 100).toFixed(0)}%</span>
                    <button
                      type="button"
                      onClick={(e) => { e.stopPropagation(); deleteFact(f.id); }}
                      disabled={busy === `del-${f.id}`}
                      className="text-zinc-600 opacity-0 transition-opacity hover:text-rose-400 group-hover:opacity-100"
                      aria-label="Delete fact"
                    >
                      {busy === `del-${f.id}` ? <Loader2 className="h-3 w-3 animate-spin" /> : <Trash2 className="h-3 w-3" />}
                    </button>
                  </div>
                ))}
              </div>
            </div>
            <div className="rounded-md border border-zinc-800 bg-zinc-950 p-3">
              {!prov && <p className="py-8 text-center text-xs text-zinc-400">Select a fact to trace its provenance chain.</p>}
              {prov && (
                <div className="space-y-3">
                  <div className="flex items-center gap-2 text-xs">
                    <ScrollText className="h-4 w-4 text-amber-400" />
                    <span className="font-mono text-cyan-300">{prov.fact.subject}</span>
                    <span className="text-zinc-400">{prov.fact.relation.replace(/_/g, ' ')}</span>
                    <span className="font-mono text-violet-300">{prov.fact.object}</span>
                    {prov.independentlyVerified && (
                      <span className="ml-auto flex items-center gap-1 rounded bg-emerald-500/15 px-1.5 py-0.5 text-[10px] text-emerald-300">
                        <CheckCircle2 className="h-3 w-3" /> independently verified
                      </span>
                    )}
                  </div>
                  <div className="space-y-2">
                    {prov.chain.map((step) => (
                      <div key={step.step} className="rounded-md border border-zinc-800 bg-zinc-900/50 p-2.5">
                        <div className="flex items-center gap-2">
                          <span className="flex h-5 w-5 items-center justify-center rounded-full bg-amber-500/15 font-mono text-[10px] text-amber-300">{step.step}</span>
                          <span className="text-[11px] font-semibold uppercase tracking-wide text-zinc-400">{step.kind.replace(/-/g, ' ')}</span>
                          {step.confidence != null && <span className="ml-auto font-mono text-[10px] text-zinc-400">conf {step.confidence}</span>}
                        </div>
                        {step.detail && <p className="mt-1 text-[11px] text-zinc-400">{step.detail}</p>}
                        {step.facts && step.facts.length > 0 && (
                          <div className="mt-1.5 flex flex-wrap gap-1">
                            {step.facts.map((f) => (
                              <span key={f.id} className="rounded bg-zinc-900 px-1.5 py-0.5 font-mono text-[10px] text-zinc-400">
                                {f.subject} {f.relation} {f.object}
                              </span>
                            ))}
                          </div>
                        )}
                        {step.derivation && step.derivation.length > 0 && (
                          <div className="mt-1.5 flex flex-wrap items-center gap-1">
                            {step.derivation.map((d, j) => (
                              <span key={j} className="flex items-center gap-1">
                                {j > 0 && <ArrowRight className="h-2.5 w-2.5 text-zinc-700" />}
                                <span className="rounded bg-zinc-900 px-1.5 py-0.5 font-mono text-[10px] text-zinc-400">
                                  {d.subject} {d.relation} {d.object}
                                </span>
                              </span>
                            ))}
                            {step.inferredConfidence != null && (
                              <span className="font-mono text-[10px] text-emerald-400">= {step.inferredConfidence}</span>
                            )}
                          </div>
                        )}
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
