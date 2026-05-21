'use client';

/**
 * MeshTopology — force-free radial graph of the mesh: the self node at
 * the centre, peers arranged in a ring, edges drawn for each active
 * link. Every node + edge comes from the `mesh.meshMap` macro. Doubles
 * as the node-management surface (add / remove / ping).
 */

import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { apiHelpers } from '@/lib/api/client';
import { Loader2, Plus, Trash2, Activity, RefreshCw } from 'lucide-react';

interface GraphNode {
  id: string;
  name: string;
  kind: 'self' | 'peer';
  online: boolean;
  transports: string[];
  hops?: number;
  lastSeen?: string;
}
interface GraphEdge { source: string; target: string; transport: string; quality: number; }
interface MeshMap {
  nodes: GraphNode[];
  edges: GraphEdge[];
  nodeCount: number;
  edgeCount: number;
  onlineCount: number;
}

const TRANSPORT_OPTS = ['internet', 'wifi_direct', 'bluetooth', 'lora', 'rf_packet', 'telephone', 'nfc'];

export function MeshTopology() {
  const qc = useQueryClient();
  const [newName, setNewName] = useState('');
  const [newTransport, setNewTransport] = useState('lora');
  const [pingResult, setPingResult] = useState<Record<string, string>>({});

  const map = useQuery({
    queryKey: ['mesh-map'],
    queryFn: async () => {
      const r = await apiHelpers.lens.runDomain('mesh', 'meshMap', {});
      return (r.data?.result ?? r.data) as MeshMap;
    },
    refetchInterval: 30_000,
  });

  const addNode = useMutation({
    mutationFn: async () =>
      (await apiHelpers.lens.runDomain('mesh', 'addNode', { name: newName.trim(), transports: [newTransport] })).data?.result,
    onSuccess: () => {
      setNewName('');
      qc.invalidateQueries({ queryKey: ['mesh-map'] });
      qc.invalidateQueries({ queryKey: ['mesh-nodes'] });
      qc.invalidateQueries({ queryKey: ['mesh-overview'] });
    },
  });

  const removeNode = useMutation({
    mutationFn: async (nodeId: string) =>
      (await apiHelpers.lens.runDomain('mesh', 'removeNode', { nodeId })).data?.result,
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['mesh-map'] });
      qc.invalidateQueries({ queryKey: ['mesh-nodes'] });
      qc.invalidateQueries({ queryKey: ['mesh-overview'] });
    },
  });

  const ping = useMutation({
    mutationFn: async (nodeId: string) =>
      (await apiHelpers.lens.runDomain('mesh', 'pingNode', { nodeId })).data?.result as { rttMs: number; transport: string } | undefined,
    onSuccess: (res, nodeId) => {
      if (res) setPingResult((p) => ({ ...p, [nodeId]: `${res.rttMs}ms · ${res.transport}` }));
      qc.invalidateQueries({ queryKey: ['mesh-map'] });
    },
  });

  const nodes = map.data?.nodes ?? [];
  const edges = map.data?.edges ?? [];
  const peers = nodes.filter((n) => n.kind === 'peer');

  // Radial layout — self at centre, peers on a ring.
  const W = 520, H = 380, cx = W / 2, cy = H / 2, ringR = 140;
  const pos: Record<string, { x: number; y: number }> = { self: { x: cx, y: cy } };
  peers.forEach((p, i) => {
    const a = (i / Math.max(1, peers.length)) * Math.PI * 2 - Math.PI / 2;
    pos[p.id] = { x: cx + Math.cos(a) * ringR, y: cy + Math.sin(a) * ringR };
  });

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-end gap-2 rounded-lg border border-teal-900/40 bg-teal-950/10 p-3">
        <label className="flex flex-col gap-1 text-[11px] text-teal-600">
          Node name
          <input
            value={newName}
            onChange={(e) => setNewName(e.target.value)}
            placeholder="e.g. Repeater-Hill"
            className="rounded border border-teal-900/50 bg-black px-2 py-1.5 text-xs text-teal-100 focus:outline-none focus:ring-2 focus:ring-teal-400"
          />
        </label>
        <label className="flex flex-col gap-1 text-[11px] text-teal-600">
          Transport
          <select
            value={newTransport}
            onChange={(e) => setNewTransport(e.target.value)}
            className="rounded border border-teal-900/50 bg-black px-2 py-1.5 text-xs text-teal-100 focus:outline-none focus:ring-2 focus:ring-teal-400"
          >
            {TRANSPORT_OPTS.map((t) => <option key={t} value={t}>{t}</option>)}
          </select>
        </label>
        <button
          onClick={() => newName.trim() && addNode.mutate()}
          disabled={!newName.trim() || addNode.isPending}
          className="inline-flex items-center gap-1.5 rounded bg-teal-700/60 px-3 py-1.5 text-xs font-medium text-teal-100 hover:bg-teal-600/70 disabled:opacity-40 focus:outline-none focus:ring-2 focus:ring-teal-400"
        >
          {addNode.isPending ? <Loader2 className="h-3 w-3 animate-spin" /> : <Plus className="h-3 w-3" />} Add node
        </button>
        <button
          onClick={() => map.refetch()}
          className="ml-auto inline-flex items-center gap-1.5 rounded border border-teal-900/50 px-3 py-1.5 text-xs text-teal-300 hover:bg-teal-900/30 focus:outline-none focus:ring-2 focus:ring-teal-400"
        >
          <RefreshCw className="h-3 w-3" /> Refresh
        </button>
      </div>

      {map.isLoading ? (
        <Loader2 className="h-4 w-4 animate-spin text-teal-500" />
      ) : (
        <div className="grid gap-4 lg:grid-cols-[auto_1fr]">
          <div className="rounded-lg border border-teal-900/40 bg-black p-2">
            <svg width={W} height={H} role="img" aria-label="Mesh topology graph" className="max-w-full">
              {edges.map((e, i) => {
                const a = pos[e.source], b = pos[e.target];
                if (!a || !b) return null;
                return (
                  <line
                    key={i}
                    x1={a.x} y1={a.y} x2={b.x} y2={b.y}
                    stroke={`rgba(45,212,191,${0.2 + e.quality * 0.6})`}
                    strokeWidth={1 + e.quality * 2.5}
                  />
                );
              })}
              {nodes.map((n) => {
                const p = pos[n.id];
                if (!p) return null;
                const r = n.kind === 'self' ? 18 : 12;
                return (
                  <g key={n.id}>
                    <circle
                      cx={p.x} cy={p.y} r={r}
                      fill={n.kind === 'self' ? '#0f766e' : n.online ? '#059669' : '#3f3f46'}
                      stroke={n.online ? '#5eead4' : '#52525b'}
                      strokeWidth={2}
                    />
                    <text x={p.x} y={p.y + r + 12} textAnchor="middle" fontSize={10} fill="#5eead4">
                      {n.name}
                    </text>
                  </g>
                );
              })}
            </svg>
            <p className="px-2 pb-1 text-[10px] text-teal-700">
              {map.data?.nodeCount ?? 0} nodes · {map.data?.edgeCount ?? 0} links · {map.data?.onlineCount ?? 0} online
            </p>
          </div>

          <div className="space-y-1.5">
            <h3 className="text-xs font-semibold uppercase tracking-wider text-teal-600">Nodes</h3>
            {peers.length === 0 ? (
              <p className="rounded border border-teal-900/30 bg-teal-950/10 px-3 py-4 text-center text-xs text-teal-600">
                No peer nodes yet. Add one above to build the mesh.
              </p>
            ) : (
              peers.map((n) => (
                <div key={n.id} className="flex flex-wrap items-center gap-2 rounded border border-teal-900/30 bg-teal-950/10 px-3 py-2 text-xs">
                  <span className={`h-2 w-2 rounded-full ${n.online ? 'bg-emerald-400' : 'bg-zinc-600'}`} aria-hidden />
                  <span className="font-mono text-teal-200">{n.name}</span>
                  <span className="rounded bg-teal-900/40 px-1.5 py-0.5 text-[10px] text-teal-400">{n.transports.join(', ')}</span>
                  <span className="text-[10px] text-teal-700">{n.hops ?? 1} hop{(n.hops ?? 1) > 1 ? 's' : ''}</span>
                  {pingResult[n.id] && <span className="text-[10px] text-emerald-400">{pingResult[n.id]}</span>}
                  <span className="ml-auto flex gap-1">
                    <button
                      onClick={() => ping.mutate(n.id)}
                      disabled={ping.isPending}
                      className="rounded p-1 text-teal-400 hover:bg-teal-900/40 disabled:opacity-40"
                      aria-label={`Ping ${n.name}`}
                    >
                      <Activity className="h-3.5 w-3.5" />
                    </button>
                    <button
                      onClick={() => removeNode.mutate(n.id)}
                      disabled={removeNode.isPending}
                      className="rounded p-1 text-rose-400 hover:bg-rose-950/40 disabled:opacity-40"
                      aria-label={`Remove ${n.name}`}
                    >
                      <Trash2 className="h-3.5 w-3.5" />
                    </button>
                  </span>
                </div>
              ))
            )}
          </div>
        </div>
      )}
    </div>
  );
}
