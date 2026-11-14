'use client';

/**
 * LogMetricForm — adds one real metric reading to the self ledger.
 * No seed data: the metric list is the fixed schema, every value is
 * typed by the user.
 */

import { useEffect, useState } from 'react';
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
  const [recent, setRecent] = useState<Array<{ id: string; metric: string; value: number; at: string; note?: string }>>([]);
  const [confirmId, setConfirmId] = useState<string | null>(null);
  const [editId, setEditId] = useState<string | null>(null);
  const [editValue, setEditValue] = useState('');
  // FIX-self-016: the ledger was only visible as the last 8 readings with
  // no way to browse, filter or search the history the server holds.
  const [historyMetric, setHistoryMetric] = useState('');
  const [historyQuery, setHistoryQuery] = useState('');
  const [historySort, setHistorySort] = useState<'newest' | 'oldest' | 'value-desc' | 'value-asc'>('newest');

  const loadRecent = async () => {
    const r = await lensRun('self', 'readings', { limit: 200 });
    const rows = (r.data?.result?.readings || []) as Array<{ id: string; metric: string; value: number; at: string; note?: string }>;
    setRecent(rows);
  };

  const metricLabel = (key: string) => METRIC_OPTIONS.find((m) => m.key === key)?.label || key;
  const visibleHistory = recent
    .filter((row) => !historyMetric || row.metric === historyMetric)
    .filter((row) => {
      const q = historyQuery.trim().toLowerCase();
      if (!q) return true;
      return [row.metric, metricLabel(row.metric), row.note || '', String(row.at || '').slice(0, 10)]
        .some((v) => v.toLowerCase().includes(q));
    })
    .sort((a, b) => historySort === 'oldest' ? String(a.at).localeCompare(String(b.at))
      : historySort === 'value-desc' ? b.value - a.value
      : historySort === 'value-asc' ? a.value - b.value
      : String(b.at).localeCompare(String(a.at)));

  useEffect(() => { void loadRecent(); }, []);

  const unit = METRIC_OPTIONS.find((m) => m.key === metric)?.unit ?? '';

  const submit = async () => {
    setErr(null);
    const num = Number(value);
    if (!Number.isFinite(num)) { setErr('Enter a number'); return; }
    setBusy(true);
    try {
      const r = await lensRun('self', 'logMetric', { metric, value: num });
      if (r.data?.ok) { setValue(''); onLogged(); await loadRecent(); }
      else setErr(r.data?.error ?? 'Failed to log');
    } catch { setErr('Network error'); }
    finally { setBusy(false); }
  };

  return (
    <div className="rounded-lg border border-rose-900/40 bg-rose-950/10 p-3">
      <div className="mb-2 text-[11px] uppercase tracking-wider text-rose-400">Log a reading</div>
      <div className="flex flex-wrap items-center gap-2">
        <label className="text-[11px] text-rose-200">
          Metric
          <select
          value={metric}
          onChange={(e) => setMetric(e.target.value)}
          className="mt-1 block rounded border border-rose-900/40 bg-black px-2 py-1.5 text-sm text-rose-100 focus:outline-none focus:ring-2 focus:ring-rose-400"
          aria-label="Metric"
        >
          {METRIC_OPTIONS.map((m) => (
            <option key={m.key} value={m.key}>{m.label}</option>
          ))}
        </select>
        </label>
        <label className="text-[11px] text-rose-200">
          Value
        <input
          type="number"
          inputMode="decimal"
          value={value}
          onChange={(e) => setValue(e.target.value)}
          onKeyDown={(e) => { if (e.key === 'Enter') void submit(); }}
          placeholder={`value (${unit})`}
          className="w-32 rounded border border-rose-900/40 bg-black px-2 py-1.5 text-sm text-rose-100 placeholder:text-rose-400 focus:outline-none focus:ring-2 focus:ring-rose-400"
          aria-label="Value"
        />
        </label>
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
      {recent.length > 0 && (
        <div className="mt-3">
          <div className="mb-1.5 flex flex-wrap items-center gap-2">
            <span className="text-[11px] uppercase tracking-wider text-rose-400">Reading history</span>
            <select aria-label="Filter history by metric" value={historyMetric} onChange={(e) => setHistoryMetric(e.target.value)}
              className="rounded border border-rose-900/40 bg-black px-1.5 py-1 text-[11px] text-rose-100">
              <option value="">All metrics</option>
              {METRIC_OPTIONS.map((m) => <option key={m.key} value={m.key}>{m.label}</option>)}
            </select>
            <input aria-label="Search reading history" value={historyQuery} onChange={(e) => setHistoryQuery(e.target.value)} placeholder="Search metric, note, date…"
              className="min-w-[120px] flex-1 rounded border border-rose-900/40 bg-black px-1.5 py-1 text-[11px] text-rose-100 placeholder:text-rose-400" />
            <select aria-label="Sort reading history" value={historySort} onChange={(e) => setHistorySort(e.target.value as typeof historySort)}
              className="rounded border border-rose-900/40 bg-black px-1.5 py-1 text-[11px] text-rose-100">
              <option value="newest">Newest</option>
              <option value="oldest">Oldest</option>
              <option value="value-desc">Value (high first)</option>
              <option value="value-asc">Value (low first)</option>
            </select>
          </div>
          {visibleHistory.length === 0 && <p className="text-xs italic text-rose-300/70">No readings match the current filter or search.</p>}
        <ul className="space-y-1 max-h-64 overflow-y-auto">
          {visibleHistory.map((row) => (
            <li key={row.id} className="flex items-center justify-between gap-2 text-xs text-rose-200">
              {editId === row.id ? (
                <input value={editValue} onChange={(e) => setEditValue(e.target.value)} aria-label={`Edit ${row.metric}`} className="w-24 rounded border border-rose-900/40 bg-black px-1 py-0.5 text-rose-100" onBlur={async () => {
                  const n = Number(editValue);
                  const d = await lensRun('self', 'reading-update', { id: row.id, value: n });
                  if (d.data?.ok) { setEditId(null); await loadRecent(); onLogged(); }
                  else setErr(d.data?.message || d.data?.error || 'Could not update the reading');
                }} />
              ) : (
                <button type="button" onClick={() => { setEditId(row.id); setEditValue(String(row.value)); }} className="text-left">{metricLabel(row.metric)} · {row.value} <span className="text-rose-400">{String(row.at || '').slice(0, 10)}</span>{row.note ? <span className="text-rose-300/70"> · {row.note}</span> : null}</button>
              )}
              <button
                type="button"
                onClick={async () => {
                  if (confirmId !== row.id) { setConfirmId(row.id); return; }
                  const d = await lensRun('self', 'reading-delete', { id: row.id });
                  if (d.data?.ok) { setConfirmId(null); await loadRecent(); onLogged(); }
                  else setErr(d.data?.error || 'Could not delete the reading');
                }}
                className="text-rose-400 hover:text-rose-200"
              >
                {confirmId === row.id ? 'Confirm delete' : 'Delete'}
              </button>
            </li>
          ))}
        </ul>
        </div>
      )}
    </div>
  );
}
