'use client';


/**
 * SentinelMonitors — continuous-monitoring configs + the alert inbox.
 * Creates scheduled-scan monitors, runs a monitor pass against the live
 * shield.threats feed, and surfaces generated alerts. Wires
 * sentinel.monitor.* + sentinel.alerts.*.
 */

import { useCallback, useEffect, useState } from 'react';
import { lensRun } from '@/lib/api/client';
import {
  Radio, Loader2, Play, Power, Trash2, BellRing, Check, Plus,
} from 'lucide-react';

const SEVERITIES = ['low', 'medium', 'high', 'critical'] as const;

interface Monitor {
  monitorId: string;
  name: string;
  scope: string;
  minSeverity: string;
  intervalMinutes: number;
  enabled: boolean;
  runCount: number;
  alertCount: number;
  lastRunAt: string | null;
  nextRunAt: string;
  createdAt: string;
}
interface Alert {
  alertId: string;
  monitorId: string;
  monitorName: string;
  threatId: string;
  severity: string;
  description: string;
  at: string;
  acknowledged: boolean;
}
interface ShieldThreat {
  id: string;
  severity?: string;
  description?: string;
  subtype?: string;
}

export function SentinelMonitors({ onChanged }: { onChanged?: () => void }) {
  const [monitors, setMonitors] = useState<Monitor[]>([]);
  const [alerts, setAlerts] = useState<Alert[]>([]);
  const [unack, setUnack] = useState(0);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [runStatus, setRunStatus] = useState<string | null>(null);

  const [name, setName] = useState('');
  const [minSeverity, setMinSeverity] = useState<(typeof SEVERITIES)[number]>('medium');
  const [intervalMin, setIntervalMin] = useState(60);

  const load = useCallback(async () => {
    setLoading(true);
    const [mRes, aRes] = await Promise.all([
      lensRun('sentinel', 'monitor.list', {}),
      lensRun('sentinel', 'alerts.list', {}),
    ]);
    const mr = mRes.data?.result as { monitors?: Monitor[] } | null;
    const ar = aRes.data?.result as { alerts?: Alert[]; unacknowledged?: number } | null;
    setMonitors(mr?.monitors ?? []);
    setAlerts(ar?.alerts ?? []);
    setUnack(ar?.unacknowledged ?? 0);
    setLoading(false);
  }, []);

  useEffect(() => { load(); }, [load]);

  async function createMonitor() {
    if (!name.trim()) return;
    setBusy(true);
    await lensRun('sentinel', 'monitor.create', {
      name: name.trim(),
      minSeverity,
      intervalMinutes: intervalMin,
    });
    setName('');
    await load();
    setBusy(false);
    onChanged?.();
  }

  async function toggle(m: Monitor) {
    setBusy(true);
    await lensRun('sentinel', 'monitor.toggle', { monitorId: m.monitorId, enabled: !m.enabled });
    await load();
    setBusy(false);
  }

  async function remove(m: Monitor) {
    setBusy(true);
    await lensRun('sentinel', 'monitor.delete', { monitorId: m.monitorId });
    await load();
    setBusy(false);
  }

  async function runMonitor(m: Monitor) {
    setBusy(true);
    setRunStatus(null);
    // Pull the live threat feed and feed it to the monitor pass.
    const tRes = await lensRun('shield', 'threats', { limit: 100 });
    const threats = ((tRes.data?.result as { threats?: ShieldThreat[] } | null)?.threats) ?? [];
    const r = await lensRun('sentinel', 'monitor.run', { monitorId: m.monitorId, threats });
    const res = r.data?.result as { newCount?: number; scanned?: number } | null;
    setRunStatus(
      r.data?.ok
        ? `${m.name}: scanned ${res?.scanned ?? 0} threats, ${res?.newCount ?? 0} new alert(s)`
        : r.data?.error || 'monitor run failed',
    );
    await load();
    setBusy(false);
    onChanged?.();
  }

  async function acknowledge(alertId: string) {
    setBusy(true);
    await lensRun('sentinel', 'alerts.acknowledge', { alertId });
    await load();
    setBusy(false);
  }

  async function acknowledgeAll() {
    setBusy(true);
    await lensRun('sentinel', 'alerts.acknowledge', { all: true });
    await load();
    setBusy(false);
  }

  return (
    <div className="grid gap-4 lg:grid-cols-2">
      <div className="space-y-3">
        <div className="rounded-lg border border-blue-900/40 bg-blue-950/10 p-4">
          <h3 className="mb-3 flex items-center gap-2 text-sm font-semibold text-blue-200">
            <Radio className="h-4 w-4" /> New monitor
          </h3>
          <div className="space-y-2">
            <input
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="Monitor name…"
              className="w-full rounded border border-blue-900/40 bg-black/40 px-2 py-1.5 text-xs text-blue-100 focus:border-blue-500 focus:outline-none"
              aria-label="Monitor name"
            />
            <div className="flex gap-2">
              <label className="flex-1 text-[10px] uppercase tracking-wider text-blue-700">
                Min severity
                <select
                  value={minSeverity}
                  onChange={(e) => setMinSeverity(e.target.value as (typeof SEVERITIES)[number])}
                  className="mt-1 w-full rounded border border-blue-900/40 bg-black/40 px-2 py-1 text-xs capitalize text-blue-100 focus:border-blue-500 focus:outline-none"
                >
                  {SEVERITIES.map((s) => <option key={s} value={s}>{s}</option>)}
                </select>
              </label>
              <label className="flex-1 text-[10px] uppercase tracking-wider text-blue-700">
                Interval (min)
                <input
                  type="number"
                  min={5}
                  max={1440}
                  value={intervalMin}
                  onChange={(e) => setIntervalMin(Number(e.target.value))}
                  className="mt-1 w-full rounded border border-blue-900/40 bg-black/40 px-2 py-1 text-xs text-blue-100 focus:border-blue-500 focus:outline-none"
                />
              </label>
            </div>
            <button
              disabled={busy || !name.trim()}
              onClick={createMonitor}
              className="inline-flex w-full items-center justify-center gap-1.5 rounded bg-blue-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-blue-500 disabled:opacity-40"
            >
              <Plus className="h-3.5 w-3.5" /> Create monitor
            </button>
          </div>
        </div>

        {loading ? (
          <p className="flex items-center gap-2 px-3 py-4 text-xs text-blue-600">
            <Loader2 className="h-4 w-4 animate-spin" /> Loading monitors…
          </p>
        ) : monitors.length === 0 ? (
          <p className="rounded border border-blue-900/30 bg-blue-950/10 px-4 py-6 text-center text-xs text-blue-600">
            No monitors yet.
          </p>
        ) : (
          <ul className="space-y-1.5">
            {monitors.map((m) => (
              <li key={m.monitorId} className="rounded border border-blue-900/30 bg-blue-950/10 px-3 py-2 text-xs">
                <div className="flex items-center gap-2">
                  <span className={`h-2 w-2 rounded-full ${m.enabled ? 'bg-emerald-400' : 'bg-zinc-600'}`} aria-hidden />
                  <span className="font-medium text-blue-100">{m.name}</span>
                  <span className="rounded bg-blue-900/40 px-1.5 py-0.5 text-[9px] capitalize text-blue-300">
                    ≥{m.minSeverity}
                  </span>
                  <span className="ml-auto text-[10px] text-blue-600">every {m.intervalMinutes}m</span>
                </div>
                <div className="mt-1 flex items-center gap-3 text-[10px] text-blue-700">
                  <span>{m.runCount} runs</span>
                  <span>{m.alertCount} alerts</span>
                  {m.lastRunAt && <span>last {new Date(m.lastRunAt).toLocaleTimeString()}</span>}
                  <div className="ml-auto flex gap-1">
                    <button
                      disabled={busy}
                      onClick={() => runMonitor(m)}
                      className="inline-flex items-center gap-1 rounded bg-blue-700/50 px-1.5 py-0.5 text-blue-100 hover:bg-blue-700/70 disabled:opacity-40"
                    >
                      <Play className="h-3 w-3" /> Run
                    </button>
                    <button
                      disabled={busy}
                      onClick={() => toggle(m)}
                      className="rounded bg-blue-950/40 px-1.5 py-0.5 text-blue-400 hover:text-blue-200 disabled:opacity-40"
                      aria-label={m.enabled ? 'Disable' : 'Enable'}
                    >
                      <Power className="h-3 w-3" />
                    </button>
                    <button
                      disabled={busy}
                      onClick={() => remove(m)}
                      className="rounded bg-blue-950/40 px-1.5 py-0.5 text-blue-400 hover:text-rose-400 disabled:opacity-40"
                      aria-label="Delete monitor"
                    >
                      <Trash2 className="h-3 w-3" />
                    </button>
                  </div>
                </div>
              </li>
            ))}
          </ul>
        )}
        {runStatus && <p className="text-[11px] text-blue-400">{runStatus}</p>}
      </div>

      <div className="rounded-lg border border-blue-900/40 bg-blue-950/10 p-4">
        <div className="mb-3 flex items-center gap-2">
          <BellRing className="h-4 w-4 text-amber-400" />
          <h3 className="text-sm font-semibold text-blue-200">Alert inbox</h3>
          {unack > 0 && (
            <span className="rounded bg-rose-900/50 px-1.5 py-0.5 text-[10px] text-rose-200">{unack} new</span>
          )}
          {unack > 0 && (
            <button
              disabled={busy}
              onClick={acknowledgeAll}
              className="ml-auto inline-flex items-center gap-1 rounded bg-blue-700/50 px-2 py-0.5 text-[10px] text-blue-100 hover:bg-blue-700/70 disabled:opacity-40"
            >
              <Check className="h-3 w-3" /> Ack all
            </button>
          )}
        </div>
        {alerts.length === 0 ? (
          <p className="py-8 text-center text-xs text-blue-700">
            No alerts. Run a monitor to generate them.
          </p>
        ) : (
          <ul className="max-h-[420px] space-y-1.5 overflow-y-auto">
            {alerts.map((a) => (
              <li
                key={a.alertId}
                className={`rounded border px-2.5 py-1.5 text-xs ${
                  a.acknowledged
                    ? 'border-blue-900/20 bg-black/20 text-blue-600'
                    : 'border-rose-700/40 bg-rose-950/20'
                }`}
              >
                <div className="flex items-center gap-2">
                  <span className="rounded bg-rose-900/40 px-1 py-0.5 text-[9px] uppercase text-rose-200">
                    {a.severity}
                  </span>
                  <span className="truncate text-blue-200">{a.description}</span>
                  {!a.acknowledged && (
                    <button
                      disabled={busy}
                      onClick={() => acknowledge(a.alertId)}
                      className="ml-auto shrink-0 rounded bg-blue-700/50 px-1.5 py-0.5 text-[9px] text-blue-100 hover:bg-blue-700/70 disabled:opacity-40"
                    >
                      Ack
                    </button>
                  )}
                </div>
                <div className="mt-0.5 flex items-center gap-2 text-[9px] text-blue-700">
                  <span>{a.monitorName}</span>
                  <span className="font-mono">{a.threatId}</span>
                  <span className="ml-auto">{new Date(a.at).toLocaleString()}</span>
                </div>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}
