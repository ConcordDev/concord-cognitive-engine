'use client';

/**
 * AlertsPanel — surfaces the Prometheus alert rules from
 * monitoring/prometheus/alerts.yml, evaluates the locally-checkable ones
 * against the live process sample, and lets the operator acknowledge a
 * fired alert. Backed by `system.alerts` + `system.alert-ack`.
 */

import { useCallback, useEffect, useState } from 'react';
import { lensRun } from '@/lib/api/client';
import { AlertTriangle, BellOff, CheckCircle2, Loader2, Bell } from 'lucide-react';

interface Rule {
  name: string;
  severity: string;
  expr: string;
  for: string;
  summary: string;
  description: string;
  evaluable: boolean;
  firing: boolean;
  observed: string;
  acknowledged: boolean;
  ackedAt: string | null;
  ackNote: string | null;
}

interface AlertsResult {
  rules: Rule[];
  ruleCount: number;
  firingCount: number;
  firing: Rule[];
  unacknowledgedFiring: number;
  rulesFile: string | null;
}

export function AlertsPanel({ live }: { live: boolean }) {
  const [data, setData] = useState<AlertsResult | null>(null);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);

  const load = useCallback(async () => {
    const r = await lensRun<AlertsResult>('system', 'alerts', {});
    if (r.data.ok && r.data.result) {
      setData(r.data.result);
      setErr(null);
    } else {
      setErr(r.data.error || 'alerts unavailable');
    }
    setLoading(false);
  }, []);

  useEffect(() => {
    load();
    if (!live) return;
    const t = setInterval(load, 30_000);
    return () => clearInterval(t);
  }, [live, load]);

  const toggleAck = useCallback(async (rule: Rule) => {
    setBusy(rule.name);
    await lensRun('system', 'alert-ack', { name: rule.name, unack: rule.acknowledged });
    await load();
    setBusy(null);
  }, [load]);

  if (loading) {
    return (
      <div className="flex items-center gap-2 px-4 py-8 text-sm text-cyan-600">
        <Loader2 className="h-4 w-4 animate-spin" aria-hidden /> Evaluating alert rules…
      </div>
    );
  }
  if (err || !data) {
    return (
      <div className="rounded-lg border border-rose-800/40 bg-rose-950/15 px-4 py-6 text-sm text-rose-300">
        {err || 'No alert rules.'}
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-3 gap-3">
        <SummaryCard label="Rules" value={data.ruleCount} tone="neutral" />
        <SummaryCard label="Firing" value={data.firingCount} tone={data.firingCount > 0 ? 'bad' : 'ok'} />
        <SummaryCard label="Unacked firing" value={data.unacknowledgedFiring} tone={data.unacknowledgedFiring > 0 ? 'bad' : 'ok'} />
      </div>

      <ul className="space-y-2">
        {data.rules.map((rule) => (
          <li
            key={rule.name}
            className={`rounded-lg border p-3 ${
              rule.firing && !rule.acknowledged
                ? 'border-rose-700/50 bg-rose-950/20'
                : rule.firing
                  ? 'border-yellow-700/40 bg-yellow-950/15'
                  : 'border-cyan-900/40 bg-cyan-950/10'
            }`}
          >
            <div className="flex flex-wrap items-start justify-between gap-2">
              <div className="min-w-0">
                <div className="flex items-center gap-2">
                  {rule.firing
                    ? <Bell className="h-4 w-4 shrink-0 text-rose-400" aria-hidden />
                    : <CheckCircle2 className="h-4 w-4 shrink-0 text-emerald-500" aria-hidden />}
                  <span className="font-mono text-sm font-semibold text-cyan-100">{rule.name}</span>
                  <SeverityBadge severity={rule.severity} />
                  {rule.firing && (
                    <span className="rounded bg-rose-800/40 px-1.5 py-0.5 text-[10px] font-medium text-rose-200">FIRING</span>
                  )}
                  {!rule.evaluable && (
                    <span className="rounded bg-cyan-900/40 px-1.5 py-0.5 text-[10px] text-cyan-400" title="Prometheus owns evaluation">external</span>
                  )}
                </div>
                <p className="mt-1 text-xs text-cyan-400">{rule.summary || rule.description || '—'}</p>
                <p className="mt-1 font-mono text-[10px] text-cyan-700">
                  expr: {rule.expr || '—'}{rule.for ? ` · for ${rule.for}` : ''} · observed: {rule.observed}
                </p>
                {rule.acknowledged && (
                  <p className="mt-1 text-[10px] text-emerald-400">
                    Acknowledged {rule.ackedAt ? new Date(rule.ackedAt).toLocaleString() : ''}
                    {rule.ackNote ? ` — ${rule.ackNote}` : ''}
                  </p>
                )}
              </div>
              {rule.firing && (
                <button
                  onClick={() => toggleAck(rule)}
                  disabled={busy === rule.name}
                  className="inline-flex shrink-0 items-center gap-1.5 rounded border border-cyan-700/50 bg-cyan-900/20 px-2.5 py-1 text-xs text-cyan-200 hover:bg-cyan-800/40 disabled:opacity-50"
                >
                  {busy === rule.name
                    ? <Loader2 className="h-3 w-3 animate-spin" aria-hidden />
                    : rule.acknowledged
                      ? <Bell className="h-3 w-3" aria-hidden />
                      : <BellOff className="h-3 w-3" aria-hidden />}
                  {rule.acknowledged ? 'Un-ack' : 'Acknowledge'}
                </button>
              )}
            </div>
          </li>
        ))}
      </ul>
      {data.rules.length === 0 && (
        <div className="rounded-lg border border-cyan-900/30 bg-cyan-950/10 px-4 py-6 text-center text-sm text-cyan-600">
          <AlertTriangle className="mx-auto mb-2 h-5 w-5" aria-hidden />
          No alert rules found in monitoring/prometheus/alerts.yml.
        </div>
      )}
      {data.rulesFile && (
        <p className="text-[10px] text-cyan-700">Rules source: {data.rulesFile}</p>
      )}
    </div>
  );
}

function SummaryCard({ label, value, tone }: { label: string; value: number; tone: 'ok' | 'bad' | 'neutral' }) {
  const cls = tone === 'bad' ? 'border-rose-700/40 text-rose-200'
    : tone === 'ok' ? 'border-emerald-800/40 text-emerald-200'
      : 'border-cyan-900/40 text-cyan-200';
  return (
    <div className={`rounded-lg border bg-cyan-950/10 p-3 ${cls}`}>
      <div className="text-[10px] uppercase tracking-wider text-cyan-700">{label}</div>
      <div className="font-mono text-xl font-semibold">{value}</div>
    </div>
  );
}

function SeverityBadge({ severity }: { severity: string }) {
  const s = severity.toLowerCase();
  const cls = s === 'critical' ? 'bg-rose-800/40 text-rose-200'
    : s === 'warning' ? 'bg-yellow-800/40 text-yellow-200'
      : 'bg-cyan-900/40 text-cyan-300';
  return <span className={`rounded px-1.5 py-0.5 text-[10px] font-medium ${cls}`}>{severity || 'info'}</span>;
}
