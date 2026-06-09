'use client';

/**
 * FederationConsole — the ops-grade cross-world federation surface for the
 * bridge lens. Six features, every value sourced from a real bridge macro:
 *   1. Visual sync topology graph (peers + hub as nodes, flows as edges)
 *   2. Per-flow retry / replay of a failed bridge action
 *   3. Field-mapping editor with live transform preview
 *   4. Per-peer sync schedule configuration
 *   5. Alerting on sync failure / lag thresholds
 *   6. Throughput history charts over time
 *
 * Every macro called here is wired to a real control; no placeholder panels.
 */

import { useCallback, useEffect, useMemo, useState } from 'react';
import { lensRun } from '@/lib/api/client';
import { ChartKit } from '@/components/viz';
import {
  Plus, Trash2, RefreshCw, Play, AlertTriangle, Activity,
  GitMerge, Calendar, BarChart3, Network, Loader2, CheckCircle2,
  XCircle, Bell,
} from 'lucide-react';

/* ------------------------------------------------------------------ */
/*  Types — mirror server/domains/bridge.js result shapes              */
/* ------------------------------------------------------------------ */

interface Peer {
  id: string; name: string; kind: string; endpoint: string;
  region: string; createdAt: string; enabled: boolean;
}
interface TopoNode {
  id: string; label: string; kind: string; health: string;
  peerId?: string; region?: string; flowCount?: number;
  failed?: number; succeeded?: number;
}
interface TopoEdge {
  id: string; source: string; target: string; flows: number;
  failed: number; succeeded: number; status: string; errorRate: number;
}
interface Flow {
  id: string; peerId: string; peerName: string; action: string;
  status: string; records: number; durationMs: number; rps: number;
  error: string | null; attempts: number; at: string; replayedAt?: string;
}
interface FieldMapping {
  id: string; source: string; target: string; transform: string;
  dataType: string; required: boolean; peerId: string | null;
  createdAt: string; updatedAt: string;
}
interface PreviewRow {
  mappingId: string; source: string; target: string; transform: string;
  inputValue?: unknown; outputValue: unknown; ok: boolean; error: string | null;
}
interface Schedule {
  peerId: string; peerName: string; mode: string; intervalMinutes: number;
  enabled: boolean; nextRunAt: string | null; updatedAt: string | null;
}
interface AlertRule {
  id: string; metric: string; threshold: number; peerId: string | null;
  enabled: boolean; createdAt: string; updatedAt: string;
}
interface FiredAlert {
  ruleId: string; metric: string; threshold: number; value: number;
  detail: string; peerId: string | null; peerName: string;
  severity: string; at: string;
}
interface ThroughputBucket {
  ts: string; avgRPS: number; peakRPS: number; succeeded: number; failed: number;
}

type ConsoleTab = 'topology' | 'flows' | 'mappings' | 'schedules' | 'alerts' | 'throughput';

const CONSOLE_TABS: { id: ConsoleTab; label: string; icon: React.ReactNode }[] = [
  { id: 'topology', label: 'Topology', icon: <Network className="w-4 h-4" /> },
  { id: 'flows', label: 'Flows', icon: <Activity className="w-4 h-4" /> },
  { id: 'mappings', label: 'Mappings', icon: <GitMerge className="w-4 h-4" /> },
  { id: 'schedules', label: 'Schedules', icon: <Calendar className="w-4 h-4" /> },
  { id: 'alerts', label: 'Alerts', icon: <Bell className="w-4 h-4" /> },
  { id: 'throughput', label: 'Throughput', icon: <BarChart3 className="w-4 h-4" /> },
];

/* ------------------------------------------------------------------ */
/*  Component                                                          */
/* ------------------------------------------------------------------ */

export function FederationConsole() {
  const [tab, setTab] = useState<ConsoleTab>('topology');
  const [peers, setPeers] = useState<Peer[]>([]);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const loadPeers = useCallback(async () => {
    const r = await lensRun<{ peers: Peer[] }>('bridge', 'peerList', {});
    if (r.data.ok && r.data.result) setPeers(r.data.result.peers || []);
    else if (!r.data.ok) setErr(r.data.error);
  }, []);

  useEffect(() => { loadPeers(); }, [loadPeers]);

  return (
    <div className="rounded-xl border border-zinc-800 bg-zinc-900/50 p-4">
      <div className="flex items-center gap-2 mb-3">
        <div className="w-8 h-8 rounded-lg bg-cyan-500/20 flex items-center justify-center">
          <Network className="w-4 h-4 text-cyan-400" />
        </div>
        <div>
          <h2 className="text-sm font-bold text-zinc-100">Federation Console</h2>
          <p className="text-[11px] text-zinc-400">Cross-world sync ops — peers, flows, mappings, schedules, alerts</p>
        </div>
      </div>

      {err && (
        <div className="mb-3 px-3 py-2 rounded-lg bg-red-500/10 border border-red-500/30 text-xs text-red-300 flex items-center gap-2">
          <XCircle className="w-3.5 h-3.5" /> {err}
          <button onClick={() => setErr(null)} className="ml-auto text-red-400/70 hover:text-red-300">dismiss</button>
        </div>
      )}

      <PeerBar peers={peers} busy={busy} setBusy={setBusy} setErr={setErr} reload={loadPeers} />

      <div className="flex gap-1 mb-4 mt-4 bg-zinc-950 rounded-lg p-1 overflow-x-auto">
        {CONSOLE_TABS.map(t => (
          <button key={t.id} onClick={() => setTab(t.id)}
            className={`flex-1 min-w-[96px] flex items-center justify-center gap-1.5 py-2 px-2 rounded-md text-xs font-medium transition-colors ${
              tab === t.id ? 'bg-zinc-800 text-white' : 'text-zinc-400 hover:text-zinc-300'}`}>
            {t.icon}<span>{t.label}</span>
          </button>
        ))}
      </div>

      {tab === 'topology' && <TopologyTab peers={peers} />}
      {tab === 'flows' && <FlowsTab peers={peers} setErr={setErr} />}
      {tab === 'mappings' && <MappingsTab peers={peers} setErr={setErr} />}
      {tab === 'schedules' && <SchedulesTab peers={peers} setErr={setErr} />}
      {tab === 'alerts' && <AlertsTab peers={peers} setErr={setErr} />}
      {tab === 'throughput' && <ThroughputTab peers={peers} />}
    </div>
  );
}

/* ------------------------------------------------------------------ */
/*  Peer bar — register / remove federation peers                      */
/* ------------------------------------------------------------------ */

function PeerBar({ peers, busy, setBusy, setErr, reload }: {
  peers: Peer[]; busy: boolean; setBusy: (b: boolean) => void;
  setErr: (e: string | null) => void; reload: () => Promise<void>;
}) {
  const [name, setName] = useState('');
  const [kind, setKind] = useState('world');
  const [region, setRegion] = useState('concordia-hub');
  const [endpoint, setEndpoint] = useState('');

  const addPeer = async () => {
    if (!name.trim()) return;
    setBusy(true);
    const r = await lensRun('bridge', 'peerRegister', { name, kind, region, endpoint });
    if (!r.data.ok) setErr(r.data.error);
    else { setName(''); setEndpoint(''); await reload(); }
    setBusy(false);
  };

  const removePeer = async (peerId: string) => {
    setBusy(true);
    const r = await lensRun('bridge', 'peerRemove', { peerId });
    if (!r.data.ok) setErr(r.data.error);
    await reload();
    setBusy(false);
  };

  return (
    <div className="rounded-lg border border-zinc-800 bg-zinc-950/60 p-3">
      <p className="text-[11px] font-semibold text-zinc-400 mb-2 uppercase tracking-wide">Federation Peers</p>
      <div className="flex flex-wrap gap-2 mb-3">
        <input value={name} onChange={e => setName(e.target.value)} placeholder="Peer name"
          className="flex-1 min-w-[140px] bg-zinc-900 border border-zinc-800 rounded px-2 py-1.5 text-xs text-zinc-200 placeholder-zinc-600" />
        <select value={kind} onChange={e => setKind(e.target.value)}
          className="bg-zinc-900 border border-zinc-800 rounded px-2 py-1.5 text-xs text-zinc-200">
          <option value="world">world</option>
          <option value="federation-peer">federation-peer</option>
          <option value="external-api">external-api</option>
          <option value="dtu-organism">dtu-organism</option>
        </select>
        <input value={region} onChange={e => setRegion(e.target.value)} placeholder="Region"
          className="w-32 bg-zinc-900 border border-zinc-800 rounded px-2 py-1.5 text-xs text-zinc-200 placeholder-zinc-600" />
        <input value={endpoint} onChange={e => setEndpoint(e.target.value)} placeholder="Endpoint (optional)"
          className="flex-1 min-w-[140px] bg-zinc-900 border border-zinc-800 rounded px-2 py-1.5 text-xs text-zinc-200 placeholder-zinc-600" />
        <button onClick={addPeer} disabled={busy || !name.trim()}
          className="flex items-center gap-1 px-3 py-1.5 rounded bg-cyan-500/20 text-cyan-300 hover:bg-cyan-500/30 text-xs disabled:opacity-40">
          {busy ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Plus className="w-3.5 h-3.5" />} Add Peer
        </button>
      </div>
      {peers.length === 0 ? (
        <p className="text-[11px] text-zinc-400">No peers registered yet. Add a world or federation peer to bridge to.</p>
      ) : (
        <div className="flex flex-wrap gap-2">
          {peers.map(p => (
            <div key={p.id} className="flex items-center gap-2 px-2 py-1 rounded bg-zinc-900 border border-zinc-800 text-xs">
              <span className="w-1.5 h-1.5 rounded-full bg-cyan-400" />
              <span className="text-zinc-200">{p.name}</span>
              <span className="text-zinc-600">{p.kind}</span>
              <button aria-label="Delete" onClick={() => removePeer(p.id)} className="text-zinc-600 hover:text-red-400">
                <Trash2 className="w-3 h-3" />
              </button>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

/* ------------------------------------------------------------------ */
/*  1. Topology tab — visual sync graph                                */
/* ------------------------------------------------------------------ */

function TopologyTab({ peers }: { peers: Peer[] }) {
  const [nodes, setNodes] = useState<TopoNode[]>([]);
  const [edges, setEdges] = useState<TopoEdge[]>([]);
  const [stats, setStats] = useState<{ peerCount: number; edgeCount: number; unhealthy: number } | null>(null);
  const [loading, setLoading] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    const r = await lensRun<{ nodes: TopoNode[]; edges: TopoEdge[]; peerCount: number; edgeCount: number; unhealthy: number }>(
      'bridge', 'syncTopology', {});
    if (r.data.ok && r.data.result) {
      setNodes(r.data.result.nodes || []);
      setEdges(r.data.result.edges || []);
      setStats({ peerCount: r.data.result.peerCount, edgeCount: r.data.result.edgeCount, unhealthy: r.data.result.unhealthy });
    }
    setLoading(false);
  }, []);

  useEffect(() => { load(); }, [load, peers.length]);

  const hub = nodes.find(n => n.kind === 'hub');
  const spokes = nodes.filter(n => n.kind !== 'hub');

  // Lay spokes on a circle around the central hub.
  const layout = useMemo(() => {
    const W = 520, H = 320, cx = W / 2, cy = H / 2, R = 120;
    const pos = new Map<string, { x: number; y: number }>();
    if (hub) pos.set(hub.id, { x: cx, y: cy });
    spokes.forEach((n, i) => {
      const a = (i / Math.max(1, spokes.length)) * Math.PI * 2 - Math.PI / 2;
      pos.set(n.id, { x: cx + Math.cos(a) * R, y: cy + Math.sin(a) * R });
    });
    return { W, H, pos };
  }, [hub, spokes]);

  const edgeStroke = (s: string) =>
    s === 'critical' ? '#ef4444' : s === 'degraded' ? '#f59e0b' : s === 'healthy' ? '#22c55e' : '#52525b';

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <div className="flex gap-3 text-xs">
          <span className="text-zinc-400">Peers <b className="text-cyan-400">{stats?.peerCount ?? 0}</b></span>
          <span className="text-zinc-400">Edges <b className="text-zinc-200">{stats?.edgeCount ?? 0}</b></span>
          <span className="text-zinc-400">Unhealthy <b className="text-amber-400">{stats?.unhealthy ?? 0}</b></span>
        </div>
        <button onClick={load} className="flex items-center gap-1 text-xs text-zinc-400 hover:text-zinc-200">
          <RefreshCw className={`w-3.5 h-3.5 ${loading ? 'animate-spin' : ''}`} /> Recompute
        </button>
      </div>

      {nodes.length <= 1 ? (
        <div className="h-48 flex items-center justify-center text-xs text-zinc-400 border border-zinc-800 rounded-lg">
          Register peers and record sync flows to build the topology graph.
        </div>
      ) : (
        <div className="rounded-lg border border-zinc-800 bg-zinc-950/60 p-2 overflow-x-auto">
          <svg width={layout.W} height={layout.H} className="mx-auto">
            {edges.map(e => {
              const a = layout.pos.get(e.source);
              const b = layout.pos.get(e.target);
              if (!a || !b) return null;
              const mx = (a.x + b.x) / 2, my = (a.y + b.y) / 2;
              return (
                <g key={e.id}>
                  <line x1={a.x} y1={a.y} x2={b.x} y2={b.y}
                    stroke={edgeStroke(e.status)} strokeWidth={1 + Math.min(5, e.flows / 3)} opacity={0.7} />
                  <text x={mx} y={my - 4} fill="#a1a1aa" fontSize={9} textAnchor="middle">
                    {e.flows} flow{e.flows !== 1 ? 's' : ''} · {e.errorRate}% err
                  </text>
                </g>
              );
            })}
            {nodes.map(n => {
              const p = layout.pos.get(n.id);
              if (!p) return null;
              const isHub = n.kind === 'hub';
              const fill = n.health === 'critical' ? '#7f1d1d' : n.health === 'degraded' ? '#78350f'
                : n.health === 'healthy' ? '#14532d' : isHub ? '#164e63' : '#27272a';
              const ring = n.health === 'critical' ? '#ef4444' : n.health === 'degraded' ? '#f59e0b'
                : n.health === 'healthy' ? '#22c55e' : isHub ? '#06b6d4' : '#52525b';
              return (
                <g key={n.id}>
                  <circle cx={p.x} cy={p.y} r={isHub ? 26 : 20} fill={fill} stroke={ring} strokeWidth={2} />
                  <text x={p.x} y={p.y + 1} fill="#fafafa" fontSize={10} fontWeight={600} textAnchor="middle">
                    {n.label.length > 10 ? n.label.slice(0, 9) + '…' : n.label}
                  </text>
                  {!isHub && (
                    <text x={p.x} y={p.y + 34} fill="#71717a" fontSize={8} textAnchor="middle">
                      {n.kind} · {n.flowCount ?? 0}f
                    </text>
                  )}
                </g>
              );
            })}
          </svg>
        </div>
      )}
    </div>
  );
}

/* ------------------------------------------------------------------ */
/*  2. Flows tab — record + retry/replay failed flows                  */
/* ------------------------------------------------------------------ */

function FlowsTab({ peers, setErr }: { peers: Peer[]; setErr: (e: string | null) => void }) {
  const [flows, setFlows] = useState<Flow[]>([]);
  const [counts, setCounts] = useState<{ failed: number; succeeded: number }>({ failed: 0, succeeded: 0 });
  const [filter, setFilter] = useState('');
  const [loading, setLoading] = useState(false);
  const [replaying, setReplaying] = useState<string | null>(null);

  // record-flow form
  const [peerId, setPeerId] = useState('');
  const [action, setAction] = useState('sync');
  const [records, setRecords] = useState('1000');
  const [duration, setDuration] = useState('1000');
  const [outcome, setOutcome] = useState('succeeded');
  const [recErr, setRecErr] = useState('sync error');

  const load = useCallback(async () => {
    setLoading(true);
    const input: Record<string, unknown> = { limit: 100 };
    if (filter) input.status = filter;
    const r = await lensRun<{ flows: Flow[]; failed: number; succeeded: number }>('bridge', 'flowList', input);
    if (r.data.ok && r.data.result) {
      setFlows(r.data.result.flows || []);
      setCounts({ failed: r.data.result.failed, succeeded: r.data.result.succeeded });
    }
    setLoading(false);
  }, [filter]);

  useEffect(() => { load(); }, [load]);

  const record = async () => {
    if (!peerId) { setErr('select a peer to record a flow against'); return; }
    const r = await lensRun('bridge', 'recordFlow', {
      peerId, action,
      records: parseInt(records, 10) || 0,
      durationMs: parseInt(duration, 10) || 1000,
      status: outcome,
      error: outcome === 'failed' ? recErr : undefined,
    });
    if (!r.data.ok) setErr(r.data.error);
    else await load();
  };

  const replay = async (flowId: string) => {
    setReplaying(flowId);
    const r = await lensRun<{ recovered: boolean; attempts: number }>('bridge', 'flowReplay', { flowId });
    if (!r.data.ok) setErr(r.data.error);
    await load();
    setReplaying(null);
  };

  return (
    <div className="space-y-3">
      {/* record-flow control */}
      <div className="rounded-lg border border-zinc-800 bg-zinc-950/60 p-3">
        <p className="text-[11px] font-semibold text-zinc-400 mb-2 uppercase tracking-wide">Record Sync Flow</p>
        <div className="flex flex-wrap gap-2">
          <select value={peerId} onChange={e => setPeerId(e.target.value)}
            className="bg-zinc-900 border border-zinc-800 rounded px-2 py-1.5 text-xs text-zinc-200">
            <option value="">— peer —</option>
            {peers.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}
          </select>
          <input value={action} onChange={e => setAction(e.target.value)} placeholder="action"
            className="w-28 bg-zinc-900 border border-zinc-800 rounded px-2 py-1.5 text-xs text-zinc-200" />
          <input value={records} onChange={e => setRecords(e.target.value)} placeholder="records" type="number"
            className="w-24 bg-zinc-900 border border-zinc-800 rounded px-2 py-1.5 text-xs text-zinc-200" />
          <input value={duration} onChange={e => setDuration(e.target.value)} placeholder="duration ms" type="number"
            className="w-28 bg-zinc-900 border border-zinc-800 rounded px-2 py-1.5 text-xs text-zinc-200" />
          <select value={outcome} onChange={e => setOutcome(e.target.value)}
            className="bg-zinc-900 border border-zinc-800 rounded px-2 py-1.5 text-xs text-zinc-200">
            <option value="succeeded">succeeded</option>
            <option value="failed">failed</option>
            <option value="pending">pending</option>
          </select>
          {outcome === 'failed' && (
            <input value={recErr} onChange={e => setRecErr(e.target.value)} placeholder="error msg"
              className="flex-1 min-w-[120px] bg-zinc-900 border border-zinc-800 rounded px-2 py-1.5 text-xs text-zinc-200" />
          )}
          <button onClick={record}
            className="flex items-center gap-1 px-3 py-1.5 rounded bg-cyan-500/20 text-cyan-300 hover:bg-cyan-500/30 text-xs">
            <Plus className="w-3.5 h-3.5" /> Record
          </button>
        </div>
      </div>

      <div className="flex items-center justify-between">
        <div className="flex gap-2 text-xs">
          {['', 'failed', 'succeeded', 'pending'].map(f => (
            <button key={f || 'all'} onClick={() => setFilter(f)}
              className={`px-2 py-1 rounded ${filter === f ? 'bg-zinc-700 text-white' : 'bg-zinc-900 text-zinc-400 hover:text-zinc-300'}`}>
              {f || 'all'}
            </button>
          ))}
        </div>
        <div className="flex gap-3 text-xs text-zinc-400">
          <span className="text-green-400">{counts.succeeded} ok</span>
          <span className="text-red-400">{counts.failed} failed</span>
          <button aria-label="Refresh" onClick={load}><RefreshCw className={`w-3.5 h-3.5 ${loading ? 'animate-spin' : ''}`} /></button>
        </div>
      </div>

      {flows.length === 0 ? (
        <div className="h-32 flex items-center justify-center text-xs text-zinc-400 border border-zinc-800 rounded-lg">
          No flows recorded. Record a sync flow above.
        </div>
      ) : (
        <div className="space-y-1.5">
          {flows.map(f => (
            <div key={f.id} className="flex items-center gap-3 p-2.5 rounded-lg bg-zinc-950/60 border border-zinc-800">
              <span className={`w-2 h-2 rounded-full flex-shrink-0 ${
                f.status === 'succeeded' ? 'bg-green-400' : f.status === 'failed' ? 'bg-red-400' : 'bg-amber-400'}`} />
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2 text-xs">
                  <span className="font-medium text-zinc-200">{f.peerName}</span>
                  <span className="text-zinc-400">{f.action}</span>
                  <span className="text-zinc-600">{f.records} rec · {f.rps} rps</span>
                  {f.attempts > 1 && <span className="text-amber-400">×{f.attempts}</span>}
                </div>
                {f.error && <p className="text-[11px] text-red-400/80 mt-0.5 truncate">{f.error}</p>}
              </div>
              <span className="text-[10px] text-zinc-400">{new Date(f.at).toLocaleTimeString()}</span>
              {f.status === 'failed' && (
                <button onClick={() => replay(f.id)} disabled={replaying === f.id}
                  className="flex items-center gap-1 px-2 py-1 rounded bg-amber-500/20 text-amber-300 hover:bg-amber-500/30 text-[11px] disabled:opacity-40">
                  {replaying === f.id ? <Loader2 className="w-3 h-3 animate-spin" /> : <Play className="w-3 h-3" />} Replay
                </button>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

/* ------------------------------------------------------------------ */
/*  3. Mappings tab — field-mapping editor + live preview              */
/* ------------------------------------------------------------------ */

function MappingsTab({ peers, setErr }: { peers: Peer[]; setErr: (e: string | null) => void }) {
  const [mappings, setMappings] = useState<FieldMapping[]>([]);
  const [transforms, setTransforms] = useState<string[]>([]);
  const [preview, setPreview] = useState<PreviewRow[] | null>(null);
  const [sampleText, setSampleText] = useState('{\n  "first_name": " ada ",\n  "age": "37"\n}');

  // editor form
  const [source, setSource] = useState('');
  const [target, setTarget] = useState('');
  const [transform, setTransform] = useState('direct');
  const [dataType, setDataType] = useState('string');
  const [peerId, setPeerId] = useState('');
  const [required, setRequired] = useState(false);

  const load = useCallback(async () => {
    const r = await lensRun<{ mappings: FieldMapping[]; transforms: string[] }>('bridge', 'mappingList', {});
    if (r.data.ok && r.data.result) {
      setMappings(r.data.result.mappings || []);
      setTransforms(r.data.result.transforms || []);
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  const upsert = async () => {
    if (!source.trim() || !target.trim()) { setErr('source and target fields required'); return; }
    const r = await lensRun('bridge', 'mappingUpsert', {
      source, target, transform, dataType, required, peerId: peerId || undefined,
    });
    if (!r.data.ok) setErr(r.data.error);
    else { setSource(''); setTarget(''); await load(); }
  };

  const remove = async (mappingId: string) => {
    const r = await lensRun('bridge', 'mappingRemove', { mappingId });
    if (!r.data.ok) setErr(r.data.error);
    await load();
  };

  const runPreview = async () => {
    let sample: Record<string, unknown>;
    try { sample = JSON.parse(sampleText); }
    catch { setErr('sample must be valid JSON'); return; }
    const r = await lensRun<{ rows: PreviewRow[] }>('bridge', 'mappingPreview', { sample });
    if (r.data.ok && r.data.result) setPreview(r.data.result.rows || []);
    else if (!r.data.ok) setErr(r.data.error);
  };

  return (
    <div className="space-y-3">
      {/* editor */}
      <div className="rounded-lg border border-zinc-800 bg-zinc-950/60 p-3">
        <p className="text-[11px] font-semibold text-zinc-400 mb-2 uppercase tracking-wide">Field-Mapping Editor</p>
        <div className="flex flex-wrap gap-2">
          <input value={source} onChange={e => setSource(e.target.value)} placeholder="source field"
            className="w-32 bg-zinc-900 border border-zinc-800 rounded px-2 py-1.5 text-xs text-zinc-200 font-mono" />
          <input value={target} onChange={e => setTarget(e.target.value)} placeholder="target field"
            className="w-32 bg-zinc-900 border border-zinc-800 rounded px-2 py-1.5 text-xs text-zinc-200 font-mono" />
          <select value={transform} onChange={e => setTransform(e.target.value)}
            className="bg-zinc-900 border border-zinc-800 rounded px-2 py-1.5 text-xs text-zinc-200">
            {(transforms.length ? transforms : ['direct']).map(t => <option key={t} value={t}>{t}</option>)}
          </select>
          <select value={dataType} onChange={e => setDataType(e.target.value)}
            className="bg-zinc-900 border border-zinc-800 rounded px-2 py-1.5 text-xs text-zinc-200">
            {['string', 'number', 'boolean', 'date', 'json'].map(t => <option key={t} value={t}>{t}</option>)}
          </select>
          <select value={peerId} onChange={e => setPeerId(e.target.value)}
            className="bg-zinc-900 border border-zinc-800 rounded px-2 py-1.5 text-xs text-zinc-200">
            <option value="">all peers</option>
            {peers.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}
          </select>
          <label className="flex items-center gap-1 text-xs text-zinc-400">
            <input type="checkbox" checked={required} onChange={e => setRequired(e.target.checked)} /> required
          </label>
          <button onClick={upsert}
            className="flex items-center gap-1 px-3 py-1.5 rounded bg-cyan-500/20 text-cyan-300 hover:bg-cyan-500/30 text-xs">
            <Plus className="w-3.5 h-3.5" /> Save Mapping
          </button>
        </div>
      </div>

      {/* mapping list */}
      {mappings.length === 0 ? (
        <p className="text-[11px] text-zinc-400 px-1">No field mappings defined yet.</p>
      ) : (
        <div className="space-y-1.5">
          {mappings.map(m => (
            <div key={m.id} className="flex items-center gap-2 p-2 rounded-lg bg-zinc-950/60 border border-zinc-800 text-xs">
              <span className="font-mono text-zinc-300">{m.source}</span>
              <GitMerge className="w-3 h-3 text-zinc-600" />
              <span className="font-mono text-zinc-300">{m.target}</span>
              <span className="px-1.5 py-0.5 rounded bg-purple-500/20 text-purple-300">{m.transform}</span>
              <span className="text-zinc-600">{m.dataType}</span>
              {m.required && <span className="text-amber-400">required</span>}
              <button aria-label="Delete" onClick={() => remove(m.id)} className="ml-auto text-zinc-600 hover:text-red-400">
                <Trash2 className="w-3.5 h-3.5" />
              </button>
            </div>
          ))}
        </div>
      )}

      {/* transform preview */}
      <div className="rounded-lg border border-zinc-800 bg-zinc-950/60 p-3">
        <div className="flex items-center justify-between mb-2">
          <p className="text-[11px] font-semibold text-zinc-400 uppercase tracking-wide">Transform Preview</p>
          <button onClick={runPreview}
            className="flex items-center gap-1 px-2 py-1 rounded bg-zinc-800 text-zinc-300 hover:bg-zinc-700 text-[11px]">
            <Play className="w-3 h-3" /> Run Preview
          </button>
        </div>
        <textarea value={sampleText} onChange={e => setSampleText(e.target.value)} rows={4}
          className="w-full bg-zinc-900 border border-zinc-800 rounded px-2 py-1.5 text-xs text-zinc-200 font-mono mb-2" />
        {preview && (
          preview.length === 0
            ? <p className="text-[11px] text-zinc-400">No mappings to preview — add one above.</p>
            : <div className="space-y-1">
                {preview.map(r => (
                  <div key={r.mappingId} className="flex items-center gap-2 text-[11px] p-1.5 rounded bg-zinc-900">
                    {r.ok ? <CheckCircle2 className="w-3 h-3 text-green-400" /> : <XCircle className="w-3 h-3 text-red-400" />}
                    <span className="font-mono text-zinc-400">{r.source}</span>
                    <span className="text-zinc-600">{JSON.stringify(r.inputValue)}</span>
                    <GitMerge className="w-3 h-3 text-zinc-700" />
                    <span className="font-mono text-zinc-300">{r.target}</span>
                    <span className="text-cyan-300">{r.ok ? JSON.stringify(r.outputValue) : '—'}</span>
                    {r.error && <span className="text-red-400/80 ml-auto">{r.error}</span>}
                  </div>
                ))}
              </div>
        )}
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/*  4. Schedules tab — per-peer sync schedule configuration            */
/* ------------------------------------------------------------------ */

function SchedulesTab({ peers, setErr }: { peers: Peer[]; setErr: (e: string | null) => void }) {
  const [schedules, setSchedules] = useState<Schedule[]>([]);
  const [active, setActive] = useState(0);
  // local edits keyed by peerId
  const [edits, setEdits] = useState<Record<string, { mode: string; intervalMinutes: number; enabled: boolean }>>({});

  const load = useCallback(async () => {
    const r = await lensRun<{ schedules: Schedule[]; active: number }>('bridge', 'scheduleList', {});
    if (r.data.ok && r.data.result) {
      setSchedules(r.data.result.schedules || []);
      setActive(r.data.result.active || 0);
      const e: Record<string, { mode: string; intervalMinutes: number; enabled: boolean }> = {};
      (r.data.result.schedules || []).forEach(s => {
        e[s.peerId] = { mode: s.mode, intervalMinutes: s.intervalMinutes, enabled: s.enabled };
      });
      setEdits(e);
    }
  }, []);

  useEffect(() => { load(); }, [load, peers.length]);

  const save = async (peerId: string) => {
    const e = edits[peerId];
    if (!e) return;
    const r = await lensRun('bridge', 'scheduleSet', {
      peerId, mode: e.mode, intervalMinutes: e.intervalMinutes, enabled: e.enabled,
    });
    if (!r.data.ok) setErr(r.data.error);
    await load();
  };

  const patch = (peerId: string, p: Partial<{ mode: string; intervalMinutes: number; enabled: boolean }>) =>
    setEdits(prev => ({ ...prev, [peerId]: { ...prev[peerId], ...p } }));

  return (
    <div className="space-y-3">
      <p className="text-xs text-zinc-400">
        <b className="text-cyan-400">{active}</b> of {schedules.length} peers on an active schedule.
      </p>
      {schedules.length === 0 ? (
        <div className="h-32 flex items-center justify-center text-xs text-zinc-400 border border-zinc-800 rounded-lg">
          Register peers to configure sync schedules.
        </div>
      ) : (
        <div className="space-y-2">
          {schedules.map(s => {
            const e = edits[s.peerId] || { mode: s.mode, intervalMinutes: s.intervalMinutes, enabled: s.enabled };
            return (
              <div key={s.peerId} className="flex flex-wrap items-center gap-2 p-3 rounded-lg bg-zinc-950/60 border border-zinc-800">
                <Calendar className="w-4 h-4 text-zinc-400" />
                <span className="text-sm font-medium text-zinc-200 min-w-[100px]">{s.peerName}</span>
                <select value={e.mode} onChange={ev => patch(s.peerId, { mode: ev.target.value })}
                  className="bg-zinc-900 border border-zinc-800 rounded px-2 py-1 text-xs text-zinc-200">
                  <option value="interval">interval</option>
                  <option value="realtime">realtime</option>
                  <option value="manual">manual</option>
                </select>
                {e.mode === 'interval' && (
                  <span className="flex items-center gap-1 text-xs text-zinc-400">
                    every
                    <input type="number" value={e.intervalMinutes}
                      onChange={ev => patch(s.peerId, { intervalMinutes: parseInt(ev.target.value, 10) || 1 })}
                      className="w-16 bg-zinc-900 border border-zinc-800 rounded px-1.5 py-1 text-xs text-zinc-200" />
                    min
                  </span>
                )}
                <label className="flex items-center gap-1 text-xs text-zinc-400">
                  <input type="checkbox" checked={e.enabled}
                    onChange={ev => patch(s.peerId, { enabled: ev.target.checked })} /> enabled
                </label>
                {s.nextRunAt && (
                  <span className="text-[10px] text-zinc-400">next {new Date(s.nextRunAt).toLocaleString()}</span>
                )}
                <button onClick={() => save(s.peerId)}
                  className="ml-auto px-2.5 py-1 rounded bg-cyan-500/20 text-cyan-300 hover:bg-cyan-500/30 text-[11px]">
                  Save
                </button>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

/* ------------------------------------------------------------------ */
/*  5. Alerts tab — alert rules + live evaluation                      */
/* ------------------------------------------------------------------ */

function AlertsTab({ peers, setErr }: { peers: Peer[]; setErr: (e: string | null) => void }) {
  const [rules, setRules] = useState<AlertRule[]>([]);
  const [fired, setFired] = useState<FiredAlert[]>([]);
  const [evalStats, setEvalStats] = useState<{ rulesEvaluated: number; firing: number; critical: number } | null>(null);

  // new-rule form
  const [metric, setMetric] = useState('error-rate');
  const [threshold, setThreshold] = useState('25');
  const [peerId, setPeerId] = useState('');

  const load = useCallback(async () => {
    const r = await lensRun<{ rules: AlertRule[] }>('bridge', 'alertRuleList', {});
    if (r.data.ok && r.data.result) setRules(r.data.result.rules || []);
  }, []);

  useEffect(() => { load(); }, [load]);

  const addRule = async () => {
    const t = Number(threshold);
    if (!Number.isFinite(t) || t < 0) { setErr('threshold must be a non-negative number'); return; }
    const r = await lensRun('bridge', 'alertRuleUpsert', { metric, threshold: t, peerId: peerId || undefined });
    if (!r.data.ok) setErr(r.data.error);
    else await load();
  };

  const removeRule = async (ruleId: string) => {
    const r = await lensRun('bridge', 'alertRuleRemove', { ruleId });
    if (!r.data.ok) setErr(r.data.error);
    await load();
  };

  const evaluate = async () => {
    const r = await lensRun<{ alerts: FiredAlert[]; rulesEvaluated: number; firing: number; critical: number }>(
      'bridge', 'alertEvaluate', {});
    if (r.data.ok && r.data.result) {
      setFired(r.data.result.alerts || []);
      setEvalStats({
        rulesEvaluated: r.data.result.rulesEvaluated,
        firing: r.data.result.firing,
        critical: r.data.result.critical,
      });
    } else if (!r.data.ok) setErr(r.data.error);
  };

  const METRIC_LABEL: Record<string, string> = {
    'error-rate': 'Error rate ≥ % ',
    'lag-minutes': 'Sync lag ≥ min',
    'consecutive-failures': 'Consecutive failures ≥',
  };

  return (
    <div className="space-y-3">
      {/* new rule */}
      <div className="rounded-lg border border-zinc-800 bg-zinc-950/60 p-3">
        <p className="text-[11px] font-semibold text-zinc-400 mb-2 uppercase tracking-wide">New Alert Rule</p>
        <div className="flex flex-wrap gap-2">
          <select value={metric} onChange={e => setMetric(e.target.value)}
            className="bg-zinc-900 border border-zinc-800 rounded px-2 py-1.5 text-xs text-zinc-200">
            <option value="error-rate">error-rate</option>
            <option value="lag-minutes">lag-minutes</option>
            <option value="consecutive-failures">consecutive-failures</option>
          </select>
          <input type="number" value={threshold} onChange={e => setThreshold(e.target.value)} placeholder="threshold"
            className="w-24 bg-zinc-900 border border-zinc-800 rounded px-2 py-1.5 text-xs text-zinc-200" />
          <select value={peerId} onChange={e => setPeerId(e.target.value)}
            className="bg-zinc-900 border border-zinc-800 rounded px-2 py-1.5 text-xs text-zinc-200">
            <option value="">all peers</option>
            {peers.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}
          </select>
          <button onClick={addRule}
            className="flex items-center gap-1 px-3 py-1.5 rounded bg-cyan-500/20 text-cyan-300 hover:bg-cyan-500/30 text-xs">
            <Plus className="w-3.5 h-3.5" /> Add Rule
          </button>
        </div>
      </div>

      {/* rule list */}
      <div className="flex items-center justify-between">
        <p className="text-[11px] font-semibold text-zinc-400 uppercase tracking-wide">
          {rules.length} Rule{rules.length !== 1 ? 's' : ''}
        </p>
        <button onClick={evaluate}
          className="flex items-center gap-1 px-2.5 py-1 rounded bg-amber-500/20 text-amber-300 hover:bg-amber-500/30 text-[11px]">
          <Activity className="w-3 h-3" /> Evaluate Now
        </button>
      </div>
      {rules.length === 0 ? (
        <p className="text-[11px] text-zinc-400 px-1">No alert rules. Add one to monitor sync failure or lag.</p>
      ) : (
        <div className="space-y-1.5">
          {rules.map(r => (
            <div key={r.id} className="flex items-center gap-2 p-2 rounded-lg bg-zinc-950/60 border border-zinc-800 text-xs">
              <Bell className="w-3.5 h-3.5 text-zinc-400" />
              <span className="text-zinc-300">{METRIC_LABEL[r.metric] || r.metric}</span>
              <span className="font-bold text-amber-400">{r.threshold}</span>
              <span className="text-zinc-600">
                {r.peerId ? (peers.find(p => p.id === r.peerId)?.name || 'peer') : 'all peers'}
              </span>
              <button aria-label="Delete" onClick={() => removeRule(r.id)} className="ml-auto text-zinc-600 hover:text-red-400">
                <Trash2 className="w-3.5 h-3.5" />
              </button>
            </div>
          ))}
        </div>
      )}

      {/* fired alerts */}
      {evalStats && (
        <div className="rounded-lg border border-zinc-800 bg-zinc-950/60 p-3">
          <p className="text-[11px] text-zinc-400 mb-2">
            Evaluated {evalStats.rulesEvaluated} rule{evalStats.rulesEvaluated !== 1 ? 's' : ''} —{' '}
            <b className="text-amber-400">{evalStats.firing} firing</b>
            {evalStats.critical > 0 && <span className="text-red-400"> · {evalStats.critical} critical</span>}
          </p>
          {fired.length === 0 ? (
            <p className="text-[11px] text-green-400 flex items-center gap-1">
              <CheckCircle2 className="w-3.5 h-3.5" /> All thresholds within bounds.
            </p>
          ) : (
            <div className="space-y-1.5">
              {fired.map((a, i) => (
                <div key={i} className={`flex items-center gap-2 p-2 rounded text-[11px] border ${
                  a.severity === 'critical'
                    ? 'bg-red-500/10 border-red-500/30 text-red-300'
                    : 'bg-amber-500/10 border-amber-500/30 text-amber-300'}`}>
                  <AlertTriangle className="w-3.5 h-3.5 flex-shrink-0" />
                  <span className="font-medium">{a.peerName}</span>
                  <span>{a.metric}</span>
                  <span className="font-mono">{a.value} ≥ {a.threshold}</span>
                  <span className="text-zinc-400 ml-auto">{a.detail}</span>
                </div>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

/* ------------------------------------------------------------------ */
/*  6. Throughput tab — history charts over time                       */
/* ------------------------------------------------------------------ */

function ThroughputTab({ peers }: { peers: Peer[] }) {
  const [buckets, setBuckets] = useState<ThroughputBucket[]>([]);
  const [stats, setStats] = useState<{ samples: number; avgRPS: number; peakRPS: number } | null>(null);
  const [msg, setMsg] = useState<string | null>(null);
  const [peerId, setPeerId] = useState('');
  const [bucketMin, setBucketMin] = useState('5');
  const [loading, setLoading] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    const input: Record<string, unknown> = { bucketMinutes: parseInt(bucketMin, 10) || 5 };
    if (peerId) input.peerId = peerId;
    const r = await lensRun<{
      buckets: ThroughputBucket[]; samples: number; avgRPS: number; peakRPS: number; message?: string;
    }>('bridge', 'throughputHistory', input);
    if (r.data.ok && r.data.result) {
      setBuckets(r.data.result.buckets || []);
      setStats({ samples: r.data.result.samples, avgRPS: r.data.result.avgRPS, peakRPS: r.data.result.peakRPS });
      setMsg(r.data.result.message || null);
    }
    setLoading(false);
  }, [peerId, bucketMin]);

  useEffect(() => { load(); }, [load]);

  const chartData = useMemo(
    () => buckets.map(b => ({
      time: new Date(b.ts).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
      avgRPS: b.avgRPS, peakRPS: b.peakRPS, succeeded: b.succeeded, failed: b.failed,
    })),
    [buckets],
  );

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-2">
        <select value={peerId} onChange={e => setPeerId(e.target.value)}
          className="bg-zinc-900 border border-zinc-800 rounded px-2 py-1.5 text-xs text-zinc-200">
          <option value="">all peers</option>
          {peers.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}
        </select>
        <span className="flex items-center gap-1 text-xs text-zinc-400">
          bucket
          <input type="number" value={bucketMin} onChange={e => setBucketMin(e.target.value)}
            className="w-16 bg-zinc-900 border border-zinc-800 rounded px-1.5 py-1 text-xs text-zinc-200" />
          min
        </span>
        <button onClick={load} className="flex items-center gap-1 text-xs text-zinc-400 hover:text-zinc-200">
          <RefreshCw className={`w-3.5 h-3.5 ${loading ? 'animate-spin' : ''}`} /> Reload
        </button>
        {stats && (
          <div className="ml-auto flex gap-3 text-xs text-zinc-400">
            <span>{stats.samples} samples</span>
            <span>avg <b className="text-cyan-400">{stats.avgRPS}</b> rps</span>
            <span>peak <b className="text-green-400">{stats.peakRPS}</b> rps</span>
          </div>
        )}
      </div>

      {chartData.length === 0 ? (
        <div className="h-40 flex items-center justify-center text-xs text-zinc-400 border border-zinc-800 rounded-lg">
          {msg || 'No throughput history yet — record sync flows to build a time series.'}
        </div>
      ) : (
        <>
          <div>
            <p className="text-[11px] text-zinc-400 mb-1">Records / second over time</p>
            <ChartKit kind="area" data={chartData} xKey="time"
              series={[
                { key: 'avgRPS', label: 'Avg RPS', color: '#06b6d4' },
                { key: 'peakRPS', label: 'Peak RPS', color: '#22c55e' },
              ]} height={200} />
          </div>
          <div>
            <p className="text-[11px] text-zinc-400 mb-1">Flow outcomes per bucket</p>
            <ChartKit kind="bar" data={chartData} xKey="time" stacked
              series={[
                { key: 'succeeded', label: 'Succeeded', color: '#22c55e' },
                { key: 'failed', label: 'Failed', color: '#ef4444' },
              ]} height={180} />
          </div>
        </>
      )}
    </div>
  );
}
