'use client';

/**
 * LogMetricForm — adds one real metric reading to the self ledger.
 * No seed data: the metric list is the fixed schema, every value is
 * typed by the user.
 */

import { useState } from 'react';
import { lensRun } from '@/lib/api/client';
import { Plus, Loader2 } from 'lucide-react';

const METRIC_OPTIONS: { key: string; label: string; unit: string }[] = [
  { key: 'steps', label: 'Steps', unit: 'steps' },
  { key: 'sleep_hours', label: 'Sleep', unit: 'h' },
  { key: 'workout_min', label: 'Workout', unit: 'min' },
  { key: 'mood', label: 'Mood', unit: '/5' },
  { key: 'weight_kg', label: 'Weight', unit: 'kg' },
  { key: 'resting_hr', label: 'Resting HR', unit: 'bpm' },
  { key: 'water_ml', label: 'Water', unit: 'ml' },
  { key: 'calories', label: 'Calories', unit: 'kcal' },
  { key: 'meditation_min', label: 'Meditation', unit: 'min' },
  { key: 'journal_entries', label: 'Journal', unit: 'entries' },
];

export function LogMetricForm({ onLogged }: { onLogged: () => void }) {
  const [metric, setMetric] = useState(METRIC_OPTIONS[0].key);
  const [value, setValue] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const unit = METRIC_OPTIONS.find((m) => m.key === metric)?.unit ?? '';

  const submit = async () => {
    setErr(null);
    const num = Number(value);
    if (!Number.isFinite(num)) { setErr('Enter a number'); return; }
    setBusy(true);
    try {
      const r = await lensRun('self', 'logMetric', { metric, value: num });
      if (r.data?.ok) { setValue(''); onLogged(); }
      else setErr(r.data?.error ?? 'Failed to log');
    } catch { setErr('Network error'); }
    finally { setBusy(false); }
  };

  return (
    <div className="rounded-lg border border-rose-900/40 bg-rose-950/10 p-3">
      <div className="mb-2 text-[11px] uppercase tracking-wider text-rose-700">Log a reading</div>
      <div className="flex flex-wrap items-center gap-2">
        <select
          value={metric}
          onChange={(e) => setMetric(e.target.value)}
          className="rounded border border-rose-900/40 bg-black px-2 py-1.5 text-sm text-rose-100 focus:outline-none focus:ring-2 focus:ring-rose-400"
          aria-label="Metric"
        >
          {METRIC_OPTIONS.map((m) => (
            <option key={m.key} value={m.key}>{m.label}</option>
          ))}
        </select>
        <input
          type="number"
          inputMode="decimal"
          value={value}
          onChange={(e) => setValue(e.target.value)}
          onKeyDown={(e) => { if (e.key === 'Enter') void submit(); }}
          placeholder={`value (${unit})`}
          className="w-32 rounded border border-rose-900/40 bg-black px-2 py-1.5 text-sm text-rose-100 placeholder:text-rose-800 focus:outline-none focus:ring-2 focus:ring-rose-400"
          aria-label="Value"
        />
        <button
          onClick={() => void submit()}
          disabled={busy}
          className="flex items-center gap-1 rounded bg-rose-600 px-3 py-1.5 text-sm font-medium text-white transition-colors hover:bg-rose-500 disabled:opacity-50"
        >
          {busy ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Plus className="h-3.5 w-3.5" />}
          Log
        </button>
      </div>
      {err && <p className="mt-2 text-xs text-red-400">{err}</p>}
    </div>
  );
}
