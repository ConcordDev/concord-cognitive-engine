'use client';
/* eslint-disable @typescript-eslint/no-explicit-any */

/**
 * PipelinePanel — the Airbyte/Fivetran-style ELT surface for the Ingest lens.
 * Every value rendered comes from a real `ingest.*` macro: connector catalog,
 * connections, scheduled/incremental sync, field-mapping transforms, sync-run
 * logs with replay, dedup config, OCR ingestion, and the webhook push endpoint.
 */

import { useCallback, useEffect, useMemo, useState } from 'react';
import { lensRun } from '@/lib/api/client';
import { ChartKit } from '@/components/viz';
import {
  Plug, CalendarClock, Wand2, ScrollText, Filter, ScanLine, Webhook,
  Loader2, Plus, Trash2, RefreshCw, Play, CheckCircle2, AlertTriangle,
  Copy, ChevronRight,
} from 'lucide-react';

// ── Macro result shapes ──────────────────────────────────────────────
interface ConnectorField {
  key: string; label: string; type: string; required?: boolean;
  default?: unknown; options?: string[];
}
interface Connector {
  id: string; name: string; category: string; auth: string; icon: string;
  incremental: boolean; fieldCount: number; requiresOAuth: boolean;
  oauth: { provider: string; scopes: string[] } | null; fields: ConnectorField[];
}
interface Connection {
  id: string; connectorId: string; connectorName: string; category: string;
  status: string; incremental: boolean; createdAt: number; lastSyncAt: number | null;
  cursor: unknown; config: Record<string, unknown>; oauthUrl: string | null;
}
interface Schedule {
  id: string; connectionId: string; connectorName: string; cadence: string;
  intervalMs: number; mode: string; enabled: boolean; nextRunAt: number;
  lastRunAt: number | null; runCount: number; due: boolean; nextRunInMs: number;
}
interface SyncRun {
  id: string; connectionId: string; connectorName: string; mode: string;
  startedAt: number; finishedAt: number; recordsScanned: number;
  recordsExtracted: number; recordsLoaded: number; duplicatesRemoved: number;
  byteVolume: number; failures: number; status: string; replayOf?: string;
  newCursor: unknown; cursorField: string;
}
interface MappingRule {
  action: 'rename' | 'cast' | 'drop' | 'derive' | 'passthrough';
  from?: string; to?: string; castTo?: string; value?: string;
}
interface DedupConfig {
  enabled: boolean; threshold: number; strategy: string; keyField: string | null;
}
interface WebhookEndpoint {
  token: string; url: string; recordsReceived: number;
  lastReceivedAt: number | null; instructions: string;
}

type TabId = 'connectors' | 'schedules' | 'transforms' | 'runs' | 'dedup' | 'ocr' | 'webhook';

const TABS: { id: TabId; label: string; icon: typeof Plug }[] = [
  { id: 'connectors', label: 'Connectors', icon: Plug },
  { id: 'schedules', label: 'Schedules', icon: CalendarClock },
  { id: 'transforms', label: 'Transforms', icon: Wand2 },
  { id: 'runs', label: 'Sync Runs', icon: ScrollText },
  { id: 'dedup', label: 'Dedup', icon: Filter },
  { id: 'ocr', label: 'OCR / PDF', icon: ScanLine },
  { id: 'webhook', label: 'Webhook', icon: Webhook },
];

const CADENCES = ['every-15m', 'hourly', 'every-6h', 'daily', 'weekly'];
const fmtBytes = (b: number) => (b < 1024 ? `${b} B` : b < 1048576 ? `${(b / 1024).toFixed(1)} KB` : `${(b / 1048576).toFixed(2)} MB`);
const fmtTime = (t: number | null) => (t ? new Date(t).toLocaleString() : '—');
const fmtDur = (ms: number) => {
  if (ms <= 0) return 'due now';
  const m = Math.round(ms / 60000);
  if (m < 60) return `${m}m`;
  const h = Math.round(m / 60);
  return h < 24 ? `${h}h` : `${Math.round(h / 24)}d`;
};

export function PipelinePanel() {
  const [tab, setTab] = useState<TabId>('connectors');
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ kind: 'ok' | 'err'; text: string } | null>(null);

  // shared data
  const [connectors, setConnectors] = useState<Connector[]>([]);
  const [connections, setConnections] = useState<Connection[]>([]);
  const [schedules, setSchedules] = useState<Schedule[]>([]);
  const [runs, setRuns] = useState<SyncRun[]>([]);
  const [runTotals, setRunTotals] = useState({ records: 0, bytes: 0, failures: 0 });

  const flash = useCallback((kind: 'ok' | 'err', text: string) => {
    setMsg({ kind, text });
    window.setTimeout(() => setMsg(null), 4000);
  }, []);

  // ── loaders ────────────────────────────────────────────────────────
  const loadConnectors = useCallback(async () => {
    const r = await lensRun('ingest', 'listConnectors', {});
    if (r.data.ok && r.data.result) setConnectors(r.data.result.connectors || []);
  }, []);
  const loadConnections = useCallback(async () => {
    const r = await lensRun('ingest', 'listConnections', {});
    if (r.data.ok && r.data.result) setConnections(r.data.result.connections || []);
  }, []);
  const loadSchedules = useCallback(async () => {
    const r = await lensRun('ingest', 'listSchedules', {});
    if (r.data.ok && r.data.result) setSchedules(r.data.result.schedules || []);
  }, []);
  const loadRuns = useCallback(async () => {
    const r = await lensRun('ingest', 'listSyncRuns', { limit: 50 });
    if (r.data.ok && r.data.result) {
      setRuns(r.data.result.runs || []);
      setRunTotals({
        records: r.data.result.totalRecordsLoaded || 0,
        bytes: r.data.result.totalByteVolume || 0,
        failures: r.data.result.totalFailures || 0,
      });
    }
  }, []);

  useEffect(() => {
    loadConnectors();
    loadConnections();
    loadSchedules();
    loadRuns();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <div className="panel p-5 space-y-4" data-testid="ingest-pipeline-panel">
      <div className="flex items-center justify-between gap-3 flex-wrap">
        <h2 className="text-lg font-bold flex items-center gap-2">
          <Plug className="w-5 h-5 text-neon-cyan" />
          ELT Pipeline
        </h2>
        <span className="text-xs text-gray-500">
          {connections.length} connection{connections.length !== 1 ? 's' : ''} ·{' '}
          {schedules.filter((s) => s.enabled).length} active schedule{schedules.filter((s) => s.enabled).length !== 1 ? 's' : ''}
        </span>
      </div>

      {/* Tab bar */}
      <div className="flex items-center gap-1 flex-wrap border-b border-white/10 pb-2">
        {TABS.map((t) => (
          <button
            key={t.id}
            onClick={() => setTab(t.id)}
            className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium transition-colors ${
              tab === t.id
                ? 'bg-neon-cyan/20 text-neon-cyan border border-neon-cyan/40'
                : 'text-gray-400 hover:text-white hover:bg-white/5 border border-transparent'
            }`}
          >
            <t.icon className="w-3.5 h-3.5" />
            {t.label}
          </button>
        ))}
      </div>

      {msg && (
        <div
          className={`flex items-center gap-2 p-2.5 rounded-lg text-xs ${
            msg.kind === 'ok'
              ? 'bg-green-500/10 border border-green-500/20 text-green-400'
              : 'bg-red-500/10 border border-red-500/20 text-red-400'
          }`}
        >
          {msg.kind === 'ok' ? <CheckCircle2 className="w-4 h-4" /> : <AlertTriangle className="w-4 h-4" />}
          {msg.text}
        </div>
      )}

      {tab === 'connectors' && (
        <ConnectorsTab
          connectors={connectors}
          connections={connections}
          busy={busy}
          setBusy={setBusy}
          flash={flash}
          reloadConnections={loadConnections}
        />
      )}
      {tab === 'schedules' && (
        <SchedulesTab
          connections={connections}
          schedules={schedules}
          busy={busy}
          setBusy={setBusy}
          flash={flash}
          reload={loadSchedules}
        />
      )}
      {tab === 'transforms' && (
        <TransformsTab connections={connections} busy={busy} setBusy={setBusy} flash={flash} />
      )}
      {tab === 'runs' && (
        <RunsTab
          connections={connections}
          runs={runs}
          totals={runTotals}
          busy={busy}
          setBusy={setBusy}
          flash={flash}
          reload={loadRuns}
        />
      )}
      {tab === 'dedup' && <DedupTab busy={busy} setBusy={setBusy} flash={flash} />}
      {tab === 'ocr' && <OcrTab busy={busy} setBusy={setBusy} flash={flash} />}
      {tab === 'webhook' && <WebhookTab busy={busy} setBusy={setBusy} flash={flash} />}
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────
//  Connectors tab
// ─────────────────────────────────────────────────────────────────────
function ConnectorsTab({
  connectors, connections, busy, setBusy, flash, reloadConnections,
}: {
  connectors: Connector[];
  connections: Connection[];
  busy: boolean;
  setBusy: (b: boolean) => void;
  flash: (k: 'ok' | 'err', t: string) => void;
  reloadConnections: () => Promise<void>;
}) {
  const [selected, setSelected] = useState<Connector | null>(null);
  const [config, setConfig] = useState<Record<string, string>>({});

  const openConfig = (c: Connector) => {
    setSelected(c);
    const init: Record<string, string> = {};
    c.fields.forEach((f) => {
      if (f.default !== undefined) init[f.key] = String(f.default);
    });
    setConfig(init);
  };

  const submit = async () => {
    if (!selected) return;
    setBusy(true);
    const r = await lensRun('ingest', 'configureConnector', {
      connectorId: selected.id,
      config,
    });
    setBusy(false);
    if (r.data.ok && r.data.result) {
      flash('ok', `${selected.name} configured — connection ${String(r.data.result.connectionId).slice(0, 14)}`);
      setSelected(null);
      setConfig({});
      await reloadConnections();
    } else {
      flash('err', r.data.error || 'Configuration failed');
    }
  };

  const remove = async (id: string) => {
    setBusy(true);
    const r = await lensRun('ingest', 'deleteConnection', { connectionId: id });
    setBusy(false);
    if (r.data.ok) {
      flash('ok', 'Connection removed');
      await reloadConnections();
    } else {
      flash('err', r.data.error || 'Delete failed');
    }
  };

  return (
    <div className="space-y-4">
      <div>
        <h3 className="text-sm font-semibold text-white mb-2">Connector Catalog</h3>
        <div className="grid grid-cols-2 md:grid-cols-3 gap-3">
          {connectors.map((c) => (
            <button
              key={c.id}
              onClick={() => openConfig(c)}
              className="text-left p-3 rounded-lg bg-black/40 border border-white/10 hover:border-neon-cyan/40 transition-colors space-y-1"
            >
              <div className="flex items-center justify-between">
                <span className="text-sm font-medium text-white">{c.name}</span>
                {c.requiresOAuth && (
                  <span className="text-[10px] px-1.5 py-0.5 rounded bg-neon-purple/20 text-neon-purple">OAuth</span>
                )}
              </div>
              <p className="text-xs text-gray-500 capitalize">{c.category} · {c.auth}</p>
              <p className="text-[11px] text-gray-600">
                {c.fieldCount} field{c.fieldCount !== 1 ? 's' : ''}
                {c.incremental ? ' · incremental' : ''}
              </p>
            </button>
          ))}
          {connectors.length === 0 && (
            <p className="text-xs text-gray-500 col-span-3 text-center py-4">
              <Loader2 className="w-4 h-4 animate-spin inline mr-1" /> Loading catalog…
            </p>
          )}
        </div>
      </div>

      {/* Config form for the selected connector */}
      {selected && (
        <div className="p-4 rounded-lg bg-black/40 border border-neon-cyan/30 space-y-3">
          <div className="flex items-center justify-between">
            <h3 className="text-sm font-semibold text-neon-cyan">Configure {selected.name}</h3>
            <button onClick={() => setSelected(null)} className="text-xs text-gray-500 hover:text-white">
              Cancel
            </button>
          </div>
          {selected.requiresOAuth && selected.oauth && (
            <p className="text-xs text-neon-purple bg-neon-purple/10 rounded p-2">
              OAuth ({selected.oauth.provider}) — saving creates a pending connection with an authorize URL.
            </p>
          )}
          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
            {selected.fields.map((f) => (
              <div key={f.key}>
                <label className="text-xs text-gray-400 block mb-1">
                  {f.label}
                  {f.required && <span className="text-red-400 ml-0.5">*</span>}
                </label>
                {f.type === 'select' ? (
                  <select
                    value={config[f.key] ?? ''}
                    onChange={(e) => setConfig((c) => ({ ...c, [f.key]: e.target.value }))}
                    className="w-full px-3 py-1.5 bg-lattice-surface border border-lattice-border rounded text-xs text-white focus:outline-none focus:border-neon-cyan"
                  >
                    <option value="">Select…</option>
                    {(f.options || []).map((o) => (
                      <option key={o} value={o}>{o}</option>
                    ))}
                  </select>
                ) : (
                  <input
                    type={f.type === 'password' ? 'password' : f.type === 'number' ? 'number' : f.type === 'date' ? 'date' : 'text'}
                    value={config[f.key] ?? ''}
                    onChange={(e) => setConfig((c) => ({ ...c, [f.key]: e.target.value }))}
                    className="w-full px-3 py-1.5 bg-lattice-surface border border-lattice-border rounded text-xs text-white focus:outline-none focus:border-neon-cyan"
                  />
                )}
              </div>
            ))}
          </div>
          <button
            onClick={submit}
            disabled={busy}
            className="px-4 py-2 bg-neon-cyan/20 border border-neon-cyan/40 rounded-lg text-xs font-medium text-neon-cyan hover:bg-neon-cyan/30 disabled:opacity-40 flex items-center gap-1.5"
          >
            {busy ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Plus className="w-3.5 h-3.5" />}
            Create Connection
          </button>
        </div>
      )}

      {/* Existing connections */}
      <div>
        <h3 className="text-sm font-semibold text-white mb-2">Connections</h3>
        <div className="space-y-2">
          {connections.map((c) => (
            <div key={c.id} className="flex items-center gap-3 p-2.5 rounded bg-black/30 border border-white/5">
              <div
                className={`w-2 h-2 rounded-full ${
                  c.status === 'configured' ? 'bg-neon-green' : 'bg-yellow-400'
                }`}
              />
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2">
                  <span className="text-xs font-medium text-white">{c.connectorName}</span>
                  <span className="text-[10px] text-gray-500">{c.status}</span>
                  {c.incremental && <span className="text-[10px] text-neon-cyan">incremental</span>}
                </div>
                <p className="text-[11px] text-gray-600 truncate">
                  {c.id} · last sync {fmtTime(c.lastSyncAt)}
                  {c.cursor != null && ` · cursor ${String(c.cursor)}`}
                </p>
                {c.oauthUrl && (
                  <a href={c.oauthUrl} className="text-[11px] text-neon-purple hover:underline">
                    Complete OAuth →
                  </a>
                )}
              </div>
              <button
                onClick={() => remove(c.id)}
                disabled={busy}
                className="p-1.5 rounded hover:bg-red-500/10 text-gray-500 hover:text-red-400 disabled:opacity-40"
                aria-label="Delete connection"
              >
                <Trash2 className="w-3.5 h-3.5" />
              </button>
            </div>
          ))}
          {connections.length === 0 && (
            <p className="text-xs text-gray-500 text-center py-4">
              No connections yet — pick a connector above.
            </p>
          )}
        </div>
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────
//  Schedules tab
// ─────────────────────────────────────────────────────────────────────
function SchedulesTab({
  connections, schedules, busy, setBusy, flash, reload,
}: {
  connections: Connection[];
  schedules: Schedule[];
  busy: boolean;
  setBusy: (b: boolean) => void;
  flash: (k: 'ok' | 'err', t: string) => void;
  reload: () => Promise<void>;
}) {
  const [connId, setConnId] = useState('');
  const [cadence, setCadence] = useState('daily');
  const [mode, setMode] = useState<'incremental' | 'full'>('incremental');

  const create = async () => {
    if (!connId) return flash('err', 'Pick a connection first');
    setBusy(true);
    const r = await lensRun('ingest', 'scheduleSync', { connectionId: connId, cadence, mode });
    setBusy(false);
    if (r.data.ok) {
      flash('ok', `Schedule created (${cadence})`);
      await reload();
    } else {
      flash('err', r.data.error || 'Schedule failed');
    }
  };

  const toggle = async (id: string) => {
    setBusy(true);
    const r = await lensRun('ingest', 'toggleSchedule', { scheduleId: id });
    setBusy(false);
    if (r.data.ok) await reload();
    else flash('err', r.data.error || 'Toggle failed');
  };

  const remove = async (id: string) => {
    setBusy(true);
    const r = await lensRun('ingest', 'deleteSchedule', { scheduleId: id });
    setBusy(false);
    if (r.data.ok) {
      flash('ok', 'Schedule removed');
      await reload();
    } else {
      flash('err', r.data.error || 'Delete failed');
    }
  };

  return (
    <div className="space-y-4">
      <div className="p-4 rounded-lg bg-black/40 border border-white/10 space-y-3">
        <h3 className="text-sm font-semibold text-white">New Sync Schedule</h3>
        <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
          <select
            value={connId}
            onChange={(e) => setConnId(e.target.value)}
            className="px-3 py-1.5 bg-lattice-surface border border-lattice-border rounded text-xs text-white"
          >
            <option value="">Select connection…</option>
            {connections.map((c) => (
              <option key={c.id} value={c.id}>{c.connectorName} ({c.id.slice(0, 10)})</option>
            ))}
          </select>
          <select
            value={cadence}
            onChange={(e) => setCadence(e.target.value)}
            className="px-3 py-1.5 bg-lattice-surface border border-lattice-border rounded text-xs text-white"
          >
            {CADENCES.map((c) => <option key={c} value={c}>{c}</option>)}
          </select>
          <select
            value={mode}
            onChange={(e) => setMode(e.target.value as 'incremental' | 'full')}
            className="px-3 py-1.5 bg-lattice-surface border border-lattice-border rounded text-xs text-white"
          >
            <option value="incremental">incremental (cursor deltas)</option>
            <option value="full">full refresh</option>
          </select>
        </div>
        <button
          onClick={create}
          disabled={busy}
          className="px-4 py-2 bg-neon-cyan/20 border border-neon-cyan/40 rounded-lg text-xs font-medium text-neon-cyan hover:bg-neon-cyan/30 disabled:opacity-40 flex items-center gap-1.5"
        >
          {busy ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Plus className="w-3.5 h-3.5" />}
          Create Schedule
        </button>
      </div>

      <div className="space-y-2">
        {schedules.map((s) => (
          <div key={s.id} className="flex items-center gap-3 p-2.5 rounded bg-black/30 border border-white/5">
            <button
              onClick={() => toggle(s.id)}
              disabled={busy}
              className={`text-[10px] px-2 py-0.5 rounded font-medium ${
                s.enabled ? 'bg-neon-green/20 text-neon-green' : 'bg-gray-500/20 text-gray-500'
              }`}
            >
              {s.enabled ? 'enabled' : 'paused'}
            </button>
            <div className="flex-1 min-w-0">
              <div className="flex items-center gap-2">
                <span className="text-xs font-medium text-white">{s.connectorName}</span>
                <span className="text-[10px] text-gray-500">{s.cadence} · {s.mode}</span>
                {s.due && <span className="text-[10px] text-yellow-400">due</span>}
              </div>
              <p className="text-[11px] text-gray-600">
                Next run {s.enabled ? fmtDur(s.nextRunInMs) : '—'} · {s.runCount} run{s.runCount !== 1 ? 's' : ''}
              </p>
            </div>
            <button
              onClick={() => remove(s.id)}
              disabled={busy}
              className="p-1.5 rounded hover:bg-red-500/10 text-gray-500 hover:text-red-400 disabled:opacity-40"
              aria-label="Delete schedule"
            >
              <Trash2 className="w-3.5 h-3.5" />
            </button>
          </div>
        ))}
        {schedules.length === 0 && (
          <p className="text-xs text-gray-500 text-center py-4">No schedules configured.</p>
        )}
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────
//  Transforms tab — field mapping + preview
// ─────────────────────────────────────────────────────────────────────
function TransformsTab({
  connections, busy, setBusy, flash,
}: {
  connections: Connection[];
  busy: boolean;
  setBusy: (b: boolean) => void;
  flash: (k: 'ok' | 'err', t: string) => void;
}) {
  const [connId, setConnId] = useState('');
  const [sampleJson, setSampleJson] = useState('[\n  {"id": 1, "name": "Ada", "amount": "42"}\n]');
  const [rules, setRules] = useState<MappingRule[]>([]);
  const [preview, setPreview] = useState<{ before: any; after: any }[] | null>(null);
  const [meta, setMeta] = useState<{ input: string[]; output: string[]; dropped: string[]; derived: string[] } | null>(null);

  const loadMapping = useCallback(async (id: string) => {
    if (!id) return;
    const r = await lensRun('ingest', 'getMapping', { connectionId: id });
    if (r.data.ok && r.data.result) setRules(r.data.result.mapping || []);
  }, []);

  const addRule = () => setRules((r) => [...r, { action: 'rename', from: '', to: '' }]);
  const updateRule = (i: number, patch: Partial<MappingRule>) =>
    setRules((r) => r.map((rule, idx) => (idx === i ? { ...rule, ...patch } : rule)));
  const removeRule = (i: number) => setRules((r) => r.filter((_, idx) => idx !== i));

  const runPreview = async () => {
    let sample: any[];
    try {
      sample = JSON.parse(sampleJson);
      if (!Array.isArray(sample)) throw new Error('not array');
    } catch {
      return flash('err', 'Sample must be a JSON array of records');
    }
    setBusy(true);
    const r = await lensRun('ingest', 'previewTransform', { sample, mapping: rules });
    setBusy(false);
    if (r.data.ok && r.data.result) {
      setPreview(r.data.result.preview || []);
      setMeta({
        input: r.data.result.inputFields || [],
        output: r.data.result.outputFields || [],
        dropped: r.data.result.droppedFields || [],
        derived: r.data.result.derivedFields || [],
      });
    } else {
      flash('err', r.data.error || 'Preview failed');
    }
  };

  const save = async () => {
    if (!connId) return flash('err', 'Pick a connection to save the mapping to');
    setBusy(true);
    const r = await lensRun('ingest', 'saveMapping', { connectionId: connId, mapping: rules });
    setBusy(false);
    if (r.data.ok) flash('ok', `Mapping saved (${rules.length} rule${rules.length !== 1 ? 's' : ''})`);
    else flash('err', r.data.error || 'Save failed');
  };

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-3 flex-wrap">
        <select
          value={connId}
          onChange={(e) => {
            setConnId(e.target.value);
            loadMapping(e.target.value);
          }}
          className="px-3 py-1.5 bg-lattice-surface border border-lattice-border rounded text-xs text-white"
        >
          <option value="">Connection (for save)…</option>
          {connections.map((c) => (
            <option key={c.id} value={c.id}>{c.connectorName} ({c.id.slice(0, 10)})</option>
          ))}
        </select>
        <span className="text-xs text-gray-500">{rules.length} rule{rules.length !== 1 ? 's' : ''}</span>
      </div>

      <div className="space-y-2">
        {rules.map((rule, i) => (
          <div key={i} className="flex items-center gap-2 p-2 rounded bg-black/30 border border-white/5">
            <select
              value={rule.action}
              onChange={(e) => updateRule(i, { action: e.target.value as MappingRule['action'] })}
              className="px-2 py-1 bg-lattice-surface border border-lattice-border rounded text-[11px] text-white"
            >
              <option value="rename">rename</option>
              <option value="cast">cast</option>
              <option value="drop">drop</option>
              <option value="derive">derive</option>
              <option value="passthrough">passthrough</option>
            </select>
            {rule.action !== 'derive' && (
              <input
                placeholder="from field"
                value={rule.from ?? ''}
                onChange={(e) => updateRule(i, { from: e.target.value })}
                className="flex-1 px-2 py-1 bg-lattice-surface border border-lattice-border rounded text-[11px] text-white"
              />
            )}
            {(rule.action === 'rename' || rule.action === 'derive') && (
              <input
                placeholder="to field"
                value={rule.to ?? ''}
                onChange={(e) => updateRule(i, { to: e.target.value })}
                className="flex-1 px-2 py-1 bg-lattice-surface border border-lattice-border rounded text-[11px] text-white"
              />
            )}
            {rule.action === 'cast' && (
              <select
                value={rule.castTo ?? 'string'}
                onChange={(e) => updateRule(i, { castTo: e.target.value })}
                className="px-2 py-1 bg-lattice-surface border border-lattice-border rounded text-[11px] text-white"
              >
                <option value="string">string</option>
                <option value="number">number</option>
                <option value="boolean">boolean</option>
              </select>
            )}
            {rule.action === 'derive' && (
              <input
                placeholder="constant value"
                value={rule.value ?? ''}
                onChange={(e) => updateRule(i, { value: e.target.value })}
                className="flex-1 px-2 py-1 bg-lattice-surface border border-lattice-border rounded text-[11px] text-white"
              />
            )}
            <button
              onClick={() => removeRule(i)}
              className="p-1 rounded hover:bg-red-500/10 text-gray-500 hover:text-red-400"
              aria-label="Remove rule"
            >
              <Trash2 className="w-3.5 h-3.5" />
            </button>
          </div>
        ))}
        <button
          onClick={addRule}
          className="text-xs text-neon-cyan hover:underline flex items-center gap-1"
        >
          <Plus className="w-3.5 h-3.5" /> Add mapping rule
        </button>
      </div>

      <div>
        <label className="text-xs text-gray-400 block mb-1">Sample records (JSON array)</label>
        <textarea
          value={sampleJson}
          onChange={(e) => setSampleJson(e.target.value)}
          rows={5}
          className="w-full px-3 py-2 bg-lattice-surface border border-lattice-border rounded text-xs text-white font-mono focus:outline-none focus:border-neon-cyan resize-y"
        />
      </div>

      <div className="flex items-center gap-2">
        <button
          onClick={runPreview}
          disabled={busy}
          className="px-4 py-2 bg-neon-purple/20 border border-neon-purple/40 rounded-lg text-xs font-medium text-neon-purple hover:bg-neon-purple/30 disabled:opacity-40 flex items-center gap-1.5"
        >
          {busy ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Wand2 className="w-3.5 h-3.5" />}
          Preview Transform
        </button>
        <button
          onClick={save}
          disabled={busy || !connId}
          className="px-4 py-2 bg-neon-cyan/20 border border-neon-cyan/40 rounded-lg text-xs font-medium text-neon-cyan hover:bg-neon-cyan/30 disabled:opacity-40"
        >
          Save Mapping
        </button>
      </div>

      {meta && (
        <div className="grid grid-cols-2 md:grid-cols-4 gap-2 text-xs">
          {[
            { label: 'Input fields', value: meta.input.length, color: 'text-gray-300' },
            { label: 'Output fields', value: meta.output.length, color: 'text-neon-cyan' },
            { label: 'Dropped', value: meta.dropped.length, color: 'text-red-400' },
            { label: 'Derived', value: meta.derived.length, color: 'text-neon-green' },
          ].map((s) => (
            <div key={s.label} className="lens-card text-center">
              <p className={`text-lg font-bold ${s.color}`}>{s.value}</p>
              <p className="text-xs text-gray-400">{s.label}</p>
            </div>
          ))}
        </div>
      )}

      {preview && preview.length > 0 && (
        <div className="space-y-1.5 max-h-64 overflow-y-auto">
          <h4 className="text-xs font-semibold text-white">Before → After</h4>
          {preview.slice(0, 10).map((row, i) => (
            <div key={i} className="grid grid-cols-2 gap-2 text-[11px] font-mono">
              <pre className="p-2 rounded bg-black/40 border border-white/5 text-gray-400 overflow-x-auto">
                {JSON.stringify(row.before)}
              </pre>
              <pre className="p-2 rounded bg-black/40 border border-neon-cyan/20 text-neon-cyan overflow-x-auto">
                {JSON.stringify(row.after)}
              </pre>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────
//  Sync Runs tab — run a sync, view logs, replay
// ─────────────────────────────────────────────────────────────────────
function RunsTab({
  connections, runs, totals, busy, setBusy, flash, reload,
}: {
  connections: Connection[];
  runs: SyncRun[];
  totals: { records: number; bytes: number; failures: number };
  busy: boolean;
  setBusy: (b: boolean) => void;
  flash: (k: 'ok' | 'err', t: string) => void;
  reload: () => Promise<void>;
}) {
  const [connId, setConnId] = useState('');
  const [recordsJson, setRecordsJson] = useState(
    '[\n  {"id": 1, "updated_at": "2026-01-01"},\n  {"id": 2, "updated_at": "2026-01-02"}\n]',
  );

  const runSync = async () => {
    if (!connId) return flash('err', 'Pick a connection');
    let records: any[];
    try {
      records = JSON.parse(recordsJson);
      if (!Array.isArray(records)) throw new Error('not array');
    } catch {
      return flash('err', 'Records must be a JSON array');
    }
    setBusy(true);
    const r = await lensRun('ingest', 'runSync', { connectionId: connId, records });
    setBusy(false);
    if (r.data.ok && r.data.result) {
      flash(
        'ok',
        `Sync ${String(r.data.result.runId).slice(0, 12)} — ${r.data.result.recordsLoaded} loaded, ${r.data.result.duplicatesRemoved} dedup`,
      );
      await reload();
    } else {
      flash('err', r.data.error || 'Sync failed');
    }
  };

  const replay = async (runId: string) => {
    setBusy(true);
    const r = await lensRun('ingest', 'replaySyncRun', { runId });
    setBusy(false);
    if (r.data.ok) {
      flash('ok', 'Run replayed');
      await reload();
    } else {
      flash('err', r.data.error || 'Replay failed');
    }
  };

  const chartData = useMemo(
    () =>
      [...runs]
        .slice(0, 20)
        .reverse()
        .map((r, i) => ({
          run: `#${i + 1}`,
          loaded: r.recordsLoaded,
          duplicates: r.duplicatesRemoved,
        })),
    [runs],
  );

  return (
    <div className="space-y-4">
      <div className="p-4 rounded-lg bg-black/40 border border-white/10 space-y-3">
        <h3 className="text-sm font-semibold text-white">Run a Sync</h3>
        <select
          value={connId}
          onChange={(e) => setConnId(e.target.value)}
          className="px-3 py-1.5 bg-lattice-surface border border-lattice-border rounded text-xs text-white"
        >
          <option value="">Select connection…</option>
          {connections.map((c) => (
            <option key={c.id} value={c.id}>{c.connectorName} ({c.id.slice(0, 10)})</option>
          ))}
        </select>
        <textarea
          value={recordsJson}
          onChange={(e) => setRecordsJson(e.target.value)}
          rows={5}
          className="w-full px-3 py-2 bg-lattice-surface border border-lattice-border rounded text-xs text-white font-mono focus:outline-none focus:border-neon-cyan resize-y"
        />
        <div className="flex items-center gap-2">
          <button
            onClick={runSync}
            disabled={busy}
            className="px-4 py-2 bg-neon-green/20 border border-neon-green/40 rounded-lg text-xs font-medium text-neon-green hover:bg-neon-green/30 disabled:opacity-40 flex items-center gap-1.5"
          >
            {busy ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Play className="w-3.5 h-3.5" />}
            Run Sync
          </button>
          <button
            onClick={() => reload()}
            disabled={busy}
            className="px-3 py-2 bg-lattice-surface border border-lattice-border rounded-lg text-xs text-gray-400 hover:text-white disabled:opacity-40 flex items-center gap-1.5"
          >
            <RefreshCw className="w-3.5 h-3.5" /> Refresh
          </button>
        </div>
      </div>

      <div className="grid grid-cols-3 gap-2">
        {[
          { label: 'Records loaded', value: totals.records.toLocaleString(), color: 'text-neon-green' },
          { label: 'Byte volume', value: fmtBytes(totals.bytes), color: 'text-neon-cyan' },
          { label: 'Failures', value: totals.failures.toLocaleString(), color: 'text-red-400' },
        ].map((s) => (
          <div key={s.label} className="lens-card text-center">
            <p className={`text-lg font-bold ${s.color}`}>{s.value}</p>
            <p className="text-xs text-gray-400">{s.label}</p>
          </div>
        ))}
      </div>

      {chartData.length > 0 && (
        <ChartKit
          kind="bar"
          data={chartData}
          xKey="run"
          series={[
            { key: 'loaded', label: 'Loaded', color: '#22c55e' },
            { key: 'duplicates', label: 'Dedup', color: '#f59e0b' },
          ]}
          height={180}
        />
      )}

      <div className="space-y-2">
        <h3 className="text-sm font-semibold text-white">Run Log</h3>
        {runs.map((r) => (
          <div key={r.id} className="flex items-center gap-3 p-2.5 rounded bg-black/30 border border-white/5">
            <div
              className={`w-2 h-2 rounded-full ${
                r.status === 'succeeded' ? 'bg-neon-green' : 'bg-red-400'
              }`}
            />
            <div className="flex-1 min-w-0">
              <div className="flex items-center gap-2">
                <span className="text-xs font-medium text-white">{r.connectorName}</span>
                <span className="text-[10px] text-gray-500">{r.mode}</span>
                {r.replayOf && <span className="text-[10px] text-neon-purple">replay</span>}
              </div>
              <p className="text-[11px] text-gray-600">
                {r.recordsScanned} scanned → {r.recordsExtracted} extracted → {r.recordsLoaded} loaded
                {r.duplicatesRemoved > 0 && ` · ${r.duplicatesRemoved} dedup`} · {fmtBytes(r.byteVolume)} · {fmtTime(r.finishedAt)}
              </p>
            </div>
            <button
              onClick={() => replay(r.id)}
              disabled={busy}
              className="text-[11px] px-2 py-1 rounded bg-neon-purple/15 text-neon-purple hover:bg-neon-purple/25 disabled:opacity-40 flex items-center gap-1"
            >
              <RefreshCw className="w-3 h-3" /> Replay
            </button>
          </div>
        ))}
        {runs.length === 0 && (
          <p className="text-xs text-gray-500 text-center py-4">No sync runs yet.</p>
        )}
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────
//  Dedup tab
// ─────────────────────────────────────────────────────────────────────
function DedupTab({
  busy, setBusy, flash,
}: {
  busy: boolean;
  setBusy: (b: boolean) => void;
  flash: (k: 'ok' | 'err', t: string) => void;
}) {
  const [cfg, setCfg] = useState<DedupConfig | null>(null);

  const load = useCallback(async () => {
    const r = await lensRun('ingest', 'getDedupConfig', {});
    if (r.data.ok && r.data.result) setCfg(r.data.result);
  }, []);

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const save = async () => {
    if (!cfg) return;
    setBusy(true);
    const r = await lensRun('ingest', 'setDedupConfig', {
      enabled: cfg.enabled,
      threshold: cfg.threshold,
      strategy: cfg.strategy,
      keyField: cfg.keyField,
    });
    setBusy(false);
    if (r.data.ok && r.data.result) {
      setCfg(r.data.result);
      flash('ok', 'Dedup config saved');
    } else {
      flash('err', r.data.error || 'Save failed');
    }
  };

  if (!cfg) {
    return (
      <p className="text-xs text-gray-500 text-center py-4">
        <Loader2 className="w-4 h-4 animate-spin inline mr-1" /> Loading dedup config…
      </p>
    );
  }

  return (
    <div className="space-y-4 max-w-md">
      <p className="text-xs text-gray-500">
        Dedup runs inside every sync — configure the strategy and similarity threshold here
        instead of relying on a fixed gate.
      </p>
      <label className="flex items-center gap-2 text-xs text-white">
        <input
          type="checkbox"
          checked={cfg.enabled}
          onChange={(e) => setCfg({ ...cfg, enabled: e.target.checked })}
        />
        Dedup enabled
      </label>
      <div>
        <label className="text-xs text-gray-400 block mb-1">Strategy</label>
        <select
          value={cfg.strategy}
          onChange={(e) => setCfg({ ...cfg, strategy: e.target.value })}
          className="w-full px-3 py-1.5 bg-lattice-surface border border-lattice-border rounded text-xs text-white"
        >
          <option value="semantic-hash">semantic-hash</option>
          <option value="exact">exact</option>
          <option value="key-field">key-field</option>
        </select>
      </div>
      {cfg.strategy === 'key-field' && (
        <div>
          <label className="text-xs text-gray-400 block mb-1">Key field</label>
          <input
            value={cfg.keyField ?? ''}
            onChange={(e) => setCfg({ ...cfg, keyField: e.target.value })}
            className="w-full px-3 py-1.5 bg-lattice-surface border border-lattice-border rounded text-xs text-white"
          />
        </div>
      )}
      <div>
        <label className="text-xs text-gray-400 block mb-1">
          Similarity threshold: {cfg.threshold.toFixed(2)}
        </label>
        <input
          type="range"
          min={0.5}
          max={1}
          step={0.01}
          value={cfg.threshold}
          onChange={(e) => setCfg({ ...cfg, threshold: Number(e.target.value) })}
          className="w-full"
        />
      </div>
      <button
        onClick={save}
        disabled={busy}
        className="px-4 py-2 bg-neon-cyan/20 border border-neon-cyan/40 rounded-lg text-xs font-medium text-neon-cyan hover:bg-neon-cyan/30 disabled:opacity-40 flex items-center gap-1.5"
      >
        {busy ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Filter className="w-3.5 h-3.5" />}
        Save Dedup Config
      </button>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────
//  OCR / PDF tab
// ─────────────────────────────────────────────────────────────────────
interface OcrResult {
  pageCount: number; totalWords: number; totalChars: number; emptyPages: number;
  avgConfidence: number | null; lowConfidencePages: number[];
  headings: { page: number; text: string }[];
  perPage: { page: number; wordCount: number; charCount: number; lineCount: number; headingCount: number; confidence: number | null; empty: boolean }[];
  chunkCount: number; documentText: string;
}

function OcrTab({
  busy, setBusy, flash,
}: {
  busy: boolean;
  setBusy: (b: boolean) => void;
  flash: (k: 'ok' | 'err', t: string) => void;
}) {
  const [text, setText] = useState('');
  const [result, setResult] = useState<OcrResult | null>(null);

  // Reads a plain-text / PDF text layer from the chosen file. For PDFs the
  // browser hands us the raw stream; we read it as text so the OCR macro can
  // structure whatever text layer is present. No fabricated content.
  const onFile = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const f = e.target.files?.[0];
    if (!f) return;
    const t = await f.text();
    setText(t);
  };

  const run = async () => {
    if (!text.trim()) return flash('err', 'Provide document text from a PDF/OCR extraction');
    setBusy(true);
    // Split on form-feed (PDF page break) so multi-page docs report per-page.
    const pages = text.includes('\f') ? text.split('\f') : [text];
    const r = await lensRun('ingest', 'ocrIngest', { pages });
    setBusy(false);
    if (r.data.ok && r.data.result) {
      setResult(r.data.result);
      flash('ok', `OCR structured ${r.data.result.pageCount} page(s) into ${r.data.result.chunkCount} chunk(s)`);
    } else {
      flash('err', r.data.error || 'OCR ingest failed');
    }
  };

  return (
    <div className="space-y-4">
      <p className="text-xs text-gray-500">
        Real OCR/PDF path — paste an extracted text layer (or load a file). The macro
        structures it into per-page word counts, headings, a confidence rollup, and
        DTU-ready chunks. Use a form-feed (\f) to separate pages.
      </p>
      <div className="flex items-center gap-2">
        <label className="px-3 py-1.5 bg-lattice-surface border border-lattice-border rounded-lg text-xs text-gray-300 hover:text-white cursor-pointer">
          Load file
          <input type="file" className="hidden" accept=".txt,.md,.pdf" onChange={onFile} />
        </label>
      </div>
      <textarea
        value={text}
        onChange={(e) => setText(e.target.value)}
        rows={6}
        placeholder="Paste extracted document text…"
        className="w-full px-3 py-2 bg-lattice-surface border border-lattice-border rounded text-xs text-white font-mono focus:outline-none focus:border-neon-cyan resize-y"
      />
      <button
        onClick={run}
        disabled={busy}
        className="px-4 py-2 bg-neon-cyan/20 border border-neon-cyan/40 rounded-lg text-xs font-medium text-neon-cyan hover:bg-neon-cyan/30 disabled:opacity-40 flex items-center gap-1.5"
      >
        {busy ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <ScanLine className="w-3.5 h-3.5" />}
        Structure Document
      </button>

      {result && (
        <div className="space-y-3">
          <div className="grid grid-cols-2 md:grid-cols-4 gap-2">
            {[
              { label: 'Pages', value: result.pageCount, color: 'text-neon-cyan' },
              { label: 'Words', value: result.totalWords.toLocaleString(), color: 'text-neon-purple' },
              { label: 'Chunks', value: result.chunkCount, color: 'text-neon-green' },
              {
                label: 'Avg confidence',
                value: result.avgConfidence != null ? `${(result.avgConfidence * 100).toFixed(0)}%` : 'n/a',
                color: 'text-yellow-400',
              },
            ].map((s) => (
              <div key={s.label} className="lens-card text-center">
                <p className={`text-lg font-bold ${s.color}`}>{s.value}</p>
                <p className="text-xs text-gray-400">{s.label}</p>
              </div>
            ))}
          </div>
          {result.lowConfidencePages.length > 0 && (
            <p className="text-xs text-yellow-400">
              Low-confidence pages: {result.lowConfidencePages.join(', ')}
            </p>
          )}
          {result.headings.length > 0 && (
            <div className="space-y-1 max-h-40 overflow-y-auto">
              <h4 className="text-xs font-semibold text-white">Detected Headings</h4>
              {result.headings.slice(0, 12).map((h, i) => (
                <div key={i} className="flex items-center gap-1.5 text-[11px] text-gray-300">
                  <ChevronRight className="w-3 h-3 text-gray-600" />
                  <span className="text-gray-600">p{h.page}</span>
                  <span className="truncate">{h.text}</span>
                </div>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────
//  Webhook tab
// ─────────────────────────────────────────────────────────────────────
function WebhookTab({
  busy, setBusy, flash,
}: {
  busy: boolean;
  setBusy: (b: boolean) => void;
  flash: (k: 'ok' | 'err', t: string) => void;
}) {
  const [endpoint, setEndpoint] = useState<WebhookEndpoint | null>(null);
  const [records, setRecords] = useState<{ id: string; receivedAt: number; source: string; payload: any }[]>([]);
  const [pushJson, setPushJson] = useState('[\n  {"event": "test", "value": 1}\n]');

  const loadEndpoint = useCallback(async (rotate = false) => {
    const r = await lensRun('ingest', 'getWebhookEndpoint', rotate ? { rotate: true } : {});
    if (r.data.ok && r.data.result) setEndpoint(r.data.result);
  }, []);
  const loadRecords = useCallback(async () => {
    const r = await lensRun('ingest', 'listWebhookRecords', { limit: 30 });
    if (r.data.ok && r.data.result) setRecords(r.data.result.records || []);
  }, []);

  useEffect(() => {
    loadEndpoint();
    loadRecords();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const rotate = async () => {
    setBusy(true);
    await loadEndpoint(true);
    setBusy(false);
    flash('ok', 'Webhook token rotated');
  };

  const push = async () => {
    let recs: any[];
    try {
      recs = JSON.parse(pushJson);
      if (!Array.isArray(recs)) throw new Error('not array');
    } catch {
      return flash('err', 'Records must be a JSON array');
    }
    setBusy(true);
    const r = await lensRun('ingest', 'pushRecord', { records: recs, source: 'in-lens-test' });
    setBusy(false);
    if (r.data.ok && r.data.result) {
      flash('ok', `Pushed ${r.data.result.accepted} record(s)`);
      await loadRecords();
      await loadEndpoint();
    } else {
      flash('err', r.data.error || 'Push failed');
    }
  };

  return (
    <div className="space-y-4">
      <p className="text-xs text-gray-500">
        Mint a stable push endpoint so external systems can POST records straight into
        the ingest pipeline — no auth header, the URL token authenticates.
      </p>

      {endpoint && (
        <div className="p-4 rounded-lg bg-black/40 border border-white/10 space-y-2">
          <div className="flex items-center justify-between gap-2">
            <code className="text-xs text-neon-cyan break-all">{endpoint.url}</code>
            <button
              onClick={() => navigator.clipboard?.writeText(endpoint.url)}
              className="p-1.5 rounded hover:bg-white/5 text-gray-500 hover:text-white flex-shrink-0"
              aria-label="Copy URL"
            >
              <Copy className="w-3.5 h-3.5" />
            </button>
          </div>
          <p className="text-[11px] text-gray-600">{endpoint.instructions}</p>
          <div className="flex items-center gap-4 text-xs">
            <span className="text-gray-400">
              Received: <span className="text-neon-green">{endpoint.recordsReceived}</span>
            </span>
            <span className="text-gray-400">Last: {fmtTime(endpoint.lastReceivedAt)}</span>
            <button
              onClick={rotate}
              disabled={busy}
              className="text-neon-purple hover:underline disabled:opacity-40"
            >
              Rotate token
            </button>
          </div>
        </div>
      )}

      <div className="p-4 rounded-lg bg-black/40 border border-white/10 space-y-2">
        <h3 className="text-sm font-semibold text-white">Test Push</h3>
        <textarea
          value={pushJson}
          onChange={(e) => setPushJson(e.target.value)}
          rows={4}
          className="w-full px-3 py-2 bg-lattice-surface border border-lattice-border rounded text-xs text-white font-mono focus:outline-none focus:border-neon-cyan resize-y"
        />
        <button
          onClick={push}
          disabled={busy}
          className="px-4 py-2 bg-neon-green/20 border border-neon-green/40 rounded-lg text-xs font-medium text-neon-green hover:bg-neon-green/30 disabled:opacity-40 flex items-center gap-1.5"
        >
          {busy ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Webhook className="w-3.5 h-3.5" />}
          Push Records
        </button>
      </div>

      <div className="space-y-2">
        <h3 className="text-sm font-semibold text-white">Received Records ({records.length})</h3>
        <div className="space-y-1.5 max-h-64 overflow-y-auto">
          {records.map((rec) => (
            <div key={rec.id} className="p-2 rounded bg-black/30 border border-white/5">
              <div className="flex items-center justify-between text-[10px] text-gray-500">
                <span>{rec.source}</span>
                <span>{fmtTime(rec.receivedAt)}</span>
              </div>
              <pre className="text-[11px] text-gray-300 font-mono overflow-x-auto mt-0.5">
                {JSON.stringify(rec.payload)}
              </pre>
            </div>
          ))}
          {records.length === 0 && (
            <p className="text-xs text-gray-500 text-center py-4">No records received yet.</p>
          )}
        </div>
      </div>
    </div>
  );
}
