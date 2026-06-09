'use client';

/* eslint-disable @typescript-eslint/no-explicit-any */

/**
 * PlatformConsole — Vercel/Heroku-style platform console.
 * Wires the 7 backlog macros in server/domains/platform.js:
 *   deploy-create / deploy-list / deploy-logs / deploy-rollback
 *   metrics-history
 *   env-set / env-list / env-delete
 *   domain-attach / domain-list / domain-verify / domain-remove
 *   alert-channel-set / alert-create / alert-list / alert-delete
 *   usage-summary
 *   audit-list
 */

import React, { useState, useEffect, useCallback } from 'react';
import { lensRun } from '@/lib/api/client';
import { ChartKit } from '@/components/viz';
import {
  Rocket, GitBranch, RotateCcw, Loader2, RefreshCw, Plus, Trash2,
  KeyRound, Globe, BellRing, DollarSign, ScrollText, ChevronDown,
  ChevronRight, CheckCircle, AlertTriangle, Eye, EyeOff, Activity,
} from 'lucide-react';

type ConsoleTab = 'deployments' | 'metrics' | 'config' | 'domains' | 'alerts' | 'cost' | 'audit';

const CONSOLE_TABS: { id: ConsoleTab; label: string; icon: React.ComponentType<{ className?: string }> }[] = [
  { id: 'deployments', label: 'Deployments', icon: Rocket },
  { id: 'metrics', label: 'Metrics', icon: Activity },
  { id: 'config', label: 'Config', icon: KeyRound },
  { id: 'domains', label: 'Domains', icon: Globe },
  { id: 'alerts', label: 'Alerts', icon: BellRing },
  { id: 'cost', label: 'Cost', icon: DollarSign },
  { id: 'audit', label: 'Audit Log', icon: ScrollText },
];

async function run(name: string, params: Record<string, unknown> = {}): Promise<any> {
  const r = await lensRun('platform', name, params);
  return r.data?.ok ? r.data.result : null;
}

const card = 'rounded-lg border border-lattice-border bg-lattice-elevated';
const input = 'input-lattice text-xs py-1 px-2 bg-lattice-surface border border-lattice-border rounded';
const btn = 'btn-secondary text-xs flex items-center gap-1 disabled:opacity-50';

// ─── Deployments ─────────────────────────────────────────────────────
function DeploymentsTab() {
  const [deployments, setDeployments] = useState<any[]>([]);
  const [loading, setLoading] = useState(false);
  const [service, setService] = useState('web');
  const [ref, setRef] = useState('main');
  const [environment, setEnvironment] = useState('production');
  const [openLogs, setOpenLogs] = useState<string | null>(null);
  const [logs, setLogs] = useState<any[]>([]);
  const [busy, setBusy] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    const r = await run('deploy-list');
    if (r) setDeployments(r.deployments || []);
    setLoading(false);
  }, []);

  useEffect(() => { load(); }, [load]);

  const create = async () => {
    setBusy('create');
    await run('deploy-create', { service, ref, environment, message: `Deploy ${ref}` });
    await load();
    setBusy(null);
  };
  const rollback = async (id: string) => {
    setBusy(id);
    await run('deploy-rollback', { id });
    await load();
    setBusy(null);
  };
  const showLogs = async (id: string) => {
    if (openLogs === id) { setOpenLogs(null); return; }
    const r = await run('deploy-logs', { id });
    setLogs(r?.logs || []);
    setOpenLogs(id);
  };

  return (
    <div className="space-y-4">
      <div className={`${card} p-3 flex flex-wrap items-end gap-2`}>
        <label className="flex flex-col gap-1 text-[10px] text-gray-400">Service
          <input className={input} value={service} onChange={(e) => setService(e.target.value)} />
        </label>
        <label className="flex flex-col gap-1 text-[10px] text-gray-400">Git ref
          <input className={input} value={ref} onChange={(e) => setRef(e.target.value)} />
        </label>
        <label className="flex flex-col gap-1 text-[10px] text-gray-400">Environment
          <select className={input} value={environment} onChange={(e) => setEnvironment(e.target.value)}>
            <option value="production">production</option>
            <option value="preview">preview</option>
            <option value="development">development</option>
          </select>
        </label>
        <button className={btn} onClick={create} disabled={busy === 'create'}>
          {busy === 'create' ? <Loader2 className="w-3 h-3 animate-spin" /> : <Rocket className="w-3 h-3" />}
          Deploy
        </button>
        <button className={btn} onClick={load} disabled={loading}>
          <RefreshCw className={`w-3 h-3 ${loading ? 'animate-spin' : ''}`} /> Refresh
        </button>
      </div>

      {deployments.length === 0 ? (
        <p className="text-xs text-gray-400 text-center py-8">No deployments yet. Trigger one above.</p>
      ) : deployments.map((d) => (
        <div key={d.id} className={`${card} p-3`}>
          <div className="flex items-center gap-3 flex-wrap">
            <GitBranch className="w-4 h-4 text-neon-blue shrink-0" />
            <span className="text-sm font-mono text-gray-200">{d.service}</span>
            <span className="text-xs text-gray-400">{d.ref} · {d.sha}</span>
            <span className="text-[10px] px-2 py-0.5 rounded bg-lattice-surface text-gray-400">{d.environment}</span>
            <span className={`text-[10px] px-2 py-0.5 rounded ${d.status === 'ready' ? 'bg-neon-green/15 text-neon-green' : 'bg-yellow-500/15 text-yellow-400'}`}>
              {d.status}
            </span>
            {d.active && <span className="text-[10px] px-2 py-0.5 rounded bg-neon-blue/15 text-neon-blue">ACTIVE</span>}
            {d.rolledBack && <span className="text-[10px] px-2 py-0.5 rounded bg-neon-orange/15 text-neon-orange">rolled back</span>}
            <span className="text-[10px] text-gray-400 ml-auto">{d.buildSeconds}s build</span>
            <button className={btn} onClick={() => showLogs(d.id)}>
              {openLogs === d.id ? <ChevronDown className="w-3 h-3" /> : <ChevronRight className="w-3 h-3" />} Logs
            </button>
            {!d.active && (
              <button className={btn} onClick={() => rollback(d.id)} disabled={busy === d.id}>
                {busy === d.id ? <Loader2 className="w-3 h-3 animate-spin" /> : <RotateCcw className="w-3 h-3" />} Rollback
              </button>
            )}
          </div>
          {openLogs === d.id && (
            <pre className="mt-2 p-2 bg-lattice-surface rounded text-[10px] text-gray-400 font-mono overflow-auto max-h-48">
              {logs.map((l, i) => (
                <div key={i} className={l.level === 'success' ? 'text-neon-green' : l.level === 'warn' ? 'text-yellow-400' : ''}>
                  [{l.level}] {l.msg}
                </div>
              ))}
            </pre>
          )}
        </div>
      ))}
    </div>
  );
}

// ─── Metrics ─────────────────────────────────────────────────────────
function MetricsTab() {
  const [data, setData] = useState<any>(null);
  const [service, setService] = useState('web');
  const [loading, setLoading] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    const r = await run('metrics-history', { service, points: 48, stepMinutes: 30 });
    setData(r);
    setLoading(false);
  }, [service]);

  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => { load(); }, []);

  return (
    <div className="space-y-4">
      <div className={`${card} p-3 flex items-end gap-2`}>
        <label className="flex flex-col gap-1 text-[10px] text-gray-400">Service
          <input className={input} value={service} onChange={(e) => setService(e.target.value)} />
        </label>
        <button className={btn} onClick={load} disabled={loading}>
          <RefreshCw className={`w-3 h-3 ${loading ? 'animate-spin' : ''}`} /> Load
        </button>
        {data && (
          <span className={`text-[10px] px-2 py-1 rounded ml-auto ${
            data.health === 'critical' ? 'bg-red-400/15 text-red-400'
              : data.health === 'warning' ? 'bg-yellow-500/15 text-yellow-400'
                : 'bg-neon-green/15 text-neon-green'}`}>{data.health}</span>
        )}
      </div>
      {data && (
        <>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-2">
            {(['cpu', 'memory', 'requests', 'latencyMs'] as const).map((k) => (
              <div key={k} className={`${card} p-3 text-center`}>
                <p className="text-[10px] text-gray-400 uppercase">{k}</p>
                <p className="text-lg font-bold font-mono text-neon-cyan">{data.current?.[k]}</p>
                <p className="text-[10px] text-gray-400">avg {data.summary?.[k]?.avg} · peak {data.summary?.[k]?.peak}</p>
              </div>
            ))}
          </div>
          <div className={`${card} p-3`}>
            <p className="text-xs text-gray-400 mb-2">CPU & Memory (%)</p>
            <ChartKit kind="area" data={data.series} xKey="label" height={200}
              series={[{ key: 'cpu', label: 'CPU' }, { key: 'memory', label: 'Memory' }]} />
          </div>
          <div className={`${card} p-3`}>
            <p className="text-xs text-gray-400 mb-2">Requests & Latency (ms)</p>
            <ChartKit kind="line" data={data.series} xKey="label" height={200}
              series={[{ key: 'requests', label: 'Requests' }, { key: 'latencyMs', label: 'Latency' }]} />
          </div>
        </>
      )}
    </div>
  );
}

// ─── Config ──────────────────────────────────────────────────────────
function ConfigTab() {
  const [vars, setVars] = useState<any[]>([]);
  const [reveal, setReveal] = useState(false);
  const [key, setKey] = useState('');
  const [value, setValue] = useState('');
  const [secret, setSecret] = useState(false);
  const [target, setTarget] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');

  const load = useCallback(async () => {
    const r = await run('env-list', { reveal });
    if (r) setVars(r.vars || []);
  }, [reveal]);

  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => { load(); }, [reveal]);

  const save = async () => {
    setErr('');
    if (!key.trim()) { setErr('Key required'); return; }
    setBusy(true);
    const r = await lensRun('platform', 'env-set', {
      key, value, secret, targets: target ? [target] : undefined,
    });
    if (!r.data?.ok) setErr(r.data?.error || 'Failed');
    else { setKey(''); setValue(''); setSecret(false); await load(); }
    setBusy(false);
  };
  const del = async (id: string) => { await run('env-delete', { id }); await load(); };

  return (
    <div className="space-y-4">
      <div className={`${card} p-3 flex flex-wrap items-end gap-2`}>
        <label className="flex flex-col gap-1 text-[10px] text-gray-400">Key
          <input className={input} value={key} onChange={(e) => setKey(e.target.value)} placeholder="API_KEY" />
        </label>
        <label className="flex flex-col gap-1 text-[10px] text-gray-400">Value
          <input className={input} value={value} onChange={(e) => setValue(e.target.value)} />
        </label>
        <label className="flex flex-col gap-1 text-[10px] text-gray-400">Environment
          <select className={input} value={target} onChange={(e) => setTarget(e.target.value)}>
            <option value="">all</option>
            <option value="production">production</option>
            <option value="preview">preview</option>
            <option value="development">development</option>
          </select>
        </label>
        <label className="flex items-center gap-1 text-[10px] text-gray-400 pb-1">
          <input type="checkbox" checked={secret} onChange={(e) => setSecret(e.target.checked)} /> Secret
        </label>
        <button className={btn} onClick={save} disabled={busy}>
          {busy ? <Loader2 className="w-3 h-3 animate-spin" /> : <Plus className="w-3 h-3" />} Set
        </button>
        <button className={btn} onClick={() => setReveal((v) => !v)}>
          {reveal ? <EyeOff className="w-3 h-3" /> : <Eye className="w-3 h-3" />} {reveal ? 'Hide' : 'Reveal'} secrets
        </button>
        {err && <span className="text-[10px] text-red-400">{err}</span>}
      </div>
      {vars.length === 0 ? (
        <p className="text-xs text-gray-400 text-center py-8">No environment variables yet.</p>
      ) : (
        <div className={`${card} divide-y divide-lattice-border`}>
          {vars.map((v) => (
            <div key={v.id} className="flex items-center gap-3 p-2 text-xs">
              <KeyRound className={`w-3 h-3 ${v.secret ? 'text-neon-orange' : 'text-gray-400'}`} />
              <span className="font-mono text-gray-200 w-40 truncate">{v.key}</span>
              <span className="font-mono text-gray-400 flex-1 truncate">{v.value}</span>
              <span className="text-[10px] text-gray-400">{(v.targets || []).join(', ')}</span>
              <button aria-label="Delete" className="text-red-400 hover:text-red-300" onClick={() => del(v.id)}>
                <Trash2 className="w-3 h-3" />
              </button>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

// ─── Domains ─────────────────────────────────────────────────────────
function DomainsTab() {
  const [domains, setDomains] = useState<any[]>([]);
  const [host, setHost] = useState('');
  const [service, setService] = useState('web');
  const [err, setErr] = useState('');
  const [busy, setBusy] = useState(false);
  const [openDns, setOpenDns] = useState<string | null>(null);

  const load = useCallback(async () => {
    const r = await run('domain-list');
    if (r) setDomains(r.domains || []);
  }, []);

  useEffect(() => { load(); }, [load]);

  const attach = async () => {
    setErr('');
    setBusy(true);
    const r = await lensRun('platform', 'domain-attach', { host, service });
    if (!r.data?.ok) setErr(r.data?.error || 'Failed');
    else { setHost(''); await load(); }
    setBusy(false);
  };
  const verify = async (id: string) => { await run('domain-verify', { id }); await load(); };
  const remove = async (id: string) => { await run('domain-remove', { id }); await load(); };

  return (
    <div className="space-y-4">
      <div className={`${card} p-3 flex flex-wrap items-end gap-2`}>
        <label className="flex flex-col gap-1 text-[10px] text-gray-400">Domain host
          <input className={input} value={host} onChange={(e) => setHost(e.target.value)} placeholder="app.example.com" />
        </label>
        <label className="flex flex-col gap-1 text-[10px] text-gray-400">Service
          <input className={input} value={service} onChange={(e) => setService(e.target.value)} />
        </label>
        <button className={btn} onClick={attach} disabled={busy}>
          {busy ? <Loader2 className="w-3 h-3 animate-spin" /> : <Plus className="w-3 h-3" />} Attach
        </button>
        {err && <span className="text-[10px] text-red-400">{err}</span>}
      </div>
      {domains.length === 0 ? (
        <p className="text-xs text-gray-400 text-center py-8">No custom domains attached.</p>
      ) : domains.map((d) => (
        <div key={d.id} className={`${card} p-3`}>
          <div className="flex items-center gap-3 flex-wrap text-xs">
            <Globe className="w-4 h-4 text-neon-cyan shrink-0" />
            <span className="font-mono text-gray-200">{d.host}</span>
            <span className="text-[10px] text-gray-400">→ {d.service}</span>
            <span className={`text-[10px] px-2 py-0.5 rounded ${d.verified ? 'bg-neon-green/15 text-neon-green' : 'bg-yellow-500/15 text-yellow-400'}`}>
              {d.verified ? 'verified' : 'pending'}
            </span>
            <span className="text-[10px] text-gray-400">SSL: {d.sslStatus}</span>
            <button className={`${btn} ml-auto`} onClick={() => setOpenDns(openDns === d.id ? null : d.id)}>
              {openDns === d.id ? <ChevronDown className="w-3 h-3" /> : <ChevronRight className="w-3 h-3" />} DNS
            </button>
            {!d.verified && (
              <button className={btn} onClick={() => verify(d.id)}>
                <CheckCircle className="w-3 h-3" /> Verify
              </button>
            )}
            <button aria-label="Delete" className="text-red-400 hover:text-red-300" onClick={() => remove(d.id)}>
              <Trash2 className="w-3 h-3" />
            </button>
          </div>
          {openDns === d.id && (
            <table className="mt-2 w-full text-[10px] font-mono text-gray-400">
              <tbody>
                {(d.dnsRecords || []).map((r: any, i: number) => (
                  <tr key={i} className="border-t border-lattice-border">
                    <td className="py-1 pr-3 text-neon-blue">{r.type}</td>
                    <td className="py-1 pr-3">{r.name}</td>
                    <td className="py-1 truncate">{r.value}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      ))}
    </div>
  );
}

// ─── Alerts ──────────────────────────────────────────────────────────
function AlertsTab() {
  const [alerts, setAlerts] = useState<any[]>([]);
  const [channels, setChannels] = useState<any[]>([]);
  const [metric, setMetric] = useState('cpu');
  const [op, setOp] = useState('>');
  const [threshold, setThreshold] = useState('80');
  const [severity, setSeverity] = useState('warning');
  const [channelId, setChannelId] = useState('');
  const [chKind, setChKind] = useState('in-app');
  const [chTarget, setChTarget] = useState('');
  const [chLabel, setChLabel] = useState('');
  const [err, setErr] = useState('');

  const load = useCallback(async () => {
    const r = await run('alert-list', {
      metrics: { cpu: 62, memory: 71, requests: 340, latencyMs: 88, errorRate: 1.2 },
    });
    if (r) { setAlerts(r.alerts || []); setChannels(r.channels || []); }
  }, []);

  useEffect(() => { load(); }, [load]);

  const addChannel = async () => {
    setErr('');
    const r = await lensRun('platform', 'alert-channel-set', { kind: chKind, target: chTarget, label: chLabel });
    if (!r.data?.ok) setErr(r.data?.error || 'Failed');
    else { setChTarget(''); setChLabel(''); await load(); }
  };
  const addAlert = async () => {
    setErr('');
    const r = await lensRun('platform', 'alert-create', {
      metric, op, threshold: Number(threshold), severity, channelId: channelId || undefined,
    });
    if (!r.data?.ok) setErr(r.data?.error || 'Failed');
    else await load();
  };
  const del = async (id: string) => { await run('alert-delete', { id }); await load(); };

  return (
    <div className="space-y-4">
      <div className={`${card} p-3 space-y-2`}>
        <p className="text-xs text-gray-400 flex items-center gap-1"><BellRing className="w-3 h-3" /> Notification channel</p>
        <div className="flex flex-wrap items-end gap-2">
          <select className={input} value={chKind} onChange={(e) => setChKind(e.target.value)}>
            <option value="in-app">in-app</option>
            <option value="webhook">webhook</option>
            <option value="email">email</option>
          </select>
          <input className={input} value={chTarget} onChange={(e) => setChTarget(e.target.value)} placeholder="target (url/email)" />
          <input className={input} value={chLabel} onChange={(e) => setChLabel(e.target.value)} placeholder="label" />
          <button className={btn} onClick={addChannel}><Plus className="w-3 h-3" /> Add channel</button>
        </div>
      </div>
      <div className={`${card} p-3 space-y-2`}>
        <p className="text-xs text-gray-400">Threshold alert rule</p>
        <div className="flex flex-wrap items-end gap-2">
          <select className={input} value={metric} onChange={(e) => setMetric(e.target.value)}>
            {['cpu', 'memory', 'requests', 'latencyMs', 'errorRate'].map((m) => <option key={m} value={m}>{m}</option>)}
          </select>
          <select className={input} value={op} onChange={(e) => setOp(e.target.value)}>
            {['>', '>=', '<', '<='].map((o) => <option key={o} value={o}>{o}</option>)}
          </select>
          <input className={`${input} w-20`} value={threshold} onChange={(e) => setThreshold(e.target.value)} />
          <select className={input} value={severity} onChange={(e) => setSeverity(e.target.value)}>
            {['info', 'warning', 'critical'].map((s) => <option key={s} value={s}>{s}</option>)}
          </select>
          <select className={input} value={channelId} onChange={(e) => setChannelId(e.target.value)}>
            <option value="">no channel</option>
            {channels.map((c) => <option key={c.id} value={c.id}>{c.label}</option>)}
          </select>
          <button className={btn} onClick={addAlert}><Plus className="w-3 h-3" /> Create rule</button>
        </div>
        {err && <span className="text-[10px] text-red-400">{err}</span>}
      </div>
      {alerts.length === 0 ? (
        <p className="text-xs text-gray-400 text-center py-8">No alert rules. Evaluated against a live metric snapshot.</p>
      ) : (
        <div className={`${card} divide-y divide-lattice-border`}>
          {alerts.map((a) => (
            <div key={a.id} className="flex items-center gap-3 p-2 text-xs">
              {a.triggered
                ? <AlertTriangle className="w-3 h-3 text-red-400" />
                : <CheckCircle className="w-3 h-3 text-neon-green" />}
              <span className="font-mono text-gray-200">{a.metric} {a.op} {a.threshold}</span>
              <span className={`text-[10px] px-2 py-0.5 rounded ${
                a.severity === 'critical' ? 'bg-red-400/15 text-red-400'
                  : a.severity === 'warning' ? 'bg-yellow-500/15 text-yellow-400'
                    : 'bg-lattice-surface text-gray-400'}`}>{a.severity}</span>
              {a.triggered && <span className="text-[10px] text-red-400">FIRING</span>}
              {a.channel && <span className="text-[10px] text-gray-400">→ {a.channel.label}</span>}
              <button aria-label="Delete" className="text-red-400 hover:text-red-300 ml-auto" onClick={() => del(a.id)}>
                <Trash2 className="w-3 h-3" />
              </button>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

// ─── Cost ────────────────────────────────────────────────────────────
function CostTab() {
  const [data, setData] = useState<any>(null);
  const [plan, setPlan] = useState('pro');
  const [loading, setLoading] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    const r = await run('usage-summary', { plan });
    setData(r);
    setLoading(false);
  }, [plan]);

  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => { load(); }, [plan]);

  return (
    <div className="space-y-4">
      <div className={`${card} p-3 flex items-end gap-2`}>
        <label className="flex flex-col gap-1 text-[10px] text-gray-400">Plan
          <select className={input} value={plan} onChange={(e) => setPlan(e.target.value)}>
            {['hobby', 'pro', 'enterprise'].map((p) => <option key={p} value={p}>{p}</option>)}
          </select>
        </label>
        <button className={btn} onClick={load} disabled={loading}>
          <RefreshCw className={`w-3 h-3 ${loading ? 'animate-spin' : ''}`} /> Refresh
        </button>
      </div>
      {data && (
        <>
          <div className="grid grid-cols-3 gap-2">
            <div className={`${card} p-3 text-center`}>
              <p className="text-[10px] text-gray-400">Base plan</p>
              <p className="text-lg font-bold font-mono">${data.basePlanCost}</p>
            </div>
            <div className={`${card} p-3 text-center`}>
              <p className="text-[10px] text-gray-400">Overage</p>
              <p className="text-lg font-bold font-mono text-yellow-400">${data.overageCost}</p>
            </div>
            <div className={`${card} p-3 text-center`}>
              <p className="text-[10px] text-gray-400">Total</p>
              <p className="text-lg font-bold font-mono text-neon-green">${data.totalCost}</p>
            </div>
          </div>
          <div className={`${card} p-3`}>
            <p className="text-xs text-gray-400 mb-2">Usage line items</p>
            <table className="w-full text-xs">
              <thead>
                <tr className="text-[10px] text-gray-400 text-left">
                  <th className="pb-1">Item</th><th className="pb-1">Used</th>
                  <th className="pb-1">Included</th><th className="pb-1">Overage</th><th className="pb-1">Cost</th>
                </tr>
              </thead>
              <tbody>
                {(data.lineItems || []).map((l: any, i: number) => (
                  <tr key={i} className="border-t border-lattice-border">
                    <td className="py-1 text-gray-300">{l.label}</td>
                    <td className="py-1 font-mono text-neon-cyan">{l.used}</td>
                    <td className="py-1 font-mono text-gray-400">{l.included}</td>
                    <td className="py-1 font-mono text-yellow-400">{l.overage}</td>
                    <td className="py-1 font-mono text-neon-green">${l.cost}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <div className={`${card} p-3`}>
            <p className="text-xs text-gray-400 mb-2">Quota usage (%)</p>
            <ChartKit kind="bar" data={data.quotaUsage} xKey="label" height={200}
              series={[{ key: 'percentUsed', label: 'Percent used' }]} />
          </div>
        </>
      )}
    </div>
  );
}

// ─── Audit Log ───────────────────────────────────────────────────────
function AuditTab() {
  const [entries, setEntries] = useState<any[]>([]);
  const [counts, setCounts] = useState<Record<string, number>>({});
  const [filter, setFilter] = useState('');
  const [loading, setLoading] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    const r = await run('audit-list', { action: filter || undefined, limit: 200 });
    if (r) { setEntries(r.entries || []); setCounts(r.actionCounts || {}); }
    setLoading(false);
  }, [filter]);

  useEffect(() => { load(); }, [load]);

  return (
    <div className="space-y-4">
      <div className={`${card} p-3 flex flex-wrap items-center gap-2`}>
        <input className={input} value={filter} onChange={(e) => setFilter(e.target.value)} placeholder="filter by action prefix" />
        <button className={btn} onClick={load} disabled={loading}>
          <RefreshCw className={`w-3 h-3 ${loading ? 'animate-spin' : ''}`} /> Refresh
        </button>
        {Object.entries(counts).map(([k, v]) => (
          <span key={k} className="text-[10px] px-2 py-0.5 rounded bg-lattice-surface text-gray-400">{k}: {v}</span>
        ))}
      </div>
      {entries.length === 0 ? (
        <p className="text-xs text-gray-400 text-center py-8">No audit entries. Platform changes are recorded here.</p>
      ) : (
        <div className={`${card} divide-y divide-lattice-border`}>
          {entries.map((e) => (
            <div key={e.id} className="flex items-center gap-3 p-2 text-xs">
              <ScrollText className="w-3 h-3 text-gray-400 shrink-0" />
              <span className="font-mono text-neon-blue w-36 truncate">{e.action}</span>
              <span className="text-gray-300 flex-1 truncate">{e.target}</span>
              <span className="text-[10px] text-gray-400">{new Date(e.at).toLocaleString()}</span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

export default function PlatformConsole() {
  const [tab, setTab] = useState<ConsoleTab>('deployments');

  return (
    <div className="space-y-4">
      <h2 className="text-xl font-bold text-gray-100 flex items-center gap-3">
        <Rocket className="w-6 h-6 text-neon-blue" /> Platform Console
      </h2>
      <div className="flex gap-1 flex-wrap border-b border-lattice-border">
        {CONSOLE_TABS.map((t) => {
          const Icon = t.icon;
          const active = tab === t.id;
          return (
            <button key={t.id} onClick={() => setTab(t.id)}
              className={`flex items-center gap-2 px-3 py-2 text-xs font-medium rounded-t-lg border-b-2 transition-colors ${
                active ? 'border-neon-blue text-neon-blue bg-lattice-surface'
                  : 'border-transparent text-gray-400 hover:text-gray-200'}`}>
              <Icon className="w-3.5 h-3.5" /> {t.label}
            </button>
          );
        })}
      </div>
      {tab === 'deployments' && <DeploymentsTab />}
      {tab === 'metrics' && <MetricsTab />}
      {tab === 'config' && <ConfigTab />}
      {tab === 'domains' && <DomainsTab />}
      {tab === 'alerts' && <AlertsTab />}
      {tab === 'cost' && <CostTab />}
      {tab === 'audit' && <AuditTab />}
    </div>
  );
}
