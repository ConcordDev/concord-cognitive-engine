'use client';

/**
 * LatticeTopologyGraph — an interactive node-edge graph of the HLM
 * lattice topology. Nodes are DTU clusters (radius scaled by cluster
 * size); edges are the bridge DTUs that link two clusters. Clicking a
 * node surfaces its detail. The whole graph is computed from a real
 * `hlm.topology` result — there is no synthetic layout data.
 */

import { useMemo, useState } from 'react';

export interface TopologyCluster {
  clusterId: string;
  name: string;
  size: number;
  topTags?: string[];
  primaryDomain?: string;
}

export interface TopologyBridge {
  bridgeId: string;
  dtuId: string;
  connectedClusters?: { clusterId: string; clusterName?: string; score: number }[];
  strength?: number;
}

export interface Topology {
  clusters?: TopologyCluster[];
  bridges?: TopologyBridge[];
}

interface Positioned extends TopologyCluster {
  x: number;
  y: number;
  r: number;
}

const W = 640;
const H = 420;

export function LatticeTopologyGraph({
  topology,
  onSelectCluster,
}: {
  topology: Topology | null;
  onSelectCluster?: (c: TopologyCluster) => void;
}) {
  const [selected, setSelected] = useState<string | null>(null);

  const { nodes, edges } = useMemo(() => {
    const clusters = Array.isArray(topology?.clusters) ? topology!.clusters : [];
    if (clusters.length === 0) return { nodes: [] as Positioned[], edges: [] as { a: Positioned; b: Positioned; strength: number }[] };

    const maxSize = Math.max(...clusters.map((c) => c.size || 1), 1);
    const cx = W / 2;
    const cy = H / 2;
    const radius = Math.min(W, H) / 2 - 70;

    const nodes: Positioned[] = clusters.map((c, i) => {
      const angle = (i / clusters.length) * Math.PI * 2 - Math.PI / 2;
      return {
        ...c,
        x: cx + radius * Math.cos(angle),
        y: cy + radius * Math.sin(angle),
        r: 14 + 26 * ((c.size || 1) / maxSize),
      };
    });
    const byId = new Map(nodes.map((n) => [n.clusterId, n]));

    // Each bridge that connects >= 2 clusters becomes an edge between
    // every pair of its connected clusters.
    const edgeMap = new Map<string, { a: Positioned; b: Positioned; strength: number }>();
    for (const bridge of topology?.bridges || []) {
      const cc = (bridge.connectedClusters || []).filter((x) => byId.has(x.clusterId));
      for (let i = 0; i < cc.length; i++) {
        for (let j = i + 1; j < cc.length; j++) {
          const a = byId.get(cc[i].clusterId)!;
          const b = byId.get(cc[j].clusterId)!;
          const key = [a.clusterId, b.clusterId].sort().join('|');
          const strength = bridge.strength ?? (cc[i].score + cc[j].score) / 2;
          const existing = edgeMap.get(key);
          if (!existing || strength > existing.strength) {
            edgeMap.set(key, { a, b, strength });
          }
        }
      }
    }
    return { nodes, edges: Array.from(edgeMap.values()) };
  }, [topology]);

  if (nodes.length === 0) {
    return (
      <p className="text-xs text-violet-700">
        No clusters in the lattice yet. Run an HLM pass once the substrate
        holds enough DTUs to form cohesive groupings.
      </p>
    );
  }

  const selNode = nodes.find((n) => n.clusterId === selected) || null;

  return (
    <div className="space-y-3">
      <div className="overflow-x-auto rounded-lg border border-violet-900/40 bg-violet-950/10 p-2">
        <svg
          viewBox={`0 0 ${W} ${H}`}
          className="mx-auto block h-auto w-full max-w-3xl"
          role="img"
          aria-label="Lattice topology graph"
        >
          {edges.map((e, i) => (
            <line
              key={`edge-${i}`}
              x1={e.a.x}
              y1={e.a.y}
              x2={e.b.x}
              y2={e.b.y}
              stroke="rgb(139 92 246)"
              strokeOpacity={0.18 + 0.5 * Math.min(1, e.strength)}
              strokeWidth={1 + 3 * Math.min(1, e.strength)}
            />
          ))}
          {nodes.map((n) => {
            const isSel = n.clusterId === selected;
            return (
              <g
                key={n.clusterId}
                transform={`translate(${n.x},${n.y})`}
                className="cursor-pointer"
                onClick={() => {
                  setSelected(isSel ? null : n.clusterId);
                  if (!isSel) onSelectCluster?.(n);
                }}
              >
                <circle
                  r={n.r}
                  fill={isSel ? 'rgb(167 139 250)' : 'rgb(76 29 149)'}
                  stroke={isSel ? 'rgb(221 214 254)' : 'rgb(139 92 246)'}
                  strokeWidth={isSel ? 2.5 : 1.5}
                />
                <text
                  textAnchor="middle"
                  dy="0.32em"
                  fontSize="10"
                  fill="rgb(237 233 254)"
                  className="pointer-events-none select-none font-mono"
                >
                  {n.size}
                </text>
                <text
                  textAnchor="middle"
                  y={n.r + 13}
                  fontSize="9"
                  fill="rgb(167 139 250)"
                  className="pointer-events-none select-none"
                >
                  {n.name.length > 22 ? `${n.name.slice(0, 21)}…` : n.name}
                </text>
              </g>
            );
          })}
        </svg>
      </div>
      <div className="flex flex-wrap gap-4 text-[10px] text-violet-700">
        <span>{nodes.length} clusters</span>
        <span>{edges.length} bridge links</span>
        <span>Circle size = cluster DTU count</span>
      </div>
      {selNode && (
        <div className="rounded-lg border border-violet-700/40 bg-violet-900/20 p-3 text-xs">
          <div className="mb-1 font-mono text-violet-200">{selNode.name}</div>
          <div className="text-violet-500">
            {selNode.size} DTUs · domain {selNode.primaryDomain || '—'}
          </div>
          {selNode.topTags && selNode.topTags.length > 0 && (
            <div className="mt-1.5 flex flex-wrap gap-1">
              {selNode.topTags.map((t) => (
                <span
                  key={t}
                  className="rounded bg-violet-800/40 px-1.5 py-0.5 text-[10px] text-violet-300"
                >
                  {t}
                </span>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
