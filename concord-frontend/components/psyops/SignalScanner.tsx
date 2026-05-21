'use client';

import { useState } from 'react';
import { Radar, Plus, Trash2, Loader2 } from 'lucide-react';
import { lensRun } from '@/lib/api/client';
import { ChartKit } from '@/components/viz';
import type { ScanResult, ScanSample } from './types';
import { SIGNAL_LABELS } from './types';

interface ScannerRow {
  entityId: string;
  value: string;
}

const SIGNALS = ['skill_divergence', 'economy', 'content', 'network'];

const BLANK: ScannerRow = { entityId: '', value: '' };

/**
 * SignalScanner — multi-signal anomaly detection input. The operator
 * supplies a real population of signal samples (entity + numeric value);
 * the backend computes genuine z-scores and files alerts past the rule's
 * sigma threshold. No mock data — every value is operator-entered.
 */
export function SignalScanner({ onScanned }: { onScanned: () => void }) {
  const [signal, setSignal] = useState(SIGNALS[0]);
  const [rows, setRows] = useState<ScannerRow[]>([{ ...BLANK }, { ...BLANK }, { ...BLANK }]);
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<ScanResult | null>(null);
  const [err, setErr] = useState<string | null>(null);

  const setRow = (i: number, patch: Partial<ScannerRow>) => {
    setRows((prev) => prev.map((r, idx) => (idx === i ? { ...r, ...patch } : r)));
  };

  const scan = async () => {
    setErr(null);
    setResult(null);
    const samples: ScanSample[] = rows
      .map((r) => ({ entityId: r.entityId.trim(), value: Number(r.value) }))
      .filter((r) => r.entityId && Number.isFinite(r.value));
    if (samples.length < 2) {
      setErr('Enter at least 2 entities with numeric values.');
      return;
    }
    setBusy(true);
    const r = await lensRun<ScanResult>('psyops', 'scan_signal', { signal, samples });
    setBusy(false);
    if (r.data?.ok && r.data.result) {
      setResult(r.data.result);
      onScanned();
    } else {
      setErr(r.data?.error || 'Scan failed.');
    }
  };

  return (
    <div className="space-y-3">
      <h2 className="flex items-center gap-2 text-sm font-semibold text-zinc-100">
        <Radar className="h-4 w-4 text-rose-400" /> Multi-signal scan
      </h2>
      <p className="text-[11px] text-zinc-500">
        Feed a sample population for any signal class. The console computes a true
        z-score per entity against the cohort and files an alert on every outlier
        above the rule&apos;s σ threshold.
      </p>

      <div className="flex flex-wrap gap-1.5">
        {SIGNALS.map((s) => (
          <button
            key={s}
            type="button"
            onClick={() => setSignal(s)}
            className={`rounded-full border px-2.5 py-1 text-[11px] transition-colors ${
              signal === s
                ? 'border-rose-500 bg-rose-500/20 text-rose-200'
                : 'border-zinc-800 bg-zinc-950 text-zinc-400 hover:border-zinc-700'
            }`}
          >
            {SIGNAL_LABELS[s] || s}
          </button>
        ))}
      </div>

      <div className="space-y-1.5">
        {rows.map((row, i) => (
          <div key={i} className="flex items-center gap-2">
            <input
              type="text"
              value={row.entityId}
              placeholder={`entity ${i + 1} (npc / wallet / id)`}
              onChange={(e) => setRow(i, { entityId: e.target.value })}
              className="flex-1 rounded border border-zinc-700 bg-zinc-900 px-2 py-1 text-xs text-zinc-100 focus:border-rose-500 focus:outline-none"
            />
            <input
              type="number"
              value={row.value}
              placeholder="value"
              onChange={(e) => setRow(i, { value: e.target.value })}
              className="w-28 rounded border border-zinc-700 bg-zinc-900 px-2 py-1 text-xs text-zinc-100 focus:border-rose-500 focus:outline-none"
            />
            <button
              type="button"
              onClick={() => setRows((prev) => (prev.length > 2 ? prev.filter((_, idx) => idx !== i) : prev))}
              disabled={rows.length <= 2}
              className="rounded p-1 text-zinc-500 hover:text-rose-400 disabled:opacity-30"
              aria-label="remove row"
            >
              <Trash2 className="h-3.5 w-3.5" />
            </button>
          </div>
        ))}
      </div>

      <div className="flex items-center gap-2">
        <button
          type="button"
          onClick={() => setRows((prev) => [...prev, { ...BLANK }])}
          className="flex items-center gap-1 rounded border border-zinc-700 bg-zinc-900 px-2 py-1 text-[11px] text-zinc-300 hover:border-zinc-600"
        >
          <Plus className="h-3 w-3" /> Add entity
        </button>
        <button
          type="button"
          onClick={() => void scan()}
          disabled={busy}
          className="flex items-center gap-1.5 rounded bg-rose-700 px-3 py-1.5 text-xs font-medium text-white hover:bg-rose-600 disabled:opacity-50"
        >
          {busy ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Radar className="h-3.5 w-3.5" />}
          {busy ? 'Scanning…' : 'Run scan'}
        </button>
      </div>

      {err && (
        <div className="rounded border border-rose-700/50 bg-rose-950/40 px-3 py-2 text-xs text-rose-200">
          {err}
        </div>
      )}

      {result && (
        <div className="space-y-2 rounded-lg border border-zinc-800 bg-zinc-950/50 p-3">
          <p className="text-xs text-zinc-300">
            Scanned <span className="font-semibold text-zinc-100">{result.scanned}</span> entities ·
            cohort mean <span className="font-mono text-zinc-100">{result.mean}</span> · σ{' '}
            <span className="font-mono text-zinc-100">{result.stddev}</span> ·{' '}
            <span className="font-semibold text-rose-300">{result.newAlerts.length}</span> new alert
            {result.newAlerts.length === 1 ? '' : 's'}
          </p>
          {result.newAlerts.length > 0 && (
            <ChartKit
              kind="bar"
              height={160}
              data={result.newAlerts.map((a) => ({
                entity: a.entityId.length > 10 ? `${a.entityId.slice(0, 10)}…` : a.entityId,
                sigma: a.sigmaAbove,
              }))}
              xKey="entity"
              series={[{ key: 'sigma', label: 'σ above baseline', color: '#ef4444' }]}
              showLegend={false}
            />
          )}
        </div>
      )}
    </div>
  );
}
