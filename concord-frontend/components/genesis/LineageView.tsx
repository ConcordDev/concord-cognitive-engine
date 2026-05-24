'use client';

// Lineage view — naming-origin ancestry chain, descendants, and same-origin
// cohort for one emergent. Backed by GET /api/emergents/:id/lineage.

import { useEffect, useState } from 'react';
import { Loader2, GitBranch } from 'lucide-react';
import { TreeDiagram, type TreeNode } from '@/components/viz';

interface LineageNode { id: string; given_name: string | null; naming_origin?: string | null }
interface LineageResponse {
  ok: boolean;
  error?: string;
  root?: { id: string; given_name: string | null; naming_origin: string | null; naming_metadata: Record<string, unknown> };
  ancestry?: LineageNode[];
  descendants?: LineageNode[];
  cohort?: LineageNode[];
  depth?: number;
}

export function LineageView({
  emergentId,
  onSelect,
}: {
  emergentId: string;
  onSelect?: (id: string) => void;
}) {
  const [data, setData] = useState<LineageResponse | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let alive = true;
    setLoading(true);
    fetch(`/api/emergents/${encodeURIComponent(emergentId)}/lineage`)
      .then((r) => r.json())
      .then((d: LineageResponse) => { if (alive) { setData(d); setLoading(false); } })
      .catch(() => { if (alive) { setData({ ok: false, error: 'unreachable' }); setLoading(false); } });
    return () => { alive = false; };
  }, [emergentId]);

  if (loading) {
    return (
      <div className="flex items-center gap-2 text-xs text-zinc-400">
        <Loader2 className="h-4 w-4 animate-spin" /> Tracing lineage…
      </div>
    );
  }
  if (!data?.ok || !data.root) {
    return (
      <div className="rounded border border-red-500/20 bg-red-500/5 px-3 py-2 text-xs text-red-300">
        Could not trace lineage ({data?.error || 'unknown error'}).
      </div>
    );
  }

  const { root, ancestry = [], descendants = [], cohort = [] } = data;

  // Build an ancestry → root → descendants tree. ancestry[0] is the closest
  // parent; the eldest ancestor is the visual root.
  const label = (n: { given_name: string | null; id: string }) => n.given_name || n.id;
  const descNodes: TreeNode[] = descendants.map((d) => ({
    id: d.id,
    label: label(d),
    detail: d.naming_origin ? `via ${d.naming_origin}` : undefined,
    tone: 'info',
  }));
  let tree: TreeNode = {
    id: root.id,
    label: label(root),
    detail: root.naming_origin ? `origin · ${root.naming_origin}` : 'this emergent',
    tone: 'good',
    children: descNodes,
  };
  for (const a of ancestry) {
    tree = {
      id: a.id,
      label: label(a),
      detail: a.naming_origin ? `ancestor · ${a.naming_origin}` : 'ancestor',
      tone: 'default',
      children: [tree],
    };
  }

  return (
    <div className="space-y-3">
      <header className="flex items-center gap-2">
        <GitBranch className="h-4 w-4 text-cyan-400" />
        <h3 className="text-sm font-semibold text-white">Naming lineage</h3>
        <span className="text-[11px] text-zinc-400">
          {ancestry.length} ancestor{ancestry.length === 1 ? '' : 's'} · {descendants.length} descendant
          {descendants.length === 1 ? '' : 's'}
        </span>
      </header>

      <TreeDiagram root={tree} onSelect={(n) => onSelect?.(n.id)} />

      {cohort.length > 0 && (
        <div className="rounded-lg border border-zinc-800 bg-zinc-950/40 p-3">
          <p className="mb-1.5 text-[11px] uppercase tracking-wider text-zinc-400">
            Shares naming origin “{root.naming_origin}”
          </p>
          <div className="flex flex-wrap gap-1.5">
            {cohort.map((c) => (
              <button
                key={c.id}
                type="button"
                onClick={() => onSelect?.(c.id)}
                className="rounded-full border border-zinc-700 bg-zinc-900 px-2 py-0.5 text-[11px] text-zinc-300 hover:border-cyan-500/50 hover:text-cyan-300"
              >
                {c.given_name || c.id}
              </button>
            ))}
          </div>
        </div>
      )}

      {ancestry.length === 0 && descendants.length === 0 && cohort.length === 0 && (
        <p className="text-xs text-zinc-400">
          No recorded lineage — this emergent has no ancestry, descendants, or origin cohort yet.
        </p>
      )}
    </div>
  );
}
