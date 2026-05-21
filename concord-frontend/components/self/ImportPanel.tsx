'use client';

/**
 * ImportPanel — wearable / Apple Health / Google Fit ingestion. Accepts
 * a pasted JSON or CSV export of health samples and posts them to the
 * self.importBatch macro in one call. The macro is idempotent so
 * re-importing the same export is safe. No seed data — the textarea
 * is empty until the user pastes a real export.
 */

import { useState } from 'react';
import { lensRun } from '@/lib/api/client';
import { Upload, Loader2, FileUp } from 'lucide-react';

const VALID_METRICS = new Set([
  'steps', 'sleep_hours', 'workout_min', 'mood', 'weight_kg',
  'resting_hr', 'water_ml', 'calories', 'meditation_min', 'journal_entries',
]);

interface Sample { metric: string; value: number; at?: string; source?: string }
interface ImportResult { imported: number; skipped: number; total: number; source: string; errors: string[] }

// Parse either a JSON array of {metric,value,at?} or a CSV with a
// metric,value,at header. Returns parsed samples + any parse errors.
function parseExport(text: string): { samples: Sample[]; parseError: string | null } {
  const trimmed = text.trim();
  if (!trimmed) return { samples: [], parseError: 'Paste an export first.' };
  if (trimmed.startsWith('[') || trimmed.startsWith('{')) {
    try {
      const parsed = JSON.parse(trimmed);
      const arr = Array.isArray(parsed) ? parsed : Array.isArray(parsed.samples) ? parsed.samples : null;
      if (!arr) return { samples: [], parseError: 'JSON must be an array or { samples: [...] }.' };
      return { samples: arr as Sample[], parseError: null };
    } catch {
      return { samples: [], parseError: 'Invalid JSON.' };
    }
  }
  // CSV path
  const rows = trimmed.split(/\r?\n/).filter((r) => r.trim());
  if (rows.length < 2) return { samples: [], parseError: 'CSV needs a header row plus data.' };
  const header = rows[0].split(',').map((h) => h.trim().toLowerCase());
  const mi = header.indexOf('metric');
  const vi = header.indexOf('value');
  const ai = header.indexOf('at');
  if (mi < 0 || vi < 0) return { samples: [], parseError: 'CSV header must include metric,value.' };
  const samples: Sample[] = [];
  for (let i = 1; i < rows.length; i++) {
    const cols = rows[i].split(',');
    const s: Sample = { metric: (cols[mi] || '').trim(), value: Number(cols[vi]) };
    if (ai >= 0 && cols[ai]) s.at = cols[ai].trim();
    samples.push(s);
  }
  return { samples, parseError: null };
}

export function ImportPanel({ onImported }: { onImported: () => void }) {
  const [text, setText] = useState('');
  const [source, setSource] = useState('applehealth');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [result, setResult] = useState<ImportResult | null>(null);

  const onFile = (file: File) => {
    const reader = new FileReader();
    reader.onload = () => setText(String(reader.result ?? ''));
    reader.readAsText(file);
  };

  const submit = async () => {
    setErr(null);
    setResult(null);
    const { samples, parseError } = parseExport(text);
    if (parseError) { setErr(parseError); return; }
    if (samples.length === 0) { setErr('No samples found.'); return; }
    const unknown = samples.filter((s) => !VALID_METRICS.has(String(s.metric).toLowerCase()));
    if (unknown.length === samples.length) {
      setErr('No samples use a supported metric key.');
      return;
    }
    setBusy(true);
    try {
      const r = await lensRun<ImportResult>('self', 'importBatch', { samples, source });
      if (r.data?.ok && r.data.result) {
        setResult(r.data.result);
        onImported();
      } else {
        setErr(r.data?.error ?? 'Import failed.');
      }
    } catch { setErr('Network error.'); }
    finally { setBusy(false); }
  };

  return (
    <div className="space-y-3">
      <div className="rounded-lg border border-rose-900/40 bg-rose-950/10 p-3">
        <div className="mb-2 flex items-center gap-1.5 text-[11px] uppercase tracking-wider text-rose-700">
          <FileUp className="h-3.5 w-3.5" aria-hidden /> Health-data import
        </div>
        <p className="mb-2 text-xs text-rose-700">
          Paste a JSON array (or {'{ samples: [...] }'}) or a CSV with a <code className="text-rose-400">metric,value,at</code> header.
          Supported metrics: steps, sleep_hours, workout_min, mood, weight_kg, resting_hr, water_ml,
          calories, meditation_min, journal_entries. Re-importing the same export is safe.
        </p>
        <textarea
          value={text}
          onChange={(e) => setText(e.target.value)}
          rows={6}
          placeholder='[{"metric":"steps","value":8200,"at":"2026-05-20"}]'
          className="w-full rounded border border-rose-900/40 bg-black px-2 py-1.5 font-mono text-xs text-rose-100 placeholder:text-rose-800 focus:outline-none focus:ring-2 focus:ring-rose-400"
          aria-label="Health export data"
        />
        <div className="mt-2 flex flex-wrap items-center gap-2">
          <label className="flex cursor-pointer items-center gap-1 rounded border border-rose-900/40 px-2 py-1.5 text-xs text-rose-300 hover:text-rose-100">
            <Upload className="h-3 w-3" /> Choose file
            <input
              type="file"
              accept=".json,.csv,.txt"
              className="hidden"
              onChange={(e) => { const f = e.target.files?.[0]; if (f) onFile(f); }}
            />
          </label>
          <select
            value={source}
            onChange={(e) => setSource(e.target.value)}
            className="rounded border border-rose-900/40 bg-black px-2 py-1.5 text-xs text-rose-100"
            aria-label="Import source"
          >
            <option value="applehealth">Apple Health</option>
            <option value="googlefit">Google Fit</option>
            <option value="fitbit">Fitbit</option>
            <option value="garmin">Garmin</option>
            <option value="import">Other</option>
          </select>
          <button
            onClick={() => void submit()}
            disabled={busy}
            className="flex items-center gap-1 rounded bg-rose-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-rose-500 disabled:opacity-50"
          >
            {busy ? <Loader2 className="h-3 w-3 animate-spin" /> : <Upload className="h-3 w-3" />}
            Import
          </button>
        </div>
        {err && <p className="mt-2 text-xs text-red-400">{err}</p>}
        {result && (
          <p className="mt-2 text-xs text-emerald-400">
            Imported {result.imported}, skipped {result.skipped} (duplicates/invalid). Ledger total: {result.total}.
          </p>
        )}
      </div>
    </div>
  );
}
