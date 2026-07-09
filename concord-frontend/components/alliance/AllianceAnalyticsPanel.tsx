'use client';

/**
 * AllianceAnalyticsPanel — real UI for the 3 alliance strategic-analysis
 * macros (`compatibilityScore`, `networkAnalysis`, `riskAssessment` in
 * server/domains/alliance.js). Before this rebuild these were only reachable
 * through `<UniversalActions>` — the auto-discovered raw macro-button wall
 * that posts free-typed JSON and dumps the raw response. This panel replaces
 * that with structured forms (comma-separated tag inputs, matching the
 * established codebase idiom — see MentorDirectoryPanel's skills field) and
 * designed result displays (score gauges, DataTable-backed rankings, overlap
 * chips) built on the shared `components/ui` primitives.
 *
 * These three macros are general-purpose diplomatic/network calculators —
 * they take manually-described parties (capabilities/values/resources) or a
 * manually-built node/edge graph, not a live read of the user's own
 * AllianceWorkspace alliances (those model channels/members/proposals, not
 * "capability sets"). Wiring a fabricated bridge between the two would be
 * dishonest; this panel is deliberately a standalone strategic-analysis tool,
 * same shape as Finance's TaxEstimator/RetirementSimulator calculators.
 *
 * Every result rendered here is the real macro's output — no synthetic
 * fallback data. `params.weights` / `params.concentrationThreshold`
 * overrides are not surfaced (the dispatch chokepoint's redundant-artifact-
 * wrapper peel only fires on a single-key `{ artifact: { data } }` body —
 * see server/lib/lens-input-normalize.js — so a second `params` sibling key
 * would break the peel); the macros' own sensible defaults are used, noted
 * in the capability map as a deliberately out-of-scope customization.
 */

import { useState } from 'react';
import {
  HeartHandshake, Network, ShieldAlert, Loader2, Play, Plus, X, AlertTriangle,
} from 'lucide-react';
import { apiHelpers } from '@/lib/api/client';
import { cn } from '@/lib/utils';
import { ds } from '@/lib/design-system';
import { DataTable } from '@/components/ui';
import type { DataTableColumn } from '@/components/ui';

type Envelope<T> = { ok: boolean; result?: T; error?: string; message?: string };

function pickMessage(e: unknown): string {
  const ax = e as { response?: { data?: { error?: string } }; message?: string };
  return ax?.response?.data?.error ?? ax?.message ?? 'request failed';
}

/** Never throws — network/HTTP failures resolve to an honest `{ ok: false }` envelope. */
async function runAllianceMacro<T>(action: string, data: Record<string, unknown>): Promise<Envelope<T>> {
  try {
    const r = await apiHelpers.lens.runDomain('alliance', action, { input: { artifact: { data } } });
    const body = (r as { data?: { ok: boolean; result?: T; error?: string } }).data;
    if (!body) return { ok: false, error: 'empty response' };
    // Handlers return { ok, result } directly; the dispatcher may also unwrap once more.
    if (body.ok && body.result && typeof body.result === 'object' && 'ok' in (body.result as object)) {
      return body.result as unknown as Envelope<T>;
    }
    return body as unknown as Envelope<T>;
  } catch (e) {
    return { ok: false, error: pickMessage(e) };
  }
}

function csv(v: string): string[] {
  return v.split(',').map((s) => s.trim()).filter(Boolean);
}

function ScoreGauge({ value, max = 100, label }: { value: number; max?: number; label: string }) {
  const pct = Math.max(0, Math.min(100, (value / max) * 100));
  const tone = pct >= 70 ? 'text-emerald-300 bg-emerald-500' : pct >= 45 ? 'text-amber-300 bg-amber-500' : 'text-rose-300 bg-rose-500';
  const [toneText, toneBar] = tone.split(' ');
  return (
    <div className="rounded-lg border border-white/10 bg-black/40 p-3">
      <div className="flex items-baseline justify-between mb-1.5">
        <span className="text-[11px] uppercase tracking-wider text-gray-400">{label}</span>
        <span className={cn('font-mono text-xl font-bold tabular-nums', toneText)}>{value}<span className="text-xs text-gray-500">/{max}</span></span>
      </div>
      <div className="h-2 rounded-full bg-white/5 overflow-hidden">
        <div className={cn('h-full rounded-full', toneBar)} style={{ width: `${pct}%` }} />
      </div>
    </div>
  );
}

// ── Compatibility Score ──────────────────────────────────────────────

interface CompatibilityResult {
  partnerA: string; partnerB: string; compositeScore: number; compatibilityLevel: string;
  componentScores: { capabilitySimilarity: number; valuesAlignment: number; resourceSimilarity: number; complementarity: number };
  overlap: { capabilities: string[]; values: string[]; resources: string[] };
  uniqueContributions: Record<string, { capabilities: string[]; resources: string[] }>;
}

const LEVEL_COLOR: Record<string, string> = {
  excellent: 'text-emerald-300 bg-emerald-500/10 border-emerald-500/30',
  good: 'text-blue-300 bg-blue-500/10 border-blue-500/30',
  moderate: 'text-amber-300 bg-amber-500/10 border-amber-500/30',
  low: 'text-rose-300 bg-rose-500/10 border-rose-500/30',
};

function CompatibilityTool() {
  const [a, setA] = useState({ name: '', capabilities: '', values: '', resources: '', strengths: '' });
  const [b, setB] = useState({ name: '', capabilities: '', values: '', resources: '', strengths: '' });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<CompatibilityResult | null>(null);

  const run = async () => {
    if (!a.name.trim() || !b.name.trim()) { setError('Both partner names are required.'); return; }
    setBusy(true); setError(null);
    const r = await runAllianceMacro<CompatibilityResult>('compatibilityScore', {
      partnerA: { name: a.name, capabilities: csv(a.capabilities), values: csv(a.values), resources: csv(a.resources), strengths: csv(a.strengths) },
      partnerB: { name: b.name, capabilities: csv(b.capabilities), values: csv(b.values), resources: csv(b.resources), strengths: csv(b.strengths) },
    });
    setBusy(false);
    if (r.ok === false) { setError(r.error || r.message || 'Compatibility scoring failed.'); return; }
    setResult(r.result || null);
  };

  const Field = ({ label, v, onChange }: { label: string; v: string; onChange: (x: string) => void }) => (
    <label className="block">
      <span className="text-[10px] uppercase tracking-wider text-gray-400">{label}</span>
      <input value={v} onChange={(e) => onChange(e.target.value)} placeholder="comma-separated" className={cn(ds.input, 'mt-0.5 text-xs')} />
    </label>
  );

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
        {[
          { p: a, set: setA, title: 'Partner A' },
          { p: b, set: setB, title: 'Partner B' },
        ].map(({ p, set, title }) => (
          <div key={title} className={ds.panel + ' space-y-2'}>
            <h4 className="font-semibold text-sm">{title}</h4>
            <input
              value={p.name}
              onChange={(e) => set({ ...p, name: e.target.value })}
              placeholder={`${title} name *`}
              className={cn(ds.input, 'text-sm')}
            />
            <Field label="Capabilities" v={p.capabilities} onChange={(x) => set({ ...p, capabilities: x })} />
            <Field label="Values" v={p.values} onChange={(x) => set({ ...p, values: x })} />
            <Field label="Resources" v={p.resources} onChange={(x) => set({ ...p, resources: x })} />
            <Field label="Strengths" v={p.strengths} onChange={(x) => set({ ...p, strengths: x })} />
          </div>
        ))}
      </div>

      {error && <p className="text-xs text-red-400 flex items-center gap-1.5"><AlertTriangle className="w-3.5 h-3.5" /> {error}</p>}

      <button type="button" onClick={run} disabled={busy} className={cn(ds.btnPrimary, 'text-sm inline-flex items-center gap-2')}>
        {busy ? <Loader2 className="w-4 h-4 animate-spin" /> : <Play className="w-4 h-4" />}
        Score compatibility
      </button>

      {result && (
        <div className="space-y-3">
          <div className="flex items-center gap-3">
            <ScoreGauge value={result.compositeScore} label={`${result.partnerA} ↔ ${result.partnerB}`} />
            <span className={cn('text-xs px-2.5 py-1 rounded-full border font-medium capitalize', LEVEL_COLOR[result.compatibilityLevel])}>
              {result.compatibilityLevel}
            </span>
          </div>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-2">
            {Object.entries(result.componentScores).map(([k, v]) => (
              <div key={k} className="rounded-md border border-white/10 bg-black/30 p-2.5">
                <div className="text-[10px] uppercase tracking-wider text-gray-400 truncate">{k.replace(/([A-Z])/g, ' $1')}</div>
                <div className="font-mono text-lg font-semibold text-white">{v}%</div>
              </div>
            ))}
          </div>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
            <div className={ds.panel}>
              <h5 className="text-xs font-semibold text-gray-300 mb-2">Overlap</h5>
              {(['capabilities', 'values', 'resources'] as const).map((k) => (
                <div key={k} className="mb-1.5">
                  <span className="text-[10px] uppercase tracking-wider text-gray-500">{k}</span>
                  <div className="flex flex-wrap gap-1 mt-0.5">
                    {result.overlap[k].length === 0
                      ? <span className="text-[11px] text-gray-500">none</span>
                      : result.overlap[k].map((x) => <span key={x} className="text-[10px] px-1.5 py-0.5 rounded bg-neon-cyan/10 text-neon-cyan border border-neon-cyan/20">{x}</span>)}
                  </div>
                </div>
              ))}
            </div>
            <div className={ds.panel}>
              <h5 className="text-xs font-semibold text-gray-300 mb-2">Unique contributions</h5>
              {Object.entries(result.uniqueContributions).map(([name, uc]) => (
                <div key={name} className="mb-1.5">
                  <span className="text-[10px] uppercase tracking-wider text-gray-500">{name}</span>
                  <div className="flex flex-wrap gap-1 mt-0.5">
                    {[...uc.capabilities, ...uc.resources].length === 0
                      ? <span className="text-[11px] text-gray-500">nothing unique</span>
                      : [...uc.capabilities, ...uc.resources].map((x, i) => <span key={`${x}-${i}`} className="text-[10px] px-1.5 py-0.5 rounded bg-amber-400/10 text-amber-300 border border-amber-400/20">{x}</span>)}
                  </div>
                </div>
              ))}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

// ── Network Analysis ─────────────────────────────────────────────────

interface NodeRow { id: string; name: string }
interface EdgeRow { source: string; target: string }
interface NetworkResult {
  nodeCount: number; edgeCount: number; density: number; connectedComponents: number;
  globalClusteringCoefficient: number;
  brokers: { id: string; name: string; betweenness: number; clustering: number; degree: number; brokerageScore: number }[];
  topByDegree: { id: string; name: string; degree: number }[];
  topByBetweenness: { id: string; name: string; betweenness: number }[];
}

function NetworkTool() {
  const [nodes, setNodes] = useState<NodeRow[]>([]);
  const [edges, setEdges] = useState<EdgeRow[]>([]);
  const [nodeId, setNodeId] = useState('');
  const [nodeName, setNodeName] = useState('');
  const [edgeSrc, setEdgeSrc] = useState('');
  const [edgeDst, setEdgeDst] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<NetworkResult | null>(null);

  const addNode = () => {
    if (!nodeId.trim()) return;
    if (nodes.some((n) => n.id === nodeId.trim())) { setError('Node id already added.'); return; }
    setNodes((p) => [...p, { id: nodeId.trim(), name: nodeName.trim() || nodeId.trim() }]);
    setNodeId(''); setNodeName(''); setError(null);
  };
  const addEdge = () => {
    if (!edgeSrc || !edgeDst || edgeSrc === edgeDst) return;
    setEdges((p) => [...p, { source: edgeSrc, target: edgeDst }]);
  };

  const run = async () => {
    if (nodes.length === 0) { setError('Add at least one node.'); return; }
    setBusy(true); setError(null);
    const r = await runAllianceMacro<NetworkResult>('networkAnalysis', { nodes, edges });
    setBusy(false);
    if (r.ok === false) { setError(r.error || r.message || 'Network analysis failed.'); return; }
    setResult(r.result || null);
  };

  const brokerCols: DataTableColumn<NetworkResult['brokers'][number]>[] = [
    { id: 'name', header: 'Node', accessor: (r) => r.name },
    { id: 'brokerageScore', header: 'Brokerage', accessor: (r) => r.brokerageScore, sortable: true, monospace: true, align: 'right' },
    { id: 'betweenness', header: 'Betweenness', accessor: (r) => r.betweenness, sortable: true, monospace: true, align: 'right' },
    { id: 'clustering', header: 'Clustering', accessor: (r) => r.clustering, sortable: true, monospace: true, align: 'right' },
    { id: 'degree', header: 'Degree', accessor: (r) => r.degree, sortable: true, monospace: true, align: 'right' },
  ];

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
        <div className={ds.panel + ' space-y-2'}>
          <h4 className="font-semibold text-sm flex items-center justify-between">Nodes <span className="text-xs text-gray-400 font-normal">{nodes.length}</span></h4>
          <div className="flex gap-1.5">
            <input value={nodeId} onChange={(e) => setNodeId(e.target.value)} placeholder="id" className={cn(ds.input, 'text-xs flex-1')} />
            <input value={nodeName} onChange={(e) => setNodeName(e.target.value)} placeholder="display name" className={cn(ds.input, 'text-xs flex-1')} />
            <button type="button" onClick={addNode} className={cn(ds.btnSecondary, 'px-2 py-1')} aria-label="Add node"><Plus className="w-3.5 h-3.5" /></button>
          </div>
          <div className="flex flex-wrap gap-1">
            {nodes.map((n) => (
              <span key={n.id} className="inline-flex items-center gap-1 text-[11px] px-1.5 py-0.5 rounded bg-neon-purple/10 text-neon-purple border border-neon-purple/20">
                {n.name}
                <button type="button" onClick={() => setNodes((p) => p.filter((x) => x.id !== n.id))} aria-label={`Remove ${n.name}`}><X className="w-3 h-3" /></button>
              </span>
            ))}
          </div>
        </div>
        <div className={ds.panel + ' space-y-2'}>
          <h4 className="font-semibold text-sm flex items-center justify-between">Edges <span className="text-xs text-gray-400 font-normal">{edges.length}</span></h4>
          <div className="flex gap-1.5">
            <select value={edgeSrc} onChange={(e) => setEdgeSrc(e.target.value)} className={cn(ds.select, 'text-xs flex-1')}>
              <option value="">from…</option>
              {nodes.map((n) => <option key={n.id} value={n.id}>{n.name}</option>)}
            </select>
            <select value={edgeDst} onChange={(e) => setEdgeDst(e.target.value)} className={cn(ds.select, 'text-xs flex-1')}>
              <option value="">to…</option>
              {nodes.map((n) => <option key={n.id} value={n.id}>{n.name}</option>)}
            </select>
            <button type="button" onClick={addEdge} disabled={!edgeSrc || !edgeDst} className={cn(ds.btnSecondary, 'px-2 py-1 disabled:opacity-50')} aria-label="Add edge"><Plus className="w-3.5 h-3.5" /></button>
          </div>
          <div className="flex flex-wrap gap-1">
            {edges.map((e, i) => (
              <span key={`${e.source}-${e.target}-${i}`} className="inline-flex items-center gap-1 text-[11px] px-1.5 py-0.5 rounded bg-neon-cyan/10 text-neon-cyan border border-neon-cyan/20">
                {nodes.find((n) => n.id === e.source)?.name || e.source} → {nodes.find((n) => n.id === e.target)?.name || e.target}
                <button type="button" onClick={() => setEdges((p) => p.filter((_, ix) => ix !== i))} aria-label="Remove edge"><X className="w-3 h-3" /></button>
              </span>
            ))}
          </div>
        </div>
      </div>

      {error && <p className="text-xs text-red-400 flex items-center gap-1.5"><AlertTriangle className="w-3.5 h-3.5" /> {error}</p>}

      <button type="button" onClick={run} disabled={busy} className={cn(ds.btnPrimary, 'text-sm inline-flex items-center gap-2')}>
        {busy ? <Loader2 className="w-4 h-4 animate-spin" /> : <Play className="w-4 h-4" />}
        Analyze network
      </button>

      {result && (
        <div className="space-y-3">
          <div className="grid grid-cols-2 md:grid-cols-4 gap-2">
            <div className="rounded-md border border-white/10 bg-black/30 p-2.5"><div className="text-[10px] uppercase tracking-wider text-gray-400">Density</div><div className="font-mono text-lg text-white">{result.density}</div></div>
            <div className="rounded-md border border-white/10 bg-black/30 p-2.5"><div className="text-[10px] uppercase tracking-wider text-gray-400">Components</div><div className="font-mono text-lg text-white">{result.connectedComponents}</div></div>
            <div className="rounded-md border border-white/10 bg-black/30 p-2.5"><div className="text-[10px] uppercase tracking-wider text-gray-400">Clustering</div><div className="font-mono text-lg text-white">{result.globalClusteringCoefficient}</div></div>
            <div className="rounded-md border border-white/10 bg-black/30 p-2.5"><div className="text-[10px] uppercase tracking-wider text-gray-400">Edges</div><div className="font-mono text-lg text-white">{result.edgeCount}</div></div>
          </div>
          <div>
            <h5 className="text-xs font-semibold text-gray-300 mb-1.5">Structural-hole brokers (high betweenness, low clustering)</h5>
            <DataTable columns={brokerCols} rows={result.brokers} getRowId={(r) => r.id} density="compact" emptyState="No brokers identified." />
          </div>
        </div>
      )}
    </div>
  );
}

// ── Risk Assessment ──────────────────────────────────────────────────

interface AllianceRow { partnerId: string; partnerName: string; dependencyPct: string; categories: string; revenue: string; critical: boolean }
interface RiskResult {
  overallRiskScore: number; riskLevel: string; hhi: number; hhiClassification: string; diversificationIndex: number;
  concentrationRisks: { partnerName: string; dependencyPct: number; isConcentrated: boolean }[];
  singlePointsOfFailure: { category: string; partnerName: string; isCritical: boolean }[];
  summary: { concentratedPartners: number; singleSourceCategories: number; criticalSPOF: number; totalCategories: number };
}

const RISK_COLOR: Record<string, string> = {
  low: 'text-emerald-300 bg-emerald-500/10 border-emerald-500/30',
  moderate: 'text-amber-300 bg-amber-500/10 border-amber-500/30',
  high: 'text-orange-300 bg-orange-500/10 border-orange-500/30',
  critical: 'text-rose-300 bg-rose-500/10 border-rose-500/30',
};

function RiskTool() {
  const [rows, setRows] = useState<AllianceRow[]>([]);
  const [draft, setDraft] = useState<AllianceRow>({ partnerId: '', partnerName: '', dependencyPct: '', categories: '', revenue: '', critical: false });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<RiskResult | null>(null);

  const addRow = () => {
    if (!draft.partnerName.trim() || !draft.dependencyPct.trim()) { setError('Partner name and dependency % are required.'); return; }
    setRows((p) => [...p, { ...draft, partnerId: draft.partnerId || `partner_${p.length + 1}` }]);
    setDraft({ partnerId: '', partnerName: '', dependencyPct: '', categories: '', revenue: '', critical: false });
    setError(null);
  };

  const run = async () => {
    if (rows.length === 0) { setError('Add at least one alliance dependency.'); return; }
    setBusy(true); setError(null);
    const r = await runAllianceMacro<RiskResult>('riskAssessment', {
      alliances: rows.map((row) => ({
        partnerId: row.partnerId, partnerName: row.partnerName,
        dependencyPct: Number(row.dependencyPct) || 0,
        categories: csv(row.categories),
        revenue: row.revenue ? Number(row.revenue) : undefined,
        critical: row.critical,
      })),
    });
    setBusy(false);
    if (r.ok === false) { setError(r.error || r.message || 'Risk assessment failed.'); return; }
    setResult(r.result || null);
  };

  const concCols: DataTableColumn<RiskResult['concentrationRisks'][number]>[] = [
    { id: 'partnerName', header: 'Partner', accessor: (r) => r.partnerName },
    { id: 'dependencyPct', header: 'Dependency %', accessor: (r) => `${r.dependencyPct}%`, sortValue: (r) => r.dependencyPct, sortable: true, align: 'right', monospace: true },
    { id: 'isConcentrated', header: 'Concentrated', accessor: (r) => r.isConcentrated ? <span className="text-amber-300">yes</span> : <span className="text-gray-500">no</span> },
  ];

  return (
    <div className="space-y-4">
      <div className={ds.panel + ' space-y-2'}>
        <h4 className="font-semibold text-sm">Add alliance dependency</h4>
        <div className="grid grid-cols-2 md:grid-cols-5 gap-2">
          <input value={draft.partnerName} onChange={(e) => setDraft((p) => ({ ...p, partnerName: e.target.value }))} placeholder="Partner name *" className={cn(ds.input, 'text-xs')} />
          <input value={draft.dependencyPct} onChange={(e) => setDraft((p) => ({ ...p, dependencyPct: e.target.value }))} placeholder="Dependency % *" type="number" className={cn(ds.input, 'text-xs')} />
          <input value={draft.categories} onChange={(e) => setDraft((p) => ({ ...p, categories: e.target.value }))} placeholder="Categories (csv)" className={cn(ds.input, 'text-xs')} />
          <input value={draft.revenue} onChange={(e) => setDraft((p) => ({ ...p, revenue: e.target.value }))} placeholder="Revenue (optional)" type="number" className={cn(ds.input, 'text-xs')} />
          <label className="flex items-center gap-1.5 text-xs text-gray-300">
            <input type="checkbox" checked={draft.critical} onChange={(e) => setDraft((p) => ({ ...p, critical: e.target.checked }))} />
            Critical
          </label>
        </div>
        <button type="button" onClick={addRow} className={cn(ds.btnSecondary, 'text-xs inline-flex items-center gap-1.5')}>
          <Plus className="w-3.5 h-3.5" /> Add
        </button>
        {rows.length > 0 && (
          <div className="flex flex-wrap gap-1 pt-1">
            {rows.map((r, i) => (
              <span key={`${r.partnerId}-${i}`} className="inline-flex items-center gap-1 text-[11px] px-1.5 py-0.5 rounded bg-white/5 text-gray-300 border border-white/10">
                {r.partnerName} ({r.dependencyPct}%)
                <button type="button" onClick={() => setRows((p) => p.filter((_, ix) => ix !== i))} aria-label={`Remove ${r.partnerName}`}><X className="w-3 h-3" /></button>
              </span>
            ))}
          </div>
        )}
      </div>

      {error && <p className="text-xs text-red-400 flex items-center gap-1.5"><AlertTriangle className="w-3.5 h-3.5" /> {error}</p>}

      <button type="button" onClick={run} disabled={busy} className={cn(ds.btnPrimary, 'text-sm inline-flex items-center gap-2')}>
        {busy ? <Loader2 className="w-4 h-4 animate-spin" /> : <Play className="w-4 h-4" />}
        Assess risk
      </button>

      {result && (
        <div className="space-y-3">
          <div className="flex items-center gap-3 flex-wrap">
            <ScoreGauge value={result.overallRiskScore} label="Overall risk" />
            <span className={cn('text-xs px-2.5 py-1 rounded-full border font-medium capitalize', RISK_COLOR[result.riskLevel])}>{result.riskLevel}</span>
            <span className="text-xs text-gray-400">HHI {result.hhi} · {result.hhiClassification.replace(/-/g, ' ')}</span>
            <span className="text-xs text-gray-400">Diversification {result.diversificationIndex}</span>
          </div>
          <div>
            <h5 className="text-xs font-semibold text-gray-300 mb-1.5">Dependency concentration</h5>
            <DataTable columns={concCols} rows={result.concentrationRisks} getRowId={(r) => r.partnerName} density="compact" emptyState="No concentration data." />
          </div>
          {result.singlePointsOfFailure.length > 0 && (
            <div className={ds.panel}>
              <h5 className="text-xs font-semibold text-gray-300 mb-2 flex items-center gap-1.5"><ShieldAlert className="w-3.5 h-3.5 text-amber-400" /> Single points of failure</h5>
              <div className="space-y-1">
                {result.singlePointsOfFailure.map((s, i) => (
                  <div key={`${s.category}-${i}`} className="text-xs text-gray-300 flex items-center gap-2">
                    <span className="text-gray-500">{s.category}:</span> {s.partnerName}
                    {s.isCritical && <span className="text-[10px] px-1.5 py-0.5 rounded bg-rose-500/15 text-rose-300 border border-rose-500/30">critical</span>}
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

// ── Container ─────────────────────────────────────────────────────────

type SubTool = 'compat' | 'network' | 'risk';
const TOOLS: { id: SubTool; label: string; icon: typeof HeartHandshake; desc: string }[] = [
  { id: 'compat', label: 'Compatibility', icon: HeartHandshake, desc: 'Jaccard-weighted partner fit score' },
  { id: 'network', label: 'Network', icon: Network, desc: 'Brokerage, density, structural holes' },
  { id: 'risk', label: 'Risk', icon: ShieldAlert, desc: 'HHI concentration + single points of failure' },
];

export function AllianceAnalyticsPanel() {
  const [tool, setTool] = useState<SubTool>('compat');
  return (
    <div className="space-y-4">
      <div className="flex gap-1 flex-wrap bg-lattice-void border border-lattice-border rounded-lg p-1">
        {TOOLS.map((t) => (
          <button
            key={t.id}
            type="button"
            onClick={() => setTool(t.id)}
            className={cn(
              'flex items-center gap-1.5 px-3 py-1.5 rounded-md text-xs font-medium transition-all',
              tool === t.id ? 'bg-neon-purple/20 text-neon-purple border border-neon-purple/30' : 'text-gray-400 hover:text-white hover:bg-lattice-surface'
            )}
            title={t.desc}
          >
            <t.icon className="w-3.5 h-3.5" />
            {t.label}
          </button>
        ))}
      </div>
      {tool === 'compat' && <CompatibilityTool />}
      {tool === 'network' && <NetworkTool />}
      {tool === 'risk' && <RiskTool />}
    </div>
  );
}
