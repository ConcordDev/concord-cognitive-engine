'use client';

/* eslint-disable @typescript-eslint/no-explicit-any */

/**
 * WearableImportPanel — import HRV / sleep / steps readings exported from
 * a wearable (Apple Health / Whoop / Oura) instead of typing each metric
 * by hand. Accepts pasted JSON or CSV, maps the wearable field names onto
 * the metric store, and shows the sync summary + history. Wired to
 * wellness.wearable-import / wearable-sync-history.
 */

import { useCallback, useEffect, useState } from 'react';
import { Watch, Loader2, Upload, FileJson } from 'lucide-react';
import { lensRun } from '@/lib/api/client';

interface SyncSummary {
  id: string; source: string; imported: number; skipped: number;
  byType: Record<string, number>; at: string;
}
interface SyncHistory { syncs: SyncSummary[]; lastSyncAt: string | null }
interface Reading { type: string; value: number; date?: string }

const SOURCES = ['apple_health', 'whoop', 'oura', 'fitbit', 'garmin', 'wearable'];
const SAMPLE = `[
  { "type": "hrv", "value": 62, "date": "2026-05-20" },
  { "type": "sleep", "value": 7.5, "date": "2026-05-20" },
  { "type": "restingHeartRate", "value": 54, "date": "2026-05-20" },
  { "type": "steps", "value": 9100, "date": "2026-05-20" }
]`;

/** Parse pasted text as JSON array, or as CSV with a header row. */
function parseReadings(text: string): Reading[] {
  const trimmed = text.trim();
  if (!trimmed) return [];
  // JSON array
  if (trimmed.startsWith('[') || trimmed.startsWith('{')) {
    try {
      const j = JSON.parse(trimmed);
      const arr = Array.isArray(j) ? j : [j];
      return arr
        .map((row: any) => ({ type: String(row.type ?? ''), value: Number(row.value), date: row.date ? String(row.date) : undefined }))
        .filter((r: Reading) => r.type && Number.isFinite(r.value));
    } catch { return []; }
  }
  // CSV: header line then "type,value,date"
  const lines = trimmed.split('\n').map(l => l.trim()).filter(Boolean);
  if (lines.length < 2) return [];
  const header = lines[0].toLowerCase().split(',').map(h => h.trim());
  const ti = header.indexOf('type'), vi = header.indexOf('value'), di = header.indexOf('date');
  if (ti < 0 || vi < 0) return [];
  return lines.slice(1)
    .map(l => l.split(',').map(c => c.trim()))
    .map(cells => ({ type: cells[ti] ?? '', value: Number(cells[vi]), date: di >= 0 ? cells[di] : undefined }))
    .filter(r => r.type && Number.isFinite(r.value));
}

export function WearableImportPanel() {
  const [source, setSource] = useState('apple_health');
  const [raw, setRaw] = useState('');
  const [history, setHistory] = useState<SyncHistory | null>(null);
  const [lastResult, setLastResult] = useState<SyncSummary | null>(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const loadHistory = useCallback(async () => {
    const r = await lensRun({ domain: 'wellness', action: 'wearable-sync-history', input: {} });
    if (r.data?.ok && r.data.result) setHistory(r.data.result as SyncHistory);
  }, []);

  useEffect(() => { void loadHistory(); }, [loadHistory]);

  const parsed = parseReadings(raw);

  async function importNow() {
    setErr(null);
    if (parsed.length === 0) {
      setErr('No valid readings parsed. Paste JSON or CSV with type/value fields.');
      return;
    }
    setBusy(true);
    const r = await lensRun({
      domain: 'wellness', action: 'wearable-import',
      input: { source, readings: parsed },
    });
    setBusy(false);
    if (r.data?.ok && r.data.result) {
      setLastResult((r.data.result as any).summary as SyncSummary);
      setRaw('');
      await loadHistory();
    } else {
      setErr(r.data?.error || 'Import failed.');
    }
  }

  return (
    <div className="rounded-lg border border-teal-500/20 bg-zinc-950/60 p-3 space-y-3">
      <header className="flex items-center gap-2 border-b border-teal-500/10 pb-2">
        <Watch className="h-4 w-4 text-teal-400" />
        <h3 className="text-sm font-semibold text-white">Wearable data import</h3>
        {history?.lastSyncAt && (
          <span className="ml-auto text-[10px] text-zinc-500">last sync {new Date(history.lastSyncAt).toLocaleDateString()}</span>
        )}
      </header>

      <div className="rounded border border-white/10 bg-black/30 p-3 space-y-2">
        <div className="flex items-center gap-2">
          <label className="text-[10px] uppercase tracking-wider text-zinc-500 font-semibold">Source</label>
          <select value={source} onChange={e => setSource(e.target.value)}
            className="bg-zinc-900 border border-zinc-800 rounded px-2 py-1 text-[11px] text-white">
            {SOURCES.map(s => <option key={s} value={s}>{s.replace(/_/g, ' ')}</option>)}
          </select>
          <button type="button" onClick={() => setRaw(SAMPLE)}
            className="ml-auto inline-flex items-center gap-1 text-[10px] text-teal-400 hover:text-teal-300">
            <FileJson className="w-3 h-3" /> sample
          </button>
        </div>
        <textarea value={raw} onChange={e => setRaw(e.target.value)} rows={6}
          placeholder='Paste exported readings — JSON array of { "type", "value", "date" } or CSV with a type,value,date header.'
          className="w-full bg-zinc-900 border border-zinc-800 rounded px-2 py-1.5 text-[11px] text-white font-mono resize-none" />
        <div className="flex items-center gap-2">
          <span className="text-[10px] text-zinc-500">
            {parsed.length > 0 ? `${parsed.length} reading${parsed.length > 1 ? 's' : ''} parsed` : 'no readings parsed yet'}
          </span>
          <button type="button" onClick={importNow} disabled={busy || parsed.length === 0}
            className="ml-auto inline-flex items-center gap-1.5 bg-teal-600 hover:bg-teal-500 disabled:opacity-50 text-white text-xs px-3 py-1.5 rounded font-semibold">
            {busy ? <Loader2 className="w-3 h-3 animate-spin" /> : <Upload className="w-3 h-3" />}
            Import {parsed.length || ''}
          </button>
        </div>
        {err && <div className="text-[10px] text-rose-300">{err}</div>}
      </div>

      {lastResult && (
        <div className="rounded border border-teal-500/30 bg-teal-500/5 p-2.5">
          <div className="text-[11px] text-teal-200">
            Imported <span className="font-mono font-bold">{lastResult.imported}</span> · skipped{' '}
            <span className="font-mono">{lastResult.skipped}</span> from {lastResult.source.replace(/_/g, ' ')}
          </div>
          {Object.keys(lastResult.byType).length > 0 && (
            <div className="flex flex-wrap gap-1.5 mt-1.5">
              {Object.entries(lastResult.byType).map(([t, n]) => (
                <span key={t} className="text-[10px] font-mono px-1.5 py-0.5 rounded bg-teal-500/15 text-teal-300">
                  {t.replace(/_/g, ' ')} ×{n}
                </span>
              ))}
            </div>
          )}
        </div>
      )}

      {history && history.syncs.length > 0 && (
        <div>
          <div className="text-[10px] uppercase tracking-wider text-zinc-500 font-semibold mb-1">Sync history</div>
          <ul className="space-y-1">
            {history.syncs.slice(0, 6).map(s => (
              <li key={s.id} className="flex items-center gap-2 text-[11px]">
                <span className="text-zinc-300 flex-1 truncate">{s.source.replace(/_/g, ' ')}</span>
                <span className="text-emerald-300 font-mono">+{s.imported}</span>
                {s.skipped > 0 && <span className="text-zinc-500 font-mono">−{s.skipped}</span>}
                <span className="text-[10px] text-zinc-500 font-mono">{new Date(s.at).toLocaleDateString()}</span>
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}

export default WearableImportPanel;
