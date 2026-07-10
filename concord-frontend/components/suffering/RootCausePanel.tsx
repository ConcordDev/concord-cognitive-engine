'use client';

/**
 * RootCausePanel — 5-whys / fishbone root-cause analysis for a tracked
 * pain point. Lets the analyst add causes (with parent links, Ishikawa
 * category, and probability), then renders the result tree with the
 * shared TreeDiagram and groups causes into a fishbone view.
 * Wires the root-cause-tree macro (default "Simple tree" mode).
 *
 * "Fault-tree" mode wires the ORIGINAL `suffering` domain macro
 * `rootCause` instead — a more rigorous fault-tree analysis that
 * PROPAGATES probability up the tree (OR-gate: P(parent) = 1 -
 * Π(1 - P(child))) rather than just showing each cause's own stated
 * probability, and adds Ishikawa-category dominance analysis across the
 * whole tree. The rebuild audit found `rootCause` had zero frontend
 * callers; rather than build a disconnected duplicate UI for it, this
 * panel reuses the same causes editor and lets the analyst switch modes —
 * genuinely complementary, not redundant, with the simple per-pain tree.
 */

import { useCallback, useMemo, useState } from 'react';
import { lensRun } from '@/lib/api/client';
import { TreeDiagram } from '@/components/viz';
import type { TreeNode } from '@/components/viz';
import { GitBranch, Plus, Trash2, Loader2, Fish, Sigma } from 'lucide-react';
import type { Pain } from './PainBoard';

interface CauseInput {
  id: string;
  description: string;
  parentId: string;
  category: string;
  probability: number;
}
interface RootCauseResult {
  painId: string;
  painTitle: string;
  tree: TreeNode[];
  fishbone: Record<string, Array<{ id: string; description: string; probability: number }>>;
  rootCauses: Array<{ id: string; description: string; probability: number }>;
  causeCount: number;
}
interface FaultTreeCauseNode { id: string; description: string; category: string; probability: number; children: FaultTreeCauseNode[] }
interface FaultTreeResult {
  problem: string;
  effects: string[];
  totalCauses: number;
  treeDepth: number;
  causeTree: FaultTreeCauseNode[];
  primaryCauses: Array<{ id: string; description: string; category: string; probability: number; evidence: string | null; depth: number }>;
  leafCauses: Array<{ id: string; description: string; category: string; probability: number; evidence: string | null; depth: number }>;
  ishikawaAnalysis: Record<string, { count: number; totalProbability: number; causes: string[] }>;
  dominantCategory: { category: string; probability: number } | null;
  rootCauseCount: number;
  highProbabilityCauses: number;
}

function faultTreeToTreeNode(n: FaultTreeCauseNode): TreeNode {
  return {
    id: n.id,
    label: n.description || n.id,
    detail: `${n.category || 'uncategorized'} · propagated p=${n.probability}`,
    tone: n.probability >= 0.66 ? 'bad' : n.probability >= 0.33 ? 'warn' : 'default',
    children: (n.children || []).map(faultTreeToTreeNode),
  };
}

const ISHIKAWA = ['people', 'process', 'technology', 'environment', 'materials', 'measurement'];
let causeSeq = 0;

export function RootCausePanel({ pains }: { pains: Pain[] }) {
  const [painId, setPainId] = useState('');
  const [causes, setCauses] = useState<CauseInput[]>([]);
  const [mode, setMode] = useState<'tree' | 'faulttree'>('tree');
  const [result, setResult] = useState<RootCauseResult | null>(null);
  const [faultResult, setFaultResult] = useState<FaultTreeResult | null>(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const selectedPain = useMemo(() => pains.find((p) => p.id === painId) || null, [pains, painId]);

  const addCause = useCallback(() => {
    causeSeq += 1;
    setCauses((c) => [...c, {
      id: `cause_${causeSeq}`, description: '', parentId: '',
      category: 'process', probability: 0.5,
    }]);
  }, []);

  const updateCause = useCallback((id: string, patch: Partial<CauseInput>) => {
    setCauses((c) => c.map((x) => (x.id === id ? { ...x, ...patch } : x)));
  }, []);

  const removeCause = useCallback((id: string) => {
    setCauses((c) => c.filter((x) => x.id !== id && x.parentId !== id));
  }, []);

  const analyze = useCallback(async () => {
    if (!painId) { setErr('Select a pain point'); return; }
    const valid = causes.filter((c) => c.description.trim());
    if (valid.length === 0) { setErr('Add at least one cause'); return; }
    setBusy(true);
    setErr(null);
    if (mode === 'tree') {
      setFaultResult(null);
      const res = await lensRun<RootCauseResult>('suffering', 'root-cause-tree', {
        painId,
        causes: valid.map((c) => ({
          id: c.id, description: c.description,
          parentId: c.parentId || undefined,
          category: c.category, probability: c.probability,
        })),
      });
      setBusy(false);
      if (!res.data.ok || !res.data.result) { setErr(res.data.error || 'Analysis failed'); return; }
      setResult(res.data.result);
      return;
    }
    // Fault-tree mode — the original `rootCause` macro. It analyzes a
    // freeform "problem" (here: the selected pain) rather than persisting
    // onto the pain record, and PROPAGATES probability up the tree via an
    // OR-gate instead of only showing each cause's own stated value.
    setResult(null);
    const res = await lensRun<FaultTreeResult>('suffering', 'rootCause', {
      problem: { description: selectedPain?.title || 'Untitled pain point', effects: selectedPain?.description ? [selectedPain.description] : [] },
      causes: valid.map((c) => ({
        id: c.id, description: c.description,
        parentId: c.parentId || undefined,
        category: c.category, probability: c.probability,
      })),
    });
    setBusy(false);
    if (!res.data.ok || !res.data.result) { setErr(res.data.error || 'Analysis failed'); return; }
    setFaultResult(res.data.result);
  }, [painId, causes, mode, selectedPain]);

  return (
    <div className="panel p-4">
      <div className="flex items-center justify-between mb-3">
        <h3 className="font-semibold flex items-center gap-2">
          <GitBranch className="w-4 h-4 text-neon-pink" /> Root-Cause Analysis
          {busy && <Loader2 className="w-4 h-4 animate-spin text-neon-cyan" />}
        </h3>
        <div role="radiogroup" aria-label="Analysis mode" className="inline-flex items-center gap-0.5 rounded-lg border border-white/10 bg-white/[0.03] p-0.5 text-xs">
          <button
            type="button" role="radio" aria-checked={mode === 'tree'}
            onClick={() => { setMode('tree'); setFaultResult(null); }}
            className={`px-2.5 py-1 rounded-md ${mode === 'tree' ? 'bg-neon-pink/20 text-neon-pink' : 'text-gray-400 hover:text-white'}`}
          >
            Simple tree
          </button>
          <button
            type="button" role="radio" aria-checked={mode === 'faulttree'}
            onClick={() => { setMode('faulttree'); setResult(null); }}
            className={`px-2.5 py-1 rounded-md inline-flex items-center gap-1 ${mode === 'faulttree' ? 'bg-neon-pink/20 text-neon-pink' : 'text-gray-400 hover:text-white'}`}
            title="Fault-tree: propagates probability up the tree (OR-gate) and ranks Ishikawa category dominance"
          >
            <Sigma className="w-3 h-3" /> Fault-tree
          </button>
        </div>
      </div>

      {err && <p className="text-xs text-red-400 mb-2" role="alert">{err}</p>}

      <div className="flex items-center gap-2 mb-3">
        <select
          value={painId}
          onChange={(e) => { setPainId(e.target.value); setResult(null); setFaultResult(null); }}
          className="flex-1 bg-white/5 border border-white/10 rounded px-2.5 py-1.5 text-sm text-gray-200"
        >
          <option value="">Select a pain point to analyze…</option>
          {pains.map((p) => <option key={p.id} value={p.id}>{p.title}</option>)}
        </select>
        <button
          onClick={addCause}
          className="flex items-center gap-1 px-3 py-1.5 bg-neon-pink/20 text-neon-pink rounded text-sm hover:bg-neon-pink/30"
        >
          <Plus className="w-4 h-4" /> Cause
        </button>
      </div>

      {causes.length > 0 && (
        <div className="space-y-2 mb-3">
          {causes.map((c) => (
            <div key={c.id} className="flex items-center gap-1.5 text-xs">
              <input
                value={c.description}
                onChange={(e) => updateCause(c.id, { description: e.target.value })}
                placeholder="Cause / why"
                className="flex-1 bg-white/5 border border-white/10 rounded px-2 py-1"
              />
              <select
                value={c.parentId}
                onChange={(e) => updateCause(c.id, { parentId: e.target.value })}
                className="bg-white/5 border border-white/10 rounded px-1.5 py-1 text-gray-300 max-w-[120px]"
              >
                <option value="">(root)</option>
                {causes.filter((x) => x.id !== c.id).map((x) => (
                  <option key={x.id} value={x.id}>↳ {x.description || x.id}</option>
                ))}
              </select>
              <select
                value={c.category}
                onChange={(e) => updateCause(c.id, { category: e.target.value })}
                className="bg-white/5 border border-white/10 rounded px-1.5 py-1 text-gray-300"
              >
                {ISHIKAWA.map((cat) => <option key={cat} value={cat}>{cat}</option>)}
              </select>
              <input
                type="number" min={0} max={1} step={0.1}
                value={c.probability}
                onChange={(e) => updateCause(c.id, { probability: Number(e.target.value) })}
                className="w-14 bg-white/5 border border-white/10 rounded px-1.5 py-1"
                title="Probability 0-1"
              />
              <button onClick={() => removeCause(c.id)} className="text-gray-600 hover:text-red-400" aria-label="Remove cause">
                <Trash2 className="w-3.5 h-3.5" />
              </button>
            </div>
          ))}
          <button
            onClick={analyze}
            disabled={busy}
            className="px-3 py-1.5 bg-neon-pink/20 text-neon-pink rounded text-sm hover:bg-neon-pink/30 disabled:opacity-50"
          >
            {mode === 'tree' ? 'Build Tree' : 'Run Fault-Tree Analysis'}
          </button>
        </div>
      )}

      {faultResult && (
        <div className="space-y-4 mt-3 pt-3 border-t border-white/10">
          <div className="flex flex-wrap items-center gap-2 text-xs">
            <span className="px-2.5 py-1 rounded bg-white/5 border border-white/10">
              {faultResult.totalCauses} causes · depth {faultResult.treeDepth}
            </span>
            {faultResult.dominantCategory && (
              <span className="px-2.5 py-1 rounded bg-neon-pink/15 text-neon-pink border border-neon-pink/30 capitalize">
                Dominant: {faultResult.dominantCategory.category} (p={faultResult.dominantCategory.probability})
              </span>
            )}
            <span className="px-2.5 py-1 rounded bg-white/5 border border-white/10">
              {faultResult.highProbabilityCauses} high-probability cause{faultResult.highProbabilityCauses !== 1 ? 's' : ''} (p≥0.5)
            </span>
          </div>
          <div>
            <p className="text-xs text-gray-400 mb-1.5">
              Fault tree — propagated OR-gate probability for &ldquo;{faultResult.problem}&rdquo;
            </p>
            <TreeDiagram root={faultResult.causeTree.map(faultTreeToTreeNode)} />
          </div>
          <div>
            <p className="text-xs text-gray-400 mb-1.5 flex items-center gap-1">
              <Fish className="w-3.5 h-3.5" /> Ishikawa category dominance
            </p>
            <div className="grid grid-cols-1 md:grid-cols-3 gap-2">
              {Object.entries(faultResult.ishikawaAnalysis).map(([cat, data]) => (
                <div key={cat} className="rounded-lg bg-white/[0.03] border border-white/10 p-2">
                  <div className="flex items-center justify-between mb-1">
                    <p className="text-xs font-medium capitalize text-neon-pink">{cat}</p>
                    <p className="text-[11px] text-gray-400">Σp={data.totalProbability.toFixed(2)}</p>
                  </div>
                  <ul className="space-y-0.5">
                    {data.causes.map((desc, i) => (
                      <li key={i} className="text-[11px] text-gray-400 truncate">{desc}</li>
                    ))}
                  </ul>
                </div>
              ))}
            </div>
          </div>
          {faultResult.primaryCauses.length > 0 && (
            <div>
              <p className="text-xs text-gray-400 mb-1.5">
                Primary causes (leaf causes, own probability ≥ 0.5)
              </p>
              <ul className="space-y-1">
                {faultResult.primaryCauses.slice(0, 5).map((rc) => (
                  <li key={rc.id} className="text-xs flex justify-between bg-rose-500/[0.06] border border-rose-500/20 rounded px-2 py-1">
                    <span>{rc.description}</span>
                    <span className="text-rose-300 font-bold">p={rc.probability}</span>
                  </li>
                ))}
              </ul>
            </div>
          )}
        </div>
      )}

      {result && (
        <div className="space-y-4 mt-3 pt-3 border-t border-white/10">
          <div>
            <p className="text-xs text-gray-400 mb-1.5">
              5-whys tree — {result.causeCount} cause{result.causeCount !== 1 ? 's' : ''} for &ldquo;{result.painTitle}&rdquo;
            </p>
            <TreeDiagram root={result.tree} />
          </div>
          <div>
            <p className="text-xs text-gray-400 mb-1.5 flex items-center gap-1">
              <Fish className="w-3.5 h-3.5" /> Fishbone (Ishikawa categories)
            </p>
            <div className="grid grid-cols-1 md:grid-cols-3 gap-2">
              {Object.entries(result.fishbone).map(([cat, items]) => (
                <div key={cat} className="rounded-lg bg-white/[0.03] border border-white/10 p-2">
                  <p className="text-xs font-medium capitalize text-neon-pink mb-1">{cat}</p>
                  <ul className="space-y-0.5">
                    {items.map((it) => (
                      <li key={it.id} className="text-[11px] text-gray-400 flex justify-between gap-2">
                        <span className="truncate">{it.description}</span>
                        <span className="text-gray-600 shrink-0">p={it.probability}</span>
                      </li>
                    ))}
                  </ul>
                </div>
              ))}
            </div>
          </div>
          {result.rootCauses.length > 0 && (
            <div>
              <p className="text-xs text-gray-400 mb-1.5">
                Likely root causes (highest-probability leaves)
              </p>
              <ul className="space-y-1">
                {result.rootCauses.slice(0, 5).map((rc) => (
                  <li key={rc.id} className="text-xs flex justify-between bg-rose-500/[0.06] border border-rose-500/20 rounded px-2 py-1">
                    <span>{rc.description}</span>
                    <span className="text-rose-300 font-bold">p={rc.probability}</span>
                  </li>
                ))}
              </ul>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
