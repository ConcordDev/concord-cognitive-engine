'use client';

/**
 * RootCausePanel — 5-whys / fishbone root-cause analysis for a tracked
 * pain point. Lets the analyst add causes (with parent links, Ishikawa
 * category, and probability), then renders the result tree with the
 * shared TreeDiagram and groups causes into a fishbone view.
 * Wires the root-cause-tree macro.
 */

import { useCallback, useState } from 'react';
import { lensRun } from '@/lib/api/client';
import { TreeDiagram } from '@/components/viz';
import type { TreeNode } from '@/components/viz';
import { GitBranch, Plus, Trash2, Loader2, Fish } from 'lucide-react';
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

const ISHIKAWA = ['people', 'process', 'technology', 'environment', 'materials', 'measurement'];
let causeSeq = 0;

export function RootCausePanel({ pains }: { pains: Pain[] }) {
  const [painId, setPainId] = useState('');
  const [causes, setCauses] = useState<CauseInput[]>([]);
  const [result, setResult] = useState<RootCauseResult | null>(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

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
  }, [painId, causes]);

  return (
    <div className="panel p-4">
      <h3 className="font-semibold flex items-center gap-2 mb-3">
        <GitBranch className="w-4 h-4 text-neon-pink" /> Root-Cause Analysis
        {busy && <Loader2 className="w-4 h-4 animate-spin text-neon-cyan" />}
      </h3>

      {err && <p className="text-xs text-red-400 mb-2">{err}</p>}

      <div className="flex items-center gap-2 mb-3">
        <select
          value={painId}
          onChange={(e) => { setPainId(e.target.value); setResult(null); }}
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
            Build Tree
          </button>
        </div>
      )}

      {result && (
        <div className="space-y-4 mt-3 pt-3 border-t border-white/10">
          <div>
            <p className="text-xs text-gray-500 mb-1.5">
              5-whys tree — {result.causeCount} cause{result.causeCount !== 1 ? 's' : ''} for &ldquo;{result.painTitle}&rdquo;
            </p>
            <TreeDiagram root={result.tree} />
          </div>
          <div>
            <p className="text-xs text-gray-500 mb-1.5 flex items-center gap-1">
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
              <p className="text-xs text-gray-500 mb-1.5">
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
