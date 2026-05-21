'use client';

// CrossDomainWorkbench — the cross-domain analogy / knowledge-graph resonance
// surface. Wires the resonance-domain macros:
//   proposePair · listPairs · resonanceGraph · pairDrilldown
//   resonanceAlerts · resonanceToInsight · listInsights · pairTrend
// Every value rendered is computed by a real macro call.

import { useState, useCallback, useEffect, useMemo } from 'react';
import { lensRun } from '@/lib/api/client';
import { ChartKit } from '@/components/viz';
import {
  GitBranch,
  Plus,
  Bell,
  Lightbulb,
  Network,
  TrendingUp,
  X,
  Loader2,
  Check,
  AlertTriangle,
  Trash2,
  ArrowRight,
  Download,
  Microscope,
} from 'lucide-react';

// ── Types ────────────────────────────────────────────────────────────────

interface PairSide {
  id: string;
  domain: string;
  title: string;
  description?: string;
  invariants: string[];
}

interface Pair {
  id: string;
  a: PairSide;
  b: PairSide;
  note?: string;
  resonance: number;
  invOverlap: number;
  tokOverlap: number;
  classification: string;
  sharedInvariants: string[];
  createdAt: string;
  analyzedAt?: string;
}

interface GraphNode {
  id: string;
  label: string;
  pairCount: number;
  avgResonance: number;
}

interface GraphEdge {
  source: string;
  target: string;
  strength: number;
  classification: string;
  pairCount: number;
  pairIds: string[];
}

interface ResonanceGraph {
  nodes: GraphNode[];
  edges: GraphEdge[];
  stats: { domains: number; connections: number; strongestEdge: GraphEdge | null };
}

interface Correspondence {
  aInvariant: string;
  bInvariant: string | null;
  alignment: number;
  aligned: boolean;
  sharedTokens: string[];
}

interface Drilldown {
  pair: {
    id: string;
    a: { domain: string; title: string };
    b: { domain: string; title: string };
    resonance: number;
    classification: string;
    invOverlap: number;
    tokOverlap: number;
  };
  correspondences: Correspondence[];
  alignedCount: number;
  unmatchedA: string[];
  unmatchedB: string[];
  interpretation: string;
}

interface ResAlert {
  id: string;
  pairId: string;
  label: string;
  resonance: number;
  classification: string;
  message: string;
  raisedAt: string;
  acknowledged: boolean;
  acknowledgedAt?: string;
}

interface Insight {
  id: string;
  kind: string;
  title: string;
  layers: {
    human: string;
    core: { claims: string[]; evidence: Record<string, unknown> };
  };
  derivedFrom: string;
  confidence: number;
  createdAt: string;
}

interface TrendSample {
  timestamp: string;
  resonance: number;
  invOverlap: number;
  tokOverlap: number;
  classification: string;
}

interface TrendResult {
  pairId: string;
  label: string;
  series: TrendSample[];
  samples: number;
  current: number;
  delta: number;
  direction: string;
  peak: number;
}

// ── Classification palette ───────────────────────────────────────────────

const CLASS_META: Record<string, { label: string; color: string }> = {
  strong_resonance: { label: 'Strong', color: '#00ffc8' },
  moderate_resonance: { label: 'Moderate', color: '#a855f7' },
  weak_signal: { label: 'Weak', color: '#eab308' },
  noise_floor: { label: 'Noise', color: '#6b7280' },
};
const cmeta = (c: string) => CLASS_META[c] || CLASS_META.noise_floor;

type Tab = 'pairs' | 'graph' | 'alerts' | 'insights';

// ── Pair Authoring Form ──────────────────────────────────────────────────

function emptySide() {
  return { domain: '', title: '', description: '', invariants: '' };
}

function ProposePairForm({ onCreated }: { onCreated: () => void }) {
  const [a, setA] = useState(emptySide());
  const [b, setB] = useState(emptySide());
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [open, setOpen] = useState(false);

  const submit = useCallback(async () => {
    setError(null);
    if (!a.domain.trim() || !a.title.trim() || !b.domain.trim() || !b.title.trim()) {
      setError('Both sides need a domain and a title.');
      return;
    }
    setBusy(true);
    const toSide = (s: ReturnType<typeof emptySide>) => ({
      domain: s.domain.trim(),
      title: s.title.trim(),
      description: s.description.trim(),
      invariants: s.invariants
        .split('\n')
        .map((x) => x.trim())
        .filter(Boolean),
    });
    const res = await lensRun('resonance', 'proposePair', {
      a: toSide(a),
      b: toSide(b),
      note: note.trim(),
    });
    setBusy(false);
    if (!res.data.ok) {
      setError(res.data.error || 'Failed to propose pair.');
      return;
    }
    setA(emptySide());
    setB(emptySide());
    setNote('');
    setOpen(false);
    onCreated();
  }, [a, b, note, onCreated]);

  const sideEditor = (
    label: string,
    s: ReturnType<typeof emptySide>,
    set: (v: ReturnType<typeof emptySide>) => void,
  ) => (
    <div className="space-y-2 rounded-lg border border-white/5 bg-black/30 p-3">
      <p className="text-[11px] font-mono uppercase tracking-wider text-gray-500">{label}</p>
      <input
        value={s.domain}
        onChange={(e) => set({ ...s, domain: e.target.value })}
        placeholder="Domain (e.g. immunology)"
        className="w-full rounded bg-white/[0.03] px-2 py-1.5 text-xs text-white placeholder:text-gray-700 focus:outline-none focus:ring-1 focus:ring-purple-500"
      />
      <input
        value={s.title}
        onChange={(e) => set({ ...s, title: e.target.value })}
        placeholder="Concept title"
        className="w-full rounded bg-white/[0.03] px-2 py-1.5 text-xs text-white placeholder:text-gray-700 focus:outline-none focus:ring-1 focus:ring-purple-500"
      />
      <textarea
        value={s.description}
        onChange={(e) => set({ ...s, description: e.target.value })}
        placeholder="Short description (semantic surface)"
        rows={2}
        className="w-full resize-none rounded bg-white/[0.03] px-2 py-1.5 text-xs text-white placeholder:text-gray-700 focus:outline-none focus:ring-1 focus:ring-purple-500"
      />
      <textarea
        value={s.invariants}
        onChange={(e) => set({ ...s, invariants: e.target.value })}
        placeholder="Invariants / constraints — one per line"
        rows={3}
        className="w-full resize-none rounded bg-white/[0.03] px-2 py-1.5 font-mono text-[11px] text-white placeholder:text-gray-700 focus:outline-none focus:ring-1 focus:ring-purple-500"
      />
    </div>
  );

  if (!open) {
    return (
      <button
        onClick={() => setOpen(true)}
        className="flex items-center gap-2 rounded-lg border border-purple-500/30 bg-purple-500/10 px-3 py-2 text-xs font-medium text-purple-300 transition-colors hover:bg-purple-500/20"
      >
        <Plus className="h-3.5 w-3.5" />
        Propose Domain Pair
      </button>
    );
  }

  return (
    <div className="rounded-lg border border-purple-500/20 bg-black/40 p-4 space-y-3">
      <div className="flex items-center justify-between">
        <h3 className="flex items-center gap-2 text-sm font-bold text-purple-300">
          <GitBranch className="h-4 w-4" /> Propose a Cross-Domain Pair
        </h3>
        <button onClick={() => setOpen(false)} className="text-gray-600 hover:text-gray-400">
          <X className="h-4 w-4" />
        </button>
      </div>
      <p className="text-[11px] text-gray-600">
        Resonance is high invariant alignment with low semantic overlap — a genuine analogy, not the
        same idea restated. List the structural invariants of each side; matching tokens drive the
        score.
      </p>
      <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
        {sideEditor('Side A', a, setA)}
        {sideEditor('Side B', b, setB)}
      </div>
      <textarea
        value={note}
        onChange={(e) => setNote(e.target.value)}
        placeholder="Optional note about why these two might resonate"
        rows={2}
        className="w-full resize-none rounded bg-white/[0.03] px-2 py-1.5 text-xs text-white placeholder:text-gray-700 focus:outline-none focus:ring-1 focus:ring-purple-500"
      />
      {error && (
        <p className="flex items-center gap-1.5 text-[11px] text-red-400">
          <AlertTriangle className="h-3 w-3" /> {error}
        </p>
      )}
      <button
        onClick={submit}
        disabled={busy}
        className="flex items-center gap-2 rounded-lg border border-purple-500/30 bg-purple-500/15 px-4 py-2 text-xs font-medium text-purple-200 transition-colors hover:bg-purple-500/25 disabled:opacity-50"
      >
        {busy ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Microscope className="h-3.5 w-3.5" />}
        Analyze Resonance
      </button>
    </div>
  );
}

// ── Pair Drilldown Modal ─────────────────────────────────────────────────

function DrilldownModal({
  pairId,
  onClose,
}: {
  pairId: string;
  onClose: () => void;
}) {
  const [data, setData] = useState<Drilldown | null>(null);
  const [trend, setTrend] = useState<TrendResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [insightBusy, setInsightBusy] = useState(false);
  const [insightMsg, setInsightMsg] = useState<string | null>(null);

  const load = useCallback(async () => {
    const [d, t] = await Promise.all([
      lensRun<Drilldown>('resonance', 'pairDrilldown', { pairId }),
      lensRun<TrendResult>('resonance', 'pairTrend', { pairId }),
    ]);
    if (!d.data.ok) {
      setError(d.data.error || 'Failed to load drill-down.');
      return;
    }
    setData(d.data.result);
    if (t.data.ok) setTrend(t.data.result);
  }, [pairId]);

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const sampleTrend = useCallback(async () => {
    const t = await lensRun<TrendResult>('resonance', 'pairTrend', { pairId });
    if (t.data.ok) setTrend(t.data.result);
  }, [pairId]);

  const promote = useCallback(async () => {
    setInsightBusy(true);
    setInsightMsg(null);
    const res = await lensRun<{ insight: Insight }>('resonance', 'resonanceToInsight', { pairId });
    setInsightBusy(false);
    if (!res.data.ok) {
      setInsightMsg(res.data.error || 'Could not form a hypothesis.');
      return;
    }
    setInsightMsg(`Hypothesis recorded: ${res.data.result?.insight.title}`);
  }, [pairId]);

  const trendChart = useMemo(() => {
    if (!trend || trend.series.length < 2) return null;
    return trend.series.map((s, i) => ({
      sample: `#${i + 1}`,
      resonance: Math.round(s.resonance * 1000) / 10,
      invariant: Math.round(s.invOverlap * 1000) / 10,
    }));
  }, [trend]);

  return (
    <div
      className="fixed inset-0 z-[100] flex items-center justify-center bg-black/80 p-4"
      onClick={onClose}
    >
      <div
        className="max-h-[85vh] w-full max-w-2xl overflow-y-auto rounded-xl border border-white/10 bg-[#0a0a14] p-5"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="mb-4 flex items-center justify-between">
          <h3 className="flex items-center gap-2 text-sm font-bold text-white">
            <Microscope className="h-4 w-4 text-purple-400" /> Pair Drill-Down
          </h3>
          <button onClick={onClose} className="text-gray-600 hover:text-gray-300">
            <X className="h-4 w-4" />
          </button>
        </div>

        {error && <p className="text-xs text-red-400">{error}</p>}
        {!data && !error && (
          <div className="flex items-center justify-center py-12 text-gray-600">
            <Loader2 className="h-5 w-5 animate-spin" />
          </div>
        )}

        {data && (
          <div className="space-y-4">
            <div className="flex items-center gap-3 rounded-lg border border-white/5 bg-black/30 p-3">
              <span
                className="rounded px-2 py-0.5 font-mono text-[11px]"
                style={{
                  background: cmeta(data.pair.classification).color + '22',
                  color: cmeta(data.pair.classification).color,
                }}
              >
                {data.pair.a.domain}
              </span>
              <ArrowRight className="h-3.5 w-3.5 text-gray-600" />
              <span
                className="rounded px-2 py-0.5 font-mono text-[11px]"
                style={{
                  background: cmeta(data.pair.classification).color + '22',
                  color: cmeta(data.pair.classification).color,
                }}
              >
                {data.pair.b.domain}
              </span>
              <span className="ml-auto font-mono text-lg font-bold" style={{ color: cmeta(data.pair.classification).color }}>
                {(data.pair.resonance * 100).toFixed(1)}
              </span>
            </div>

            <div className="grid grid-cols-3 gap-2 text-center">
              {[
                { label: 'Invariant overlap', v: data.pair.invOverlap },
                { label: 'Semantic distance', v: 1 - data.pair.tokOverlap },
                { label: 'Aligned invariants', v: null, raw: data.alignedCount },
              ].map((m) => (
                <div key={m.label} className="rounded-lg border border-white/5 bg-black/30 p-2">
                  <p className="font-mono text-base font-bold text-white">
                    {m.raw != null ? m.raw : `${((m.v ?? 0) * 100).toFixed(0)}%`}
                  </p>
                  <p className="text-[10px] text-gray-600">{m.label}</p>
                </div>
              ))}
            </div>

            <p className="rounded-lg border-l-2 border-purple-500/40 bg-purple-500/5 p-2 text-[11px] italic text-gray-400">
              {data.interpretation}
            </p>

            <div>
              <p className="mb-2 text-[11px] font-mono uppercase tracking-wider text-gray-500">
                Invariant Correspondences
              </p>
              <div className="space-y-1.5">
                {data.correspondences.map((c, i) => (
                  <div
                    key={i}
                    className="rounded-lg border border-white/5 bg-black/30 p-2"
                    style={{ borderLeftColor: c.aligned ? '#00ffc8' : '#6b7280', borderLeftWidth: 2 }}
                  >
                    <div className="flex items-center gap-2 text-[11px]">
                      <span className="flex-1 font-mono text-gray-300">{c.aInvariant}</span>
                      {c.aligned && <ArrowRight className="h-3 w-3 flex-shrink-0 text-[#00ffc8]" />}
                      {c.aligned ? (
                        <span className="flex-1 font-mono text-gray-300">{c.bInvariant}</span>
                      ) : (
                        <span className="flex-1 text-gray-700">no aligned counterpart</span>
                      )}
                      <span
                        className="font-mono text-[10px]"
                        style={{ color: c.aligned ? '#00ffc8' : '#6b7280' }}
                      >
                        {(c.alignment * 100).toFixed(0)}%
                      </span>
                    </div>
                    {c.sharedTokens.length > 0 && (
                      <div className="mt-1 flex flex-wrap gap-1">
                        {c.sharedTokens.map((t) => (
                          <span
                            key={t}
                            className="rounded bg-[#00ffc8]/10 px-1.5 py-0.5 font-mono text-[9px] text-[#00ffc8]"
                          >
                            {t}
                          </span>
                        ))}
                      </div>
                    )}
                  </div>
                ))}
              </div>
            </div>

            {trendChart && (
              <div>
                <div className="mb-1 flex items-center justify-between">
                  <p className="text-[11px] font-mono uppercase tracking-wider text-gray-500">
                    Resonance Trend ({trend?.samples} samples · {trend?.direction})
                  </p>
                  <button
                    onClick={sampleTrend}
                    className="rounded border border-white/10 px-2 py-0.5 text-[10px] text-gray-500 hover:text-white"
                  >
                    Sample again
                  </button>
                </div>
                <ChartKit
                  kind="line"
                  data={trendChart}
                  xKey="sample"
                  height={140}
                  series={[
                    { key: 'resonance', label: 'Resonance %', color: '#00ffc8' },
                    { key: 'invariant', label: 'Invariant overlap %', color: '#a855f7' },
                  ]}
                />
              </div>
            )}
            {trend && trend.samples < 2 && (
              <button
                onClick={sampleTrend}
                className="flex items-center gap-1.5 rounded border border-white/10 px-3 py-1.5 text-[11px] text-gray-400 hover:text-white"
              >
                <TrendingUp className="h-3.5 w-3.5" /> Record a trend sample
              </button>
            )}

            <div className="flex flex-wrap items-center gap-2 border-t border-white/5 pt-3">
              <button
                onClick={promote}
                disabled={insightBusy}
                className="flex items-center gap-1.5 rounded-lg border border-amber-500/30 bg-amber-500/10 px-3 py-1.5 text-[11px] font-medium text-amber-300 hover:bg-amber-500/20 disabled:opacity-50"
              >
                {insightBusy ? (
                  <Loader2 className="h-3.5 w-3.5 animate-spin" />
                ) : (
                  <Lightbulb className="h-3.5 w-3.5" />
                )}
                Promote to Citable Hypothesis
              </button>
              {insightMsg && <span className="text-[11px] text-gray-400">{insightMsg}</span>}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

// ── Resonance Graph (lightweight SVG network) ────────────────────────────

function GraphView({ graph }: { graph: ResonanceGraph }) {
  const layout = useMemo(() => {
    const n = graph.nodes.length;
    const cx = 50;
    const cy = 50;
    const radius = 38;
    const positions = new Map<string, { x: number; y: number }>();
    graph.nodes.forEach((node, i) => {
      if (n === 1) {
        positions.set(node.id, { x: cx, y: cy });
      } else {
        const angle = (i / n) * Math.PI * 2 - Math.PI / 2;
        positions.set(node.id, {
          x: cx + Math.cos(angle) * radius,
          y: cy + Math.sin(angle) * radius,
        });
      }
    });
    return positions;
  }, [graph]);

  if (graph.nodes.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center rounded-lg border border-white/5 py-16 text-gray-600">
        <Network className="mb-3 h-8 w-8 opacity-30" />
        <p className="text-sm">No domain network yet</p>
        <p className="text-xs">Propose pairs across distinct domains to build the graph.</p>
      </div>
    );
  }

  return (
    <div className="space-y-3">
      <div className="grid grid-cols-3 gap-2">
        {[
          { label: 'Domains', v: graph.stats.domains },
          { label: 'Connections', v: graph.stats.connections },
          {
            label: 'Strongest edge',
            v: graph.stats.strongestEdge
              ? `${(graph.stats.strongestEdge.strength * 100).toFixed(0)}%`
              : '—',
          },
        ].map((m) => (
          <div key={m.label} className="rounded-lg border border-white/5 bg-black/30 p-2 text-center">
            <p className="font-mono text-base font-bold text-white">{m.v}</p>
            <p className="text-[10px] text-gray-600">{m.label}</p>
          </div>
        ))}
      </div>

      <div className="rounded-lg border border-white/5 bg-black/40 p-2">
        <svg viewBox="0 0 100 100" className="h-[360px] w-full">
          {graph.edges.map((e, i) => {
            const a = layout.get(e.source);
            const b = layout.get(e.target);
            if (!a || !b) return null;
            const color = cmeta(e.classification).color;
            return (
              <g key={i}>
                <line
                  x1={a.x}
                  y1={a.y}
                  x2={b.x}
                  y2={b.y}
                  stroke={color}
                  strokeWidth={0.4 + e.strength * 2.5}
                  strokeOpacity={0.35 + e.strength * 0.5}
                />
                <text
                  x={(a.x + b.x) / 2}
                  y={(a.y + b.y) / 2}
                  fontSize={2.6}
                  fill={color}
                  textAnchor="middle"
                  fontFamily="monospace"
                >
                  {(e.strength * 100).toFixed(0)}
                </text>
              </g>
            );
          })}
          {graph.nodes.map((node) => {
            const pos = layout.get(node.id);
            if (!pos) return null;
            const r = 3 + Math.min(6, node.pairCount * 1.2);
            return (
              <g key={node.id}>
                <circle
                  cx={pos.x}
                  cy={pos.y}
                  r={r}
                  fill="#0a0a14"
                  stroke="#a855f7"
                  strokeWidth={0.6}
                />
                <text
                  x={pos.x}
                  y={pos.y + r + 3.4}
                  fontSize={2.8}
                  fill="#d4d4d8"
                  textAnchor="middle"
                  fontFamily="monospace"
                >
                  {node.label}
                </text>
              </g>
            );
          })}
        </svg>
      </div>

      <div className="space-y-1">
        <p className="text-[11px] font-mono uppercase tracking-wider text-gray-500">Edges</p>
        {graph.edges.map((e, i) => (
          <div
            key={i}
            className="flex items-center gap-2 rounded border border-white/5 bg-black/30 px-2 py-1.5 text-[11px]"
          >
            <span className="font-mono text-gray-300">{e.source}</span>
            <ArrowRight className="h-3 w-3 text-gray-600" />
            <span className="font-mono text-gray-300">{e.target}</span>
            <span className="ml-auto text-gray-600">{e.pairCount}p</span>
            <span className="font-mono font-bold" style={{ color: cmeta(e.classification).color }}>
              {(e.strength * 100).toFixed(0)}%
            </span>
          </div>
        ))}
      </div>
    </div>
  );
}

// ── Main Workbench ───────────────────────────────────────────────────────

export function CrossDomainWorkbench() {
  const [tab, setTab] = useState<Tab>('pairs');
  const [pairs, setPairs] = useState<Pair[]>([]);
  const [graph, setGraph] = useState<ResonanceGraph | null>(null);
  const [alerts, setAlerts] = useState<ResAlert[]>([]);
  const [insights, setInsights] = useState<Insight[]>([]);
  const [unackCount, setUnackCount] = useState(0);
  const [byClass, setByClass] = useState<Record<string, number>>({});
  const [avgResonance, setAvgResonance] = useState(0);
  const [drillId, setDrillId] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  const refresh = useCallback(async () => {
    setLoading(true);
    const [pr, gr, al, ins] = await Promise.all([
      lensRun<{ pairs: Pair[]; byClass: Record<string, number>; avgResonance: number }>(
        'resonance',
        'listPairs',
        {},
      ),
      lensRun<ResonanceGraph>('resonance', 'resonanceGraph', {}),
      lensRun<{ alerts: ResAlert[]; unacknowledgedCount: number }>(
        'resonance',
        'resonanceAlerts',
        {},
      ),
      lensRun<{ insights: Insight[] }>('resonance', 'listInsights', {}),
    ]);
    if (pr.data.ok && pr.data.result) {
      setPairs(pr.data.result.pairs);
      setByClass(pr.data.result.byClass);
      setAvgResonance(pr.data.result.avgResonance);
    }
    if (gr.data.ok && gr.data.result) setGraph(gr.data.result);
    if (al.data.ok && al.data.result) {
      setAlerts(al.data.result.alerts);
      setUnackCount(al.data.result.unacknowledgedCount);
    }
    if (ins.data.ok && ins.data.result) setInsights(ins.data.result.insights);
    setLoading(false);
  }, []);

  useEffect(() => {
    refresh();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const ackAlert = useCallback(
    async (id: string) => {
      const res = await lensRun<{ alerts: ResAlert[]; unacknowledgedCount: number }>(
        'resonance',
        'resonanceAlerts',
        { acknowledge: id },
      );
      if (res.data.ok && res.data.result) {
        setAlerts(res.data.result.alerts);
        setUnackCount(res.data.result.unacknowledgedCount);
      }
    },
    [],
  );

  const clearAcked = useCallback(async () => {
    const res = await lensRun<{ alerts: ResAlert[]; unacknowledgedCount: number }>(
      'resonance',
      'resonanceAlerts',
      { clearAcknowledged: true },
    );
    if (res.data.ok && res.data.result) {
      setAlerts(res.data.result.alerts);
      setUnackCount(res.data.result.unacknowledgedCount);
    }
  }, []);

  const exportFindings = useCallback(() => {
    const payload = {
      exportedAt: new Date().toISOString(),
      summary: { pairCount: pairs.length, avgResonance, byClass },
      pairs,
      graph,
      insights,
    };
    const blob = new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `resonance-findings-${new Date().toISOString().slice(0, 19).replace(/:/g, '-')}.json`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  }, [pairs, graph, insights, avgResonance, byClass]);

  const tabs: { id: Tab; label: string; icon: typeof GitBranch; badge?: number }[] = [
    { id: 'pairs', label: 'Pairs', icon: GitBranch, badge: pairs.length },
    { id: 'graph', label: 'Graph', icon: Network },
    { id: 'alerts', label: 'Alerts', icon: Bell, badge: unackCount },
    { id: 'insights', label: 'Insights', icon: Lightbulb, badge: insights.length },
  ];

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h2 className="flex items-center gap-2 text-sm font-bold text-white">
          <Network className="h-4 w-4 text-purple-400" /> Cross-Domain Resonance Workbench
        </h2>
        <div className="flex items-center gap-2">
          <button
            onClick={exportFindings}
            disabled={pairs.length === 0}
            className="flex items-center gap-1.5 rounded-lg border border-white/10 px-3 py-1.5 text-xs text-gray-400 transition-colors hover:text-white disabled:opacity-40"
          >
            <Download className="h-3.5 w-3.5" /> Export Findings
          </button>
          <button
            onClick={refresh}
            className="rounded-lg border border-white/10 px-3 py-1.5 text-xs text-gray-400 hover:text-white"
          >
            Refresh
          </button>
        </div>
      </div>

      <ProposePairForm onCreated={refresh} />

      {pairs.length > 0 && (
        <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
          {[
            { label: 'Total pairs', v: pairs.length, color: '#d4d4d8' },
            { label: 'Avg resonance', v: `${(avgResonance * 100).toFixed(1)}%`, color: '#a855f7' },
            { label: 'Strong signals', v: byClass.strong_resonance || 0, color: '#00ffc8' },
            { label: 'Open alerts', v: unackCount, color: '#eab308' },
          ].map((m) => (
            <div key={m.label} className="rounded-lg border border-white/5 bg-black/30 p-2.5 text-center">
              <p className="font-mono text-lg font-bold" style={{ color: m.color }}>
                {m.v}
              </p>
              <p className="text-[10px] text-gray-600">{m.label}</p>
            </div>
          ))}
        </div>
      )}

      <div className="flex items-center gap-0.5 rounded-lg bg-white/[0.03] p-0.5">
        {tabs.map((t) => (
          <button
            key={t.id}
            onClick={() => setTab(t.id)}
            className={`flex flex-1 items-center justify-center gap-1.5 rounded-md px-3 py-1.5 text-xs transition-all ${
              tab === t.id ? 'bg-white/[0.08] text-white' : 'text-gray-600 hover:text-gray-400'
            }`}
          >
            <t.icon className="h-3.5 w-3.5" />
            {t.label}
            {t.badge != null && t.badge > 0 && (
              <span className="rounded-full bg-purple-500/30 px-1.5 text-[10px] text-purple-200">
                {t.badge}
              </span>
            )}
          </button>
        ))}
      </div>

      {loading ? (
        <div className="flex items-center justify-center py-12 text-gray-600">
          <Loader2 className="h-5 w-5 animate-spin" />
        </div>
      ) : (
        <>
          {tab === 'pairs' && (
            <div className="space-y-2">
              {pairs.length === 0 ? (
                <div className="flex flex-col items-center justify-center rounded-lg border border-white/5 py-16 text-gray-600">
                  <GitBranch className="mb-3 h-8 w-8 opacity-30" />
                  <p className="text-sm">No pairs proposed yet</p>
                  <p className="text-xs">Use &quot;Propose Domain Pair&quot; to analyze your first analogy.</p>
                </div>
              ) : (
                pairs.map((p) => (
                  <button
                    key={p.id}
                    onClick={() => setDrillId(p.id)}
                    className="w-full rounded-lg border border-white/5 bg-black/30 p-3 text-left transition-colors hover:border-white/15"
                  >
                    <div className="flex items-center gap-2">
                      <span
                        className="rounded px-1.5 py-0.5 font-mono text-[10px]"
                        style={{
                          background: cmeta(p.classification).color + '22',
                          color: cmeta(p.classification).color,
                        }}
                      >
                        {p.a.domain}
                      </span>
                      <ArrowRight className="h-3 w-3 text-gray-600" />
                      <span
                        className="rounded px-1.5 py-0.5 font-mono text-[10px]"
                        style={{
                          background: cmeta(p.classification).color + '22',
                          color: cmeta(p.classification).color,
                        }}
                      >
                        {p.b.domain}
                      </span>
                      <span
                        className="ml-auto font-mono text-base font-bold"
                        style={{ color: cmeta(p.classification).color }}
                      >
                        {(p.resonance * 100).toFixed(1)}
                      </span>
                    </div>
                    <p className="mt-1 truncate text-xs text-gray-400">{p.a.title}</p>
                    <p className="truncate text-xs text-gray-400">{p.b.title}</p>
                    <div className="mt-1.5 flex items-center gap-3 text-[10px] text-gray-600">
                      <span>{cmeta(p.classification).label}</span>
                      <span>inv {(p.invOverlap * 100).toFixed(0)}%</span>
                      <span>sem-dist {((1 - p.tokOverlap) * 100).toFixed(0)}%</span>
                      <span>{p.sharedInvariants.length} shared</span>
                      <span className="ml-auto text-purple-400">drill down →</span>
                    </div>
                  </button>
                ))
              )}
            </div>
          )}

          {tab === 'graph' && graph && <GraphView graph={graph} />}

          {tab === 'alerts' && (
            <div className="space-y-2">
              {alerts.length > 0 && (
                <div className="flex items-center justify-between">
                  <p className="text-[11px] text-gray-600">
                    {unackCount} unacknowledged of {alerts.length}
                  </p>
                  <button
                    onClick={clearAcked}
                    className="flex items-center gap-1 rounded border border-white/10 px-2 py-1 text-[10px] text-gray-500 hover:text-white"
                  >
                    <Trash2 className="h-3 w-3" /> Clear acknowledged
                  </button>
                </div>
              )}
              {alerts.length === 0 ? (
                <div className="flex flex-col items-center justify-center rounded-lg border border-white/5 py-16 text-gray-600">
                  <Bell className="mb-3 h-8 w-8 opacity-30" />
                  <p className="text-sm">No resonance alerts</p>
                  <p className="text-xs">A strong cross-domain signal raises an alert here.</p>
                </div>
              ) : (
                alerts.map((a) => (
                  <div
                    key={a.id}
                    className={`rounded-lg border p-3 ${
                      a.acknowledged
                        ? 'border-white/5 bg-black/20 opacity-60'
                        : 'border-[#00ffc8]/30 bg-[#00ffc8]/[0.04]'
                    }`}
                  >
                    <div className="flex items-center gap-2">
                      <AlertTriangle
                        className="h-3.5 w-3.5"
                        style={{ color: cmeta(a.classification).color }}
                      />
                      <span className="font-mono text-[11px] text-gray-300">{a.label}</span>
                      <span
                        className="ml-auto font-mono text-sm font-bold"
                        style={{ color: cmeta(a.classification).color }}
                      >
                        {(a.resonance * 100).toFixed(1)}
                      </span>
                    </div>
                    <p className="mt-1 text-xs text-gray-400">{a.message}</p>
                    <div className="mt-2 flex items-center gap-2">
                      <span className="text-[10px] text-gray-600">
                        {new Date(a.raisedAt).toLocaleString()}
                      </span>
                      {a.acknowledged ? (
                        <span className="ml-auto flex items-center gap-1 text-[10px] text-gray-600">
                          <Check className="h-3 w-3" /> acknowledged
                        </span>
                      ) : (
                        <button
                          onClick={() => ackAlert(a.id)}
                          className="ml-auto rounded border border-white/10 px-2 py-0.5 text-[10px] text-gray-400 hover:text-white"
                        >
                          Acknowledge
                        </button>
                      )}
                      <button
                        onClick={() => setDrillId(a.pairId)}
                        className="rounded border border-white/10 px-2 py-0.5 text-[10px] text-purple-400 hover:text-purple-300"
                      >
                        Inspect pair
                      </button>
                    </div>
                  </div>
                ))
              )}
            </div>
          )}

          {tab === 'insights' && (
            <div className="space-y-2">
              {insights.length === 0 ? (
                <div className="flex flex-col items-center justify-center rounded-lg border border-white/5 py-16 text-gray-600">
                  <Lightbulb className="mb-3 h-8 w-8 opacity-30" />
                  <p className="text-sm">No insights distilled yet</p>
                  <p className="text-xs">
                    Drill into a moderate-or-stronger pair and promote it to a citable hypothesis.
                  </p>
                </div>
              ) : (
                insights.map((ins) => (
                  <div key={ins.id} className="rounded-lg border border-amber-500/20 bg-amber-500/[0.04] p-3">
                    <div className="flex items-center gap-2">
                      <Lightbulb className="h-3.5 w-3.5 text-amber-400" />
                      <span className="text-xs font-semibold text-amber-200">{ins.title}</span>
                      <span className="ml-auto rounded bg-amber-500/15 px-1.5 py-0.5 font-mono text-[10px] text-amber-300">
                        conf {(ins.confidence * 100).toFixed(0)}%
                      </span>
                    </div>
                    <p className="mt-1.5 text-[11px] leading-relaxed text-gray-400">
                      {ins.layers.human}
                    </p>
                    {ins.layers.core.claims.length > 0 && (
                      <div className="mt-2 space-y-0.5">
                        {ins.layers.core.claims.map((c, i) => (
                          <p
                            key={i}
                            className="border-l border-white/10 pl-2 font-mono text-[10px] text-gray-500"
                          >
                            {c}
                          </p>
                        ))}
                      </div>
                    )}
                    <p className="mt-2 text-[10px] text-gray-600">
                      {new Date(ins.createdAt).toLocaleString()} · {ins.kind}
                    </p>
                  </div>
                ))
              )}
            </div>
          )}
        </>
      )}

      {drillId && (
        <DrilldownModal
          pairId={drillId}
          onClose={() => {
            setDrillId(null);
            refresh();
          }}
        />
      )}
    </div>
  );
}
