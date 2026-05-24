'use client';

/**
 * LineageTreePanel — drill MEGA → originals and HYPER → MEGAs → originals.
 * Wired to the `dtus.lineageTree` macro. The parent passes a root DTU
 * with nested children[] arrays; the macro returns a recursive
 * TreeDiagram-compatible tree plus aggregate stats.
 */

import { useCallback, useEffect, useState } from 'react';
import { lensRun } from '@/lib/api/client';
import { TreeDiagram } from '@/components/viz';
import type { TreeNode } from '@/components/viz';
import { GitBranch, Loader2 } from 'lucide-react';

interface LineageTreeResult {
  tree: TreeNode | null;
  stats: {
    nodeCount: number;
    maxDepth: number;
    tierCounts: Record<string, number>;
  };
}

export interface LineageRoot extends Record<string, unknown> {
  id: string;
  title?: string;
  tier?: string;
  children?: LineageRoot[];
}

export function LineageTreePanel({
  root,
  onSelectNode,
}: {
  root: LineageRoot | null;
  onSelectNode?: (id: string) => void;
}) {
  const [result, setResult] = useState<LineageTreeResult | null>(null);
  const [loading, setLoading] = useState(false);

  const build = useCallback(async () => {
    if (!root) { setResult(null); return; }
    setLoading(true);
    const res = await lensRun<LineageTreeResult>('dtus', 'lineageTree', { root });
    setLoading(false);
    if (res.data.ok && res.data.result) setResult(res.data.result);
  }, [root]);

  useEffect(() => {
    build();
  }, [build]);

  if (!root) {
    return (
      <div className="flex h-48 flex-col items-center justify-center rounded-xl border border-lattice-border bg-lattice-deep text-gray-400">
        <GitBranch className="mb-2 h-7 w-7" />
        <p className="text-sm">Select a MEGA or HYPER DTU to drill its lineage.</p>
      </div>
    );
  }

  return (
    <div className="space-y-3 rounded-xl border border-lattice-border bg-lattice-deep p-4">
      <div className="flex items-center justify-between">
        <h3 className="flex items-center gap-2 text-sm font-semibold">
          <GitBranch className="h-4 w-4 text-yellow-400" /> Lineage Tree
        </h3>
        {loading && <Loader2 className="h-4 w-4 animate-spin text-neon-cyan" />}
      </div>

      {result?.stats && (
        <div className="grid grid-cols-3 gap-2">
          <Stat label="Nodes" value={result.stats.nodeCount} />
          <Stat label="Max depth" value={result.stats.maxDepth} />
          <Stat
            label="MEGA / HYPER"
            value={`${result.stats.tierCounts.mega || 0} / ${result.stats.tierCounts.hyper || 0}`}
          />
        </div>
      )}

      {result?.tree ? (
        <div className="max-h-[420px] overflow-auto">
          <TreeDiagram
            root={result.tree}
            onSelect={(n) => onSelectNode?.(n.id)}
          />
        </div>
      ) : (
        !loading && <p className="text-xs text-gray-400">This DTU has no recorded lineage.</p>
      )}
    </div>
  );
}

function Stat({ label, value }: { label: string; value: string | number }) {
  return (
    <div className="rounded border border-lattice-border bg-lattice-surface p-2 text-center">
      <p className="text-sm font-bold text-white">{value}</p>
      <p className="text-[10px] text-gray-400">{label}</p>
    </div>
  );
}
