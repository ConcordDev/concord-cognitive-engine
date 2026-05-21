'use client';

/**
 * CustomDashboard — operator-customizable observability panel grid. Each
 * panel renders a live metric / alert-count / heartbeat-count / trace-count
 * widget. Layout (which panels, what metric, what width) persists per-user
 * via `system.dashboard-load` / `dashboard-save` / `dashboard-reset`.
 */

import { useCallback, useEffect, useState } from 'react';
import { lensRun } from '@/lib/api/client';
import { ChartKit } from '@/components/viz';
import { Loader2, Plus, Trash2, RotateCcw, Save, LayoutDashboard } from 'lucide-react';

type PanelKind = 'metric' | 'alerts' | 'heartbeats' | 'traces';
type MetricKey = 'heapUsedMB' | 'heapTotalMB' | 'rssMB' | 'cpuPct' | 'requestRate' | 'heapPct' | 'loadAvg1';

interface Panel {
  id: string;
  kind: PanelKind;
  title: string;
  w: number;
  metric?: MetricKey;
}

interface Sample {
  ts: number;
  heapUsedMB: number;
  heapTotalMB: number;
  rssMB: number;
  cpuPct: number;
  requestRate: number;
  heapPct: number;
  loadAvg1: number;
}

const METRIC_LABELS: Record<MetricKey, string> = {
  heapUsedMB: 'Heap Used (MB)',
  heapTotalMB: 'Heap Total (MB)',
  rssMB: 'RSS (MB)',
  cpuPct: 'CPU %',
  requestRate: 'Request rate',
  heapPct: 'Heap %',
  loadAvg1: 'Load avg (1m)',
};

const KIND_OPTS: { kind: PanelKind; label: string }[] = [
  { kind: 'metric', label: 'Metric chart' },
  { kind: 'alerts', label: 'Fired alerts' },
  { kind: 'heartbeats', label: 'Heartbeat health' },
  { kind: 'traces', label: 'Trace count' },
];

export function CustomDashboard({ live }: { live: boolean }) {
  const [panels, setPanels] = useState<Panel[]>([]);
  const [isDefault, setIsDefault] = useState(true);
  const [samples, setSamples] = useState<Sample[]>([]);
  const [counts, setCounts] = useState<{ alertsFiring: number; hbOk: number; hbTotal: number; traces: number }>({
    alertsFiring: 0, hbOk: 0, hbTotal: 0, traces: 0,
  });
  const [loading, setLoading] = useState(true);
  const [dirty, setDirty] = useState(false);
  const [saving, setSaving] = useState(false);
  const [editing, setEditing] = useState(false);

  const loadLayout = useCallback(async () => {
    const r = await lensRun<{ panels: Panel[]; isDefault: boolean }>('system', 'dashboard-load', {});
    if (r.data.ok && r.data.result) {
      setPanels(r.data.result.panels);
      setIsDefault(r.data.result.isDefault);
    }
    setLoading(false);
  }, []);

  const loadLive = useCallback(async () => {
    const m = await lensRun<{ samples: Sample[] }>('system', 'metrics', { limit: 30 });
    if (m.data.ok && m.data.result) setSamples(m.data.result.samples);
    const ls = await lensRun<{ alerts: { firing: number }; heartbeats: { total: number; ok: number }; traceCount: number }>('system', 'live-status', {});
    if (ls.data.ok && ls.data.result) {
      setCounts({
        alertsFiring: ls.data.result.alerts.firing,
        hbOk: ls.data.result.heartbeats.ok,
        hbTotal: ls.data.result.heartbeats.total,
        traces: ls.data.result.traceCount,
      });
    }
  }, []);

  useEffect(() => {
    loadLayout();
    loadLive();
  }, [loadLayout, loadLive]);

  useEffect(() => {
    if (!live) return;
    const t = setInterval(loadLive, 15_000);
    return () => clearInterval(t);
  }, [live, loadLive]);

  const save = useCallback(async () => {
    setSaving(true);
    const r = await lensRun('system', 'dashboard-save', { panels });
    if (r.data.ok) { setDirty(false); setIsDefault(false); }
    setSaving(false);
  }, [panels]);

  const reset = useCallback(async () => {
    setSaving(true);
    await lensRun('system', 'dashboard-reset', {});
    await loadLayout();
    setDirty(false);
    setSaving(false);
  }, [loadLayout]);

  const addPanel = () => {
    setPanels((p) => [
      ...p,
      { id: `p_${Date.now().toString(36)}`, kind: 'metric', metric: 'cpuPct', title: 'CPU %', w: 1 },
    ]);
    setDirty(true);
  };
  const removePanel = (id: string) => { setPanels((p) => p.filter((x) => x.id !== id)); setDirty(true); };
  const updatePanel = (id: string, patch: Partial<Panel>) => {
    setPanels((p) => p.map((x) => (x.id === id ? { ...x, ...patch } : x)));
    setDirty(true);
  };

  if (loading) {
    return (
      <div className="flex items-center gap-2 px-4 py-8 text-sm text-cyan-600">
        <Loader2 className="h-4 w-4 animate-spin" aria-hidden /> Loading dashboard layout…
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-center gap-2 text-sm text-cyan-300">
          <LayoutDashboard className="h-4 w-4" aria-hidden />
          <span>{isDefault ? 'Default layout' : 'Custom layout'}</span>
          <span className="text-cyan-700">· {panels.length} panels</span>
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={() => setEditing((e) => !e)}
            className={`rounded border px-2.5 py-1.5 text-xs ${editing ? 'border-cyan-500 bg-cyan-800/40 text-cyan-100' : 'border-cyan-700/50 bg-cyan-900/20 text-cyan-200'} hover:bg-cyan-800/40`}
          >
            {editing ? 'Done editing' : 'Edit panels'}
          </button>
          {editing && (
            <button
              onClick={addPanel}
              className="inline-flex items-center gap-1.5 rounded border border-cyan-700/50 bg-cyan-900/20 px-2.5 py-1.5 text-xs text-cyan-200 hover:bg-cyan-800/40"
            >
              <Plus className="h-3 w-3" aria-hidden /> Add
            </button>
          )}
          <button
            onClick={save}
            disabled={!dirty || saving}
            className="inline-flex items-center gap-1.5 rounded border border-emerald-700/50 bg-emerald-900/20 px-2.5 py-1.5 text-xs text-emerald-200 hover:bg-emerald-800/40 disabled:opacity-40"
          >
            {saving ? <Loader2 className="h-3 w-3 animate-spin" aria-hidden /> : <Save className="h-3 w-3" aria-hidden />} Save
          </button>
          <button
            onClick={reset}
            disabled={saving}
            className="inline-flex items-center gap-1.5 rounded border border-cyan-700/50 bg-cyan-900/20 px-2.5 py-1.5 text-xs text-cyan-200 hover:bg-cyan-800/40 disabled:opacity-40"
          >
            <RotateCcw className="h-3 w-3" aria-hidden /> Reset
          </button>
        </div>
      </div>

      <div className="grid grid-cols-1 gap-3 md:grid-cols-2 lg:grid-cols-3">
        {panels.map((panel) => (
          <div
            key={panel.id}
            className={`rounded-lg border border-cyan-900/40 bg-cyan-950/10 p-3 ${
              panel.w === 3 ? 'md:col-span-2 lg:col-span-3' : panel.w === 2 ? 'md:col-span-2 lg:col-span-2' : ''
            }`}
          >
            <div className="mb-2 flex items-center justify-between gap-2">
              <h4 className="truncate text-xs font-semibold text-cyan-300">{panel.title}</h4>
              {editing && (
                <button
                  onClick={() => removePanel(panel.id)}
                  className="text-cyan-700 hover:text-rose-400"
                  aria-label={`Remove ${panel.title}`}
                >
                  <Trash2 className="h-3.5 w-3.5" aria-hidden />
                </button>
              )}
            </div>

            {editing && (
              <div className="mb-2 flex flex-wrap gap-1.5">
                <select
                  value={panel.kind}
                  onChange={(e) => updatePanel(panel.id, { kind: e.target.value as PanelKind })}
                  className="rounded border border-cyan-900/40 bg-cyan-950/30 px-1.5 py-1 text-[10px] text-cyan-200"
                  aria-label="Panel kind"
                >
                  {KIND_OPTS.map((k) => <option key={k.kind} value={k.kind}>{k.label}</option>)}
                </select>
                {panel.kind === 'metric' && (
                  <select
                    value={panel.metric}
                    onChange={(e) => {
                      const mk = e.target.value as MetricKey;
                      updatePanel(panel.id, { metric: mk, title: METRIC_LABELS[mk] });
                    }}
                    className="rounded border border-cyan-900/40 bg-cyan-950/30 px-1.5 py-1 text-[10px] text-cyan-200"
                    aria-label="Metric"
                  >
                    {(Object.keys(METRIC_LABELS) as MetricKey[]).map((m) => (
                      <option key={m} value={m}>{METRIC_LABELS[m]}</option>
                    ))}
                  </select>
                )}
                <select
                  value={panel.w}
                  onChange={(e) => updatePanel(panel.id, { w: parseInt(e.target.value, 10) })}
                  className="rounded border border-cyan-900/40 bg-cyan-950/30 px-1.5 py-1 text-[10px] text-cyan-200"
                  aria-label="Panel width"
                >
                  <option value={1}>1 wide</option>
                  <option value={2}>2 wide</option>
                  <option value={3}>3 wide</option>
                </select>
              </div>
            )}

            <PanelBody panel={panel} samples={samples} counts={counts} />
          </div>
        ))}
        {panels.length === 0 && (
          <div className="col-span-full rounded-lg border border-cyan-900/30 bg-cyan-950/10 px-4 py-8 text-center text-sm text-cyan-600">
            No panels. Click <strong className="text-cyan-300">Edit panels → Add</strong> to build a dashboard.
          </div>
        )}
      </div>
    </div>
  );
}

function PanelBody({ panel, samples, counts }: {
  panel: Panel;
  samples: Sample[];
  counts: { alertsFiring: number; hbOk: number; hbTotal: number; traces: number };
}) {
  if (panel.kind === 'metric' && panel.metric) {
    const mk = panel.metric;
    const data = samples.map((s) => ({
      t: new Date(s.ts).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' }),
      v: s[mk],
    }));
    const latest = data.length ? data[data.length - 1].v : 0;
    return (
      <div>
        <div className="mb-1 font-mono text-lg font-semibold text-cyan-100">{latest}</div>
        <ChartKit
          kind="area"
          data={data}
          xKey="t"
          series={[{ key: 'v', label: METRIC_LABELS[mk], color: '#06b6d4' }]}
          height={120}
          showLegend={false}
        />
      </div>
    );
  }
  if (panel.kind === 'alerts') {
    return (
      <BigNumber
        value={counts.alertsFiring}
        label="alerts firing"
        tone={counts.alertsFiring > 0 ? 'bad' : 'ok'}
      />
    );
  }
  if (panel.kind === 'heartbeats') {
    return (
      <BigNumber
        value={`${counts.hbOk}/${counts.hbTotal}`}
        label="heartbeats healthy"
        tone={counts.hbTotal > 0 && counts.hbOk === counts.hbTotal ? 'ok' : 'warn'}
      />
    );
  }
  return <BigNumber value={counts.traces} label="traces recorded" tone="neutral" />;
}

function BigNumber({ value, label, tone }: { value: string | number; label: string; tone: 'ok' | 'warn' | 'bad' | 'neutral' }) {
  const cls = tone === 'bad' ? 'text-rose-300' : tone === 'warn' ? 'text-yellow-300' : tone === 'ok' ? 'text-emerald-300' : 'text-cyan-100';
  return (
    <div className="flex flex-col items-center justify-center py-6">
      <div className={`font-mono text-3xl font-bold ${cls}`}>{value}</div>
      <div className="mt-1 text-[10px] uppercase tracking-wider text-cyan-700">{label}</div>
    </div>
  );
}
