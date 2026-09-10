'use client';

import { useEffect, useMemo, useState } from 'react';
import { GitBranch } from 'lucide-react';
import { ds } from '@/lib/design-system';
import { RoyaltyFlowCard } from './RoyaltyFlowCard';
import { useCreator } from './CreatorProvider';

const PANEL = ds.panel;

// ── Cascade panel ───────────────────────────────────────────────────

interface CascadeGeneration {
  depth: number;
  count: number;
  rate: number;
  projectedShare: number;
}

interface CascadeNode {
  id: string;
  title: string;
  domain: string | null;
  depth: number;
  parentIds: string[];
}

interface CascadeResponse {
  ok: boolean;
  rootId: string;
  nodes?: CascadeNode[];
  generations: CascadeGeneration[];
  totalDownstream: number;
  maxObservedDepth: number;
}

interface CascadePanelProps {
  topCited: { id: string; title: string; domain: string; citationsReceived: number }[];
}

// Real inline-SVG lineage tree — the actual node-link graph underneath the
// per-generation bar summary. Each node is a real DTU (`computeCascadeTree`'s
// `nodes` field, server/lib/creator-dashboard.js); each edge is a real cited
// parent relationship, not a decorative connector. Positions are computed
// once per render from the node list — root centered at the top, each
// generation laid out as its own row, columns centered under their parent
// row so the tree reads top-down like a real lineage/family tree.
const LINEAGE_ROW_HEIGHT = 64;
const LINEAGE_COL_WIDTH = 92;
const LINEAGE_PAD = 26;
const LINEAGE_DEPTH_COLORS = ['#fbbf24', '#f59e0b', '#fb923c', '#f472b6', '#c084fc', '#818cf8', '#38bdf8'];

function lineageColorFor(depth: number): string {
  return LINEAGE_DEPTH_COLORS[Math.min(depth, LINEAGE_DEPTH_COLORS.length - 1)];
}

function LineageTree({ nodes }: { nodes: CascadeNode[] }) {
  const byDepth = useMemo(() => {
    const m = new Map<number, CascadeNode[]>();
    for (const n of nodes) {
      const arr = m.get(n.depth) ?? [];
      arr.push(n);
      m.set(n.depth, arr);
    }
    return m;
  }, [nodes]);

  const depths = useMemo(() => Array.from(byDepth.keys()).sort((a, b) => a - b), [byDepth]);
  const maxCols = useMemo(
    () => Math.max(1, ...depths.map((d) => byDepth.get(d)?.length ?? 0)),
    [byDepth, depths],
  );

  const pos = useMemo(() => {
    const m = new Map<string, { x: number; y: number }>();
    for (const d of depths) {
      const row = byDepth.get(d) ?? [];
      const rowWidth = row.length * LINEAGE_COL_WIDTH;
      const offsetX = Math.max(0, (maxCols * LINEAGE_COL_WIDTH - rowWidth) / 2);
      row.forEach((n, i) => {
        m.set(n.id, {
          x: LINEAGE_PAD + offsetX + i * LINEAGE_COL_WIDTH + LINEAGE_COL_WIDTH / 2,
          y: LINEAGE_PAD + d * LINEAGE_ROW_HEIGHT,
        });
      });
    }
    return m;
  }, [byDepth, depths, maxCols]);

  const width = LINEAGE_PAD * 2 + maxCols * LINEAGE_COL_WIDTH;
  const height = LINEAGE_PAD * 2 + Math.max(0, depths.length - 1) * LINEAGE_ROW_HEIGHT + 36;

  return (
    <div className="mt-3 overflow-x-auto rounded-lg border border-white/5 bg-black/20 py-3">
      <svg
        width={width}
        height={height}
        viewBox={`0 0 ${width} ${height}`}
        className="block mx-auto"
        role="img"
        aria-label="Royalty cascade lineage tree"
      >
        {/* Edges first, so node circles draw on top of the lines. */}
        {nodes.flatMap((n) =>
          n.parentIds.map((pid) => {
            const a = pos.get(pid);
            const b = pos.get(n.id);
            if (!a || !b) return null;
            const midY = (a.y + b.y) / 2;
            return (
              <path
                key={`${pid}->${n.id}`}
                d={`M ${a.x} ${a.y + 10} C ${a.x} ${midY}, ${b.x} ${midY}, ${b.x} ${b.y - 10}`}
                fill="none"
                stroke={lineageColorFor(n.depth)}
                strokeOpacity={0.35}
                strokeWidth={1.5}
              />
            );
          }),
        )}
        {nodes.map((n) => {
          const p = pos.get(n.id);
          if (!p) return null;
          const isRoot = n.depth === 0;
          const r = isRoot ? 9 : 6;
          const label = n.title || n.id;
          return (
            <g key={n.id} transform={`translate(${p.x}, ${p.y})`}>
              <title>{`${label}${n.domain ? ` · ${n.domain}` : ''} (gen ${n.depth})`}</title>
              <circle
                r={r}
                fill={lineageColorFor(n.depth)}
                fillOpacity={isRoot ? 0.9 : 0.6}
                stroke={isRoot ? '#fef3c7' : 'transparent'}
                strokeWidth={isRoot ? 2 : 0}
              />
              <text
                y={r + 12}
                textAnchor="middle"
                className="fill-gray-300"
                style={{ fontSize: 9, fontFamily: 'monospace' }}
              >
                {label.length > 12 ? `${label.slice(0, 12)}…` : label}
              </text>
            </g>
          );
        })}
      </svg>
    </div>
  );
}

function CascadePanel({ topCited }: CascadePanelProps) {
  const [selected, setSelected] = useState<string>(topCited[0]?.id ?? '');
  const [tree, setTree] = useState<CascadeResponse | null>(null);
  const [loading, setLoading] = useState(false);

  // Pick first item once topCited materializes.
  useEffect(() => {
    if (!selected && topCited.length > 0) setSelected(topCited[0].id);
  }, [topCited, selected]);

  useEffect(() => {
    if (!selected) {
      setTree(null);
      return;
    }
    setLoading(true);
    fetch(`/api/creator/cascade/${encodeURIComponent(selected)}?maxDepth=6`, {
      credentials: 'include',
    })
      .then((r) => r.json())
      .then((d) => setTree(d as CascadeResponse))
      .catch(() => setTree(null))
      .finally(() => setLoading(false));
  }, [selected]);

  const maxCount = tree
    ? Math.max(1, ...tree.generations.map((g) => g.count))
    : 1;

  if (topCited.length === 0) {
    return (
      <section className={`${PANEL} text-gray-400 italic`}>
        No top-cited DTUs yet. As your work earns citations, they appear here with the per-generation cascade.
      </section>
    );
  }

  return (
    <section className={PANEL}>
      <div className="flex flex-wrap items-baseline justify-between gap-2 mb-3">
        <h2 className="text-amber-200 font-semibold inline-flex items-center gap-1.5">
          <GitBranch className="w-4 h-4" /> Royalty cascade
        </h2>
        <span className="text-[11px] text-gray-400">
          downstream lineage · projected per-generation share
        </span>
      </div>
      <div className="mb-3">
        <label className="block text-[11px] text-gray-400 mb-1">Top-cited DTU</label>
        <select
          value={selected}
          onChange={(e) => setSelected(e.target.value)}
          className="w-full max-w-md bg-black/60 border border-white/10 rounded px-3 py-2 text-sm text-gray-200"
        >
          {topCited.map((d) => (
            <option key={d.id} value={d.id}>
              {d.title || d.id.slice(0, 16)} · {d.citationsReceived} citations
            </option>
          ))}
        </select>
      </div>
      {loading ? (
        <div className="text-xs text-gray-400 italic">Walking lineage…</div>
      ) : !tree?.ok || tree.generations.length === 0 ? (
        <div className="text-xs text-gray-400 italic">
          No downstream citations yet for this DTU. As other creators cite or remix
          your work, generations appear here — each one paying you a halving share
          forever (floor 0.05%).
        </div>
      ) : (
        <div className="space-y-2">
          <div className="flex items-baseline gap-4 text-xs text-gray-400">
            <span><span className="text-gray-200 font-mono">{tree.totalDownstream}</span> downstream DTUs</span>
            <span><span className="text-gray-200 font-mono">{tree.maxObservedDepth}</span> generations deep</span>
            <span className="text-amber-300/80">
              projected share total:{' '}
              <span className="font-mono">
                {tree.generations.reduce((s, g) => s + g.projectedShare, 0).toFixed(2)}
              </span>
              {' '}× sale
            </span>
          </div>
          {tree.nodes && tree.nodes.length > 0 ? (
            <LineageTree nodes={tree.nodes} />
          ) : (
            // Fallback for a server that hasn't shipped `nodes` yet — the
            // original per-generation bar view, unchanged.
            <ol className="space-y-1.5 mt-3">
              {tree.generations.map((g) => {
                const widthPct = Math.round((g.count / maxCount) * 100);
                return (
                  <li key={g.depth} className="flex items-center gap-3 text-xs">
                    <span className="w-12 shrink-0 text-amber-400 font-mono">gen {g.depth}</span>
                    <div className="flex-1 h-5 bg-black/40 rounded overflow-hidden">
                      <div
                        className="h-full bg-gradient-to-r from-amber-500/60 to-amber-300/40 flex items-center px-2"
                        style={{ width: `${widthPct}%` }}
                      >
                        <span className="text-[10px] font-mono text-black/70">{g.count}</span>
                      </div>
                    </div>
                    <span className="w-20 shrink-0 text-right text-amber-300 font-mono">
                      {(g.rate * 100).toFixed(2)}%
                    </span>
                    <span className="w-24 shrink-0 text-right text-emerald-300 font-mono">
                      +{g.projectedShare.toFixed(2)}× sale
                    </span>
                  </li>
                );
              })}
            </ol>
          )}
          {/* Rate/share legend — real per-generation math, kept as a compact
              reference strip beneath the tree so nothing the bar view used
              to show is lost. */}
          <div className="mt-3 flex flex-wrap gap-x-4 gap-y-1 text-[10px] text-gray-400 border-t border-white/5 pt-2">
            {tree.generations.map((g) => (
              <span key={g.depth}>
                <span className="text-amber-400/80 font-mono">gen {g.depth}</span>{' '}
                <span className="text-gray-300 font-mono">{g.count}</span> ×{' '}
                <span className="text-amber-300 font-mono">{(g.rate * 100).toFixed(2)}%</span> ={' '}
                <span className="text-emerald-300 font-mono">+{g.projectedShare.toFixed(2)}×</span>
              </span>
            ))}
          </div>
          <p className="text-[10px] text-gray-400 mt-2">
            Projected share = count × generational-rate. Royalties halve per generation
            (initial 21%) with a 0.05% floor — so a 4-deep cascade with 10 / 25 / 60 / 140
            downstream DTUs still pays the original creator on every transaction.
          </p>
        </div>
      )}
    </section>
  );
}


export function CascadeTreePanel() {
  const { me } = useCreator();
  const topCited = me?.topCitedDTUs ?? [];
  return (
    <div className="space-y-4">
      <RoyaltyFlowCard topCited={topCited} />
      <CascadePanel topCited={topCited} />
    </div>
  );
}
