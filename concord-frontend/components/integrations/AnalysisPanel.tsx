'use client';

/* eslint-disable @typescript-eslint/no-explicit-any */
// Integration analysis workbench. Surfaces three real, deterministic engine
// macros that were previously dead-wired behind a never-populated artifact:
//   • apiHealthCheck   — latency percentiles, error rate, availability scoring
//   • dataFlowMapping  — flow graph, bottleneck detection, throughput paths
//   • compatibilityCheck — semver diff, breaking-change + migration-effort scoring
// Each tool has a bespoke structured editor (no raw JSON paste) and is called
// directly via lensRun so the virtual artifact's .data carries the input.

import { useState, useCallback } from 'react';
import { motion } from 'framer-motion';
import {
  Activity, GitBranch, GitCompare, Plus, Trash2, Play, Loader2, Sparkles,
  ArrowRight, CheckCircle, AlertTriangle,
} from 'lucide-react';
import { lensRun } from '@/lib/api/client';

type Tool = 'health' | 'flow' | 'compat';

const TOOLS: Array<{ id: Tool; label: string; icon: React.ReactNode; blurb: string }> = [
  { id: 'health', label: 'API Health', icon: <Activity className="w-3.5 h-3.5" />, blurb: 'Latency percentiles · error rate · availability' },
  { id: 'flow', label: 'Data Flow', icon: <GitBranch className="w-3.5 h-3.5" />, blurb: 'Flow graph · bottlenecks · throughput paths' },
  { id: 'compat', label: 'Compatibility', icon: <GitCompare className="w-3.5 h-3.5" />, blurb: 'Semver diff · breaking changes · migration effort' },
];

const statusTone = (s: string) =>
  s === 'healthy' ? 'text-neon-green' : s === 'degraded' ? 'text-yellow-400'
    : s === 'unhealthy' ? 'text-orange-400' : s === 'critical' ? 'text-red-400' : 'text-gray-400';

export function AnalysisPanel() {
  const [tool, setTool] = useState<Tool>('health');
  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-2">
        {TOOLS.map((t) => (
          <button
            key={t.id}
            onClick={() => setTool(t.id)}
            className={`flex items-center gap-1.5 text-xs px-3 py-1.5 rounded-lg border transition-colors ${
              tool === t.id
                ? 'bg-neon-cyan/15 text-neon-cyan border-neon-cyan/40'
                : 'bg-lattice-surface text-gray-400 border-transparent hover:text-white'
            }`}
          >
            {t.icon} {t.label}
          </button>
        ))}
        <span className="text-[11px] text-gray-500 ml-1">{TOOLS.find((t) => t.id === tool)?.blurb}</span>
      </div>
      {tool === 'health' && <HealthTool />}
      {tool === 'flow' && <FlowTool />}
      {tool === 'compat' && <CompatTool />}
    </div>
  );
}

// ───────────────────────────── API Health ─────────────────────────────

interface Sample { latencyMs: number; statusCode: number }
interface Endpoint { name: string; url: string; samples: Sample[] }

const EXAMPLE_ENDPOINTS: Endpoint[] = [
  {
    name: 'auth-service', url: 'https://api.internal/auth',
    samples: [
      { latencyMs: 42, statusCode: 200 }, { latencyMs: 51, statusCode: 200 },
      { latencyMs: 380, statusCode: 200 }, { latencyMs: 47, statusCode: 500 },
      { latencyMs: 39, statusCode: 200 },
    ],
  },
  {
    name: 'billing-gateway', url: 'https://api.internal/billing',
    samples: [
      { latencyMs: 120, statusCode: 200 }, { latencyMs: 890, statusCode: 503 },
      { latencyMs: 140, statusCode: 200 }, { latencyMs: 910, statusCode: 503 },
    ],
  },
];

function HealthTool() {
  const [endpoints, setEndpoints] = useState<Endpoint[]>([
    { name: 'my-api', url: '', samples: [{ latencyMs: 50, statusCode: 200 }] },
  ]);
  const [result, setResult] = useState<any>(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const patch = (i: number, p: Partial<Endpoint>) =>
    setEndpoints((es) => es.map((e, idx) => (idx === i ? { ...e, ...p } : e)));
  const patchSample = (ei: number, si: number, p: Partial<Sample>) =>
    setEndpoints((es) => es.map((e, idx) =>
      idx === ei ? { ...e, samples: e.samples.map((s, j) => (j === si ? { ...s, ...p } : s)) } : e));

  const run = useCallback(async () => {
    setBusy(true); setErr(null); setResult(null);
    const r = await lensRun('integrations', 'apiHealthCheck', { endpoints });
    if (r.data.ok === false) setErr(r.data.error || 'Analysis failed');
    else setResult(r.data.result);
    setBusy(false);
  }, [endpoints]);

  return (
    <div className="space-y-3">
      <ToolHeader
        count={endpoints.length} noun="endpoint"
        onAdd={() => setEndpoints((es) => [...es, { name: `endpoint-${es.length + 1}`, url: '', samples: [{ latencyMs: 50, statusCode: 200 }] }])}
        onExample={() => { setEndpoints(EXAMPLE_ENDPOINTS.map((e) => ({ ...e, samples: [...e.samples] }))); setResult(null); }}
      />
      <div className="space-y-2">
        {endpoints.map((ep, i) => (
          <div key={i} className="panel p-3 space-y-2">
            <div className="flex items-center gap-2">
              <input value={ep.name} onChange={(e) => patch(i, { name: e.target.value })} placeholder="name"
                className="w-40 px-2 py-1 bg-lattice-deep border border-lattice-border rounded text-xs font-mono" />
              <input value={ep.url} onChange={(e) => patch(i, { url: e.target.value })} placeholder="https://… (optional)"
                className="flex-1 px-2 py-1 bg-lattice-deep border border-lattice-border rounded text-xs font-mono" />
              {endpoints.length > 1 && (
                <button onClick={() => setEndpoints((es) => es.filter((_, idx) => idx !== i))}
                  aria-label="Remove endpoint" className="text-gray-500 hover:text-red-400"><Trash2 className="w-4 h-4" /></button>
              )}
            </div>
            <div className="pl-2 border-l border-lattice-border/60 space-y-1">
              <div className="text-[10px] uppercase tracking-wide text-gray-500">Samples (latency ms · status code)</div>
              {ep.samples.map((s, si) => (
                <div key={si} className="flex items-center gap-2">
                  <input type="number" value={s.latencyMs} onChange={(e) => patchSample(i, si, { latencyMs: Number(e.target.value) })}
                    className="w-24 px-2 py-1 bg-lattice-deep border border-lattice-border rounded text-xs" placeholder="ms" />
                  <input type="number" value={s.statusCode} onChange={(e) => patchSample(i, si, { statusCode: Number(e.target.value) })}
                    className="w-24 px-2 py-1 bg-lattice-deep border border-lattice-border rounded text-xs" placeholder="code" />
                  {ep.samples.length > 1 && (
                    <button onClick={() => patch(i, { samples: ep.samples.filter((_, j) => j !== si) })}
                      aria-label="Remove sample" className="text-gray-500 hover:text-red-400"><Trash2 className="w-3.5 h-3.5" /></button>
                  )}
                </div>
              ))}
              <button onClick={() => patch(i, { samples: [...ep.samples, { latencyMs: 50, statusCode: 200 }] })}
                className="text-[11px] text-neon-cyan hover:underline flex items-center gap-0.5"><Plus className="w-3 h-3" /> sample</button>
            </div>
          </div>
        ))}
      </div>
      <RunButton busy={busy} onRun={run} label="Analyze health" />
      {err && <ErrLine msg={err} />}
      {result && (
        <div className="bg-lattice-deep rounded-lg p-4 space-y-3 text-sm">
          {result.message ? <p className="text-gray-400">{result.message}</p> : (
            <>
              <div className="flex items-center gap-2">
                <CheckCircle className={`w-4 h-4 ${statusTone(result.overallStatus)}`} />
                <span className="font-semibold">Overall: <span className={statusTone(result.overallStatus)}>{result.overallStatus}</span></span>
                <span className="text-gray-400">score {result.overallHealthScore}</span>
              </div>
              {result.summary && (
                <div className="grid grid-cols-5 gap-2 text-xs">
                  {Object.entries(result.summary as Record<string, unknown>).map(([k, v]) => (
                    <div key={k} className="bg-lattice-surface rounded p-2 text-center">
                      <div className="font-bold">{String(v)}</div>
                      <div className="text-gray-500 capitalize">{k}</div>
                    </div>
                  ))}
                </div>
              )}
              <div className="space-y-1">
                {(result.endpoints as any[]).map((ep, i) => (
                  <div key={i} className="bg-lattice-surface rounded p-2 text-xs space-y-1">
                    <div className="flex items-center justify-between">
                      <span className="font-mono">{ep.name}</span>
                      <span className={statusTone(ep.status)}>{ep.status}</span>
                      <span className="text-gray-400">score {ep.healthScore}</span>
                      <span className="text-gray-400">avail {ep.availability}%</span>
                      <span className="text-gray-400">err {ep.errorRate}%</span>
                    </div>
                    {ep.latency && (
                      <div className="text-[11px] text-gray-500 font-mono">
                        p50 {ep.latency.p50} · p95 {ep.latency.p95} · p99 {ep.latency.p99} · max {ep.latency.max}ms
                        {ep.throughputRps != null && ` · ${ep.throughputRps} rps`}
                      </div>
                    )}
                  </div>
                ))}
              </div>
            </>
          )}
        </div>
      )}
    </div>
  );
}

// ───────────────────────────── Data Flow ─────────────────────────────

interface Flow { source: string; target: string; throughputMbps: number; latencyMs: number; protocol: string }

const EXAMPLE_FLOWS: Flow[] = [
  { source: 'ingest', target: 'queue', throughputMbps: 500, latencyMs: 4, protocol: 'grpc' },
  { source: 'queue', target: 'processor', throughputMbps: 120, latencyMs: 20, protocol: 'amqp' },
  { source: 'processor', target: 'warehouse', throughputMbps: 400, latencyMs: 60, protocol: 'http' },
  { source: 'queue', target: 'cache', throughputMbps: 800, latencyMs: 2, protocol: 'redis' },
];

function FlowTool() {
  const [flows, setFlows] = useState<Flow[]>([
    { source: 'source', target: 'sink', throughputMbps: 100, latencyMs: 10, protocol: 'http' },
  ]);
  const [result, setResult] = useState<any>(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const patch = (i: number, p: Partial<Flow>) => setFlows((fs) => fs.map((f, idx) => (idx === i ? { ...f, ...p } : f)));

  const run = useCallback(async () => {
    setBusy(true); setErr(null); setResult(null);
    const r = await lensRun('integrations', 'dataFlowMapping', { flows });
    if (r.data.ok === false) setErr(r.data.error || 'Analysis failed');
    else setResult(r.data.result);
    setBusy(false);
  }, [flows]);

  return (
    <div className="space-y-3">
      <ToolHeader
        count={flows.length} noun="flow"
        onAdd={() => setFlows((fs) => [...fs, { source: '', target: '', throughputMbps: 100, latencyMs: 10, protocol: 'http' }])}
        onExample={() => { setFlows(EXAMPLE_FLOWS.map((f) => ({ ...f }))); setResult(null); }}
      />
      <div className="space-y-2">
        {flows.map((f, i) => (
          <div key={i} className="panel p-3 flex flex-wrap items-center gap-2">
            <input value={f.source} onChange={(e) => patch(i, { source: e.target.value })} placeholder="source"
              className="w-28 px-2 py-1 bg-lattice-deep border border-lattice-border rounded text-xs font-mono" />
            <ArrowRight className="w-3.5 h-3.5 text-gray-500" />
            <input value={f.target} onChange={(e) => patch(i, { target: e.target.value })} placeholder="target"
              className="w-28 px-2 py-1 bg-lattice-deep border border-lattice-border rounded text-xs font-mono" />
            <label className="text-[11px] text-gray-500 flex items-center gap-1">
              <input type="number" value={f.throughputMbps} onChange={(e) => patch(i, { throughputMbps: Number(e.target.value) })}
                className="w-20 px-2 py-1 bg-lattice-deep border border-lattice-border rounded text-xs" /> Mbps
            </label>
            <label className="text-[11px] text-gray-500 flex items-center gap-1">
              <input type="number" value={f.latencyMs} onChange={(e) => patch(i, { latencyMs: Number(e.target.value) })}
                className="w-16 px-2 py-1 bg-lattice-deep border border-lattice-border rounded text-xs" /> ms
            </label>
            <input value={f.protocol} onChange={(e) => patch(i, { protocol: e.target.value })} placeholder="protocol"
              className="w-24 px-2 py-1 bg-lattice-deep border border-lattice-border rounded text-xs font-mono" />
            {flows.length > 1 && (
              <button onClick={() => setFlows((fs) => fs.filter((_, idx) => idx !== i))}
                aria-label="Remove flow" className="text-gray-500 hover:text-red-400 ml-auto"><Trash2 className="w-4 h-4" /></button>
            )}
          </div>
        ))}
      </div>
      <RunButton busy={busy} onRun={run} label="Map flows" />
      {err && <ErrLine msg={err} />}
      {result && (
        <div className="bg-lattice-deep rounded-lg p-4 space-y-3 text-sm">
          {result.message ? <p className="text-gray-400">{result.message}</p> : (
            <>
              <div className="font-semibold text-neon-cyan">Flow analysis</div>
              {result.metrics && (
                <div className="grid grid-cols-3 md:grid-cols-4 gap-2 text-xs">
                  {Object.entries(result.metrics as Record<string, unknown>).map(([k, v]) => (
                    <div key={k} className="bg-lattice-surface rounded p-2">
                      <div className="text-gray-500 capitalize">{k.replace(/([A-Z])/g, ' $1').toLowerCase()}</div>
                      <div className="font-bold">{String(v)}</div>
                    </div>
                  ))}
                </div>
              )}
              {Array.isArray(result.bottlenecks) && result.bottlenecks.length > 0 && (
                <div>
                  <div className="text-xs text-yellow-400 font-semibold mb-1 flex items-center gap-1">
                    <AlertTriangle className="w-3.5 h-3.5" /> Bottlenecks
                  </div>
                  {(result.bottlenecks as any[]).map((b, i) => (
                    <div key={i} className="text-xs text-gray-300">{b.node} — ratio {b.bottleneckScore} (in {b.incomingThroughputMbps} / out {b.outgoingThroughputMbps} Mbps)</div>
                  ))}
                </div>
              )}
              {Array.isArray(result.paths) && result.paths.length > 0 && (
                <div className="space-y-1">
                  <div className="text-xs font-semibold text-gray-300">Throughput paths</div>
                  {(result.paths as any[]).slice(0, 6).map((p, i) => (
                    <div key={i} className="flex items-center justify-between bg-lattice-surface rounded p-2 text-xs">
                      <span className="font-mono text-gray-300">{p.path.join(' → ')}</span>
                      <span className="text-neon-green">{p.throughputCapacityMbps} Mbps</span>
                      <span className="text-gray-400">{p.totalLatencyMs}ms</span>
                    </div>
                  ))}
                </div>
              )}
            </>
          )}
        </div>
      )}
    </div>
  );
}

// ───────────────────────────── Compatibility ─────────────────────────────

interface ApiChange { type: 'added' | 'removed' | 'modified'; field: string; breaking: boolean }
interface ApiEntry { name: string; currentVersion: string; targetVersion: string; changes: ApiChange[] }

const EXAMPLE_APIS: ApiEntry[] = [
  {
    name: 'payments-api', currentVersion: '2.4.1', targetVersion: '3.0.0',
    changes: [
      { type: 'removed', field: 'legacyToken', breaking: true },
      { type: 'modified', field: 'amount', breaking: true },
      { type: 'added', field: 'idempotencyKey', breaking: false },
    ],
  },
  {
    name: 'notifications-api', currentVersion: '1.2.0', targetVersion: '1.3.0',
    changes: [{ type: 'added', field: 'channel', breaking: false }],
  },
];

function CompatTool() {
  const [apis, setApis] = useState<ApiEntry[]>([
    { name: 'my-api', currentVersion: '1.0.0', targetVersion: '2.0.0', changes: [] },
  ]);
  const [result, setResult] = useState<any>(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const patch = (i: number, p: Partial<ApiEntry>) => setApis((a) => a.map((x, idx) => (idx === i ? { ...x, ...p } : x)));
  const patchChange = (ai: number, ci: number, p: Partial<ApiChange>) =>
    setApis((a) => a.map((x, idx) => (idx === ai ? { ...x, changes: x.changes.map((c, j) => (j === ci ? { ...c, ...p } : c)) } : x)));

  const run = useCallback(async () => {
    setBusy(true); setErr(null); setResult(null);
    const r = await lensRun('integrations', 'compatibilityCheck', { apis });
    if (r.data.ok === false) setErr(r.data.error || 'Analysis failed');
    else setResult(r.data.result);
    setBusy(false);
  }, [apis]);

  return (
    <div className="space-y-3">
      <ToolHeader
        count={apis.length} noun="API"
        onAdd={() => setApis((a) => [...a, { name: `api-${a.length + 1}`, currentVersion: '1.0.0', targetVersion: '1.1.0', changes: [] }])}
        onExample={() => { setApis(EXAMPLE_APIS.map((a) => ({ ...a, changes: a.changes.map((c) => ({ ...c })) }))); setResult(null); }}
      />
      <div className="space-y-2">
        {apis.map((api, i) => (
          <div key={i} className="panel p-3 space-y-2">
            <div className="flex flex-wrap items-center gap-2">
              <input value={api.name} onChange={(e) => patch(i, { name: e.target.value })} placeholder="api name"
                className="w-40 px-2 py-1 bg-lattice-deep border border-lattice-border rounded text-xs font-mono" />
              <input value={api.currentVersion} onChange={(e) => patch(i, { currentVersion: e.target.value })} placeholder="1.0.0"
                className="w-24 px-2 py-1 bg-lattice-deep border border-lattice-border rounded text-xs font-mono" />
              <ArrowRight className="w-3.5 h-3.5 text-gray-500" />
              <input value={api.targetVersion} onChange={(e) => patch(i, { targetVersion: e.target.value })} placeholder="2.0.0"
                className="w-24 px-2 py-1 bg-lattice-deep border border-lattice-border rounded text-xs font-mono" />
              {apis.length > 1 && (
                <button onClick={() => setApis((a) => a.filter((_, idx) => idx !== i))}
                  aria-label="Remove API" className="text-gray-500 hover:text-red-400 ml-auto"><Trash2 className="w-4 h-4" /></button>
              )}
            </div>
            <div className="pl-2 border-l border-lattice-border/60 space-y-1">
              <div className="text-[10px] uppercase tracking-wide text-gray-500">Field changes (optional)</div>
              {api.changes.map((c, ci) => (
                <div key={ci} className="flex items-center gap-2">
                  <select value={c.type} onChange={(e) => patchChange(i, ci, { type: e.target.value as ApiChange['type'] })}
                    className="px-2 py-1 bg-lattice-deep border border-lattice-border rounded text-xs">
                    <option value="added">added</option>
                    <option value="removed">removed</option>
                    <option value="modified">modified</option>
                  </select>
                  <input value={c.field} onChange={(e) => patchChange(i, ci, { field: e.target.value })} placeholder="field"
                    className="w-36 px-2 py-1 bg-lattice-deep border border-lattice-border rounded text-xs font-mono" />
                  <label className="text-[11px] text-gray-400 flex items-center gap-1">
                    <input type="checkbox" checked={c.breaking} onChange={(e) => patchChange(i, ci, { breaking: e.target.checked })} /> breaking
                  </label>
                  <button onClick={() => patch(i, { changes: api.changes.filter((_, j) => j !== ci) })}
                    aria-label="Remove change" className="text-gray-500 hover:text-red-400"><Trash2 className="w-3.5 h-3.5" /></button>
                </div>
              ))}
              <button onClick={() => patch(i, { changes: [...api.changes, { type: 'added', field: '', breaking: false }] })}
                className="text-[11px] text-neon-cyan hover:underline flex items-center gap-0.5"><Plus className="w-3 h-3" /> change</button>
            </div>
          </div>
        ))}
      </div>
      <RunButton busy={busy} onRun={run} label="Check compatibility" />
      {err && <ErrLine msg={err} />}
      {result && (
        <div className="bg-lattice-deep rounded-lg p-4 space-y-3 text-sm">
          {result.message ? <p className="text-gray-400">{result.message}</p> : (
            <>
              <div className="font-semibold text-neon-cyan">Compatibility report</div>
              {result.summary && (
                <div className="text-xs text-gray-400">
                  {result.summary.totalApis} APIs · {result.summary.compatible} compatible · {result.summary.totalBreakingChanges} breaking · ~{result.summary.totalEstimatedHours}h migration
                </div>
              )}
              <div className="space-y-1">
                {(result.apis as any[]).map((api, i) => (
                  <div key={i} className="flex items-center justify-between bg-lattice-surface rounded p-2 text-xs">
                    <span className="font-mono">{api.name}</span>
                    <span className="text-gray-400">{api.currentVersion} → {api.targetVersion} <span className="text-gray-600">({api.versionJump})</span></span>
                    <span className={api.backwardCompatible ? 'text-neon-green' : 'text-red-400'}>{api.backwardCompatible ? 'compatible' : 'breaking'}</span>
                    <span className="text-gray-400">{api.migration.level} · {api.migration.estimatedHours}h</span>
                  </div>
                ))}
              </div>
            </>
          )}
        </div>
      )}
    </div>
  );
}

// ───────────────────────────── shared bits ─────────────────────────────

function ToolHeader({ count, noun, onAdd, onExample }: { count: number; noun: string; onAdd: () => void; onExample: () => void }) {
  return (
    <div className="flex items-center justify-between">
      <span className="text-xs text-gray-500">{count} {noun}{count !== 1 ? 's' : ''}</span>
      <div className="flex items-center gap-2">
        <button onClick={onExample} className="text-[11px] text-gray-400 hover:text-neon-cyan flex items-center gap-1">
          <Sparkles className="w-3 h-3" /> Load example
        </button>
        <button onClick={onAdd} className="btn-secondary text-xs flex items-center gap-1 px-2 py-1">
          <Plus className="w-3 h-3" /> Add {noun}
        </button>
      </div>
    </div>
  );
}

function RunButton({ busy, onRun, label }: { busy: boolean; onRun: () => void; label: string }) {
  return (
    <motion.button
      whileTap={{ scale: 0.97 }}
      onClick={onRun}
      disabled={busy}
      className="btn-primary text-sm flex items-center gap-1.5 disabled:opacity-50"
    >
      {busy ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Play className="w-3.5 h-3.5" />} {label}
    </motion.button>
  );
}

function ErrLine({ msg }: { msg: string }) {
  return <p className="text-xs text-red-400 bg-red-500/10 rounded px-3 py-1.5 flex items-center gap-1"><AlertTriangle className="w-3.5 h-3.5" /> {msg}</p>;
}
