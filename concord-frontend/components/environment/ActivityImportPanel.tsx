'use client';

/**
 * ActivityImportPanel — bulk activity-data import from utility bills /
 * spreadsheets. Accepts a pasted/uploaded CSV (factorKey,amount,date,
 * facility,category) and routes it through environment.activities-import,
 * which validates each row against a real EPA factor key. Rows that fail
 * validation are surfaced, not silently dropped. No sample data — the
 * panel is empty until the user supplies real rows.
 */

import { useCallback, useRef, useState } from 'react';
import { Upload, Loader2, FileSpreadsheet, CheckCircle2, AlertTriangle } from 'lucide-react';
import { lensRun } from '@/lib/api/client';
import { cn } from '@/lib/utils';

interface ParsedRow {
  factorKey: string;
  amount: number;
  date: string;
  facility: string;
  category: string;
}

interface ImportResult {
  importedCount: number;
  errorCount: number;
  rowsReceived: number;
  totalTonnesImported: number;
  errors: Array<{ row: number; error: string }>;
}

const CSV_HEADER = 'factorKey,amount,date,facility,category';

function parseCsv(text: string): { rows: ParsedRow[]; parseErrors: string[] } {
  const lines = text
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter(Boolean);
  if (lines.length === 0) return { rows: [], parseErrors: ['File is empty'] };
  let startIdx = 0;
  const first = lines[0].toLowerCase();
  if (first.includes('factorkey')) startIdx = 1;
  const rows: ParsedRow[] = [];
  const parseErrors: string[] = [];
  for (let i = startIdx; i < lines.length; i++) {
    const cols = lines[i].split(',').map((c) => c.trim().replace(/^"|"$/g, ''));
    if (cols.length < 2) {
      parseErrors.push(`Line ${i + 1}: needs at least factorKey,amount`);
      continue;
    }
    const amount = Number(cols[1]);
    if (!Number.isFinite(amount)) {
      parseErrors.push(`Line ${i + 1}: amount "${cols[1]}" is not a number`);
      continue;
    }
    rows.push({
      factorKey: cols[0],
      amount,
      date: cols[2] || new Date().toISOString().slice(0, 10),
      facility: cols[3] || '',
      category: cols[4] || '',
    });
  }
  return { rows, parseErrors };
}

export function ActivityImportPanel({ onImported }: { onImported?: () => void }) {
  const [csvText, setCsvText] = useState('');
  const [batchLabel, setBatchLabel] = useState('');
  const [result, setResult] = useState<ImportResult | null>(null);
  const [parseErrors, setParseErrors] = useState<string[]>([]);
  const [loading, setLoading] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);

  const { rows, parseErrors: liveParseErrors } = parseCsv(csvText);

  const handleFile = useCallback((file: File) => {
    const reader = new FileReader();
    reader.onload = () => setCsvText(String(reader.result || ''));
    reader.readAsText(file);
  }, []);

  const runImport = useCallback(async () => {
    if (rows.length === 0) {
      setParseErrors(liveParseErrors.length ? liveParseErrors : ['No valid rows to import']);
      return;
    }
    setParseErrors(liveParseErrors);
    setLoading(true);
    setResult(null);
    try {
      const r = await lensRun('environment', 'activities-import', {
        rows,
        batchLabel: batchLabel || `import-${new Date().toISOString().slice(0, 10)}`,
      });
      if (r.data?.ok) {
        setResult(r.data.result as ImportResult);
        onImported?.();
      } else {
        setParseErrors([r.data?.error || 'Import failed']);
      }
    } catch (e) {
      console.error('[ActivityImport] failed', e);
      setParseErrors(['Import request failed']);
    } finally {
      setLoading(false);
    }
  }, [rows, liveParseErrors, batchLabel, onImported]);

  return (
    <div className="bg-[#0d1117] border border-emerald-500/20 rounded-lg overflow-hidden">
      <header className="px-4 py-2 border-b border-white/10 flex items-center gap-2">
        <FileSpreadsheet className="w-4 h-4 text-emerald-400" />
        <span className="text-xs uppercase font-semibold text-gray-300 tracking-wider">
          Bulk activity import
        </span>
        <span className="ml-auto text-[10px] text-gray-400">
          {rows.length} valid row{rows.length === 1 ? '' : 's'} parsed
        </span>
      </header>

      <div className="p-3 space-y-3">
        <div className="text-[10px] text-gray-400">
          Paste CSV rows from a utility bill export or spreadsheet. Columns:{' '}
          <code className="text-emerald-400">{CSV_HEADER}</code>. Each{' '}
          <code className="text-emerald-400">factorKey</code> must match a real EPA
          emission factor.
        </div>

        <div className="flex items-center gap-2">
          <input
            ref={fileRef}
            type="file"
            accept=".csv,text/csv,text/plain"
            className="hidden"
            onChange={(e) => {
              const f = e.target.files?.[0];
              if (f) handleFile(f);
            }}
          />
          <button
            onClick={() => fileRef.current?.click()}
            className="px-2.5 py-1.5 text-xs rounded bg-white/5 text-emerald-300 hover:bg-white/10 inline-flex items-center gap-1"
          >
            <Upload className="w-3 h-3" /> Upload CSV
          </button>
          <button
            onClick={() => setCsvText((prev) => (prev ? prev : `${CSV_HEADER}\n`))}
            className="px-2.5 py-1.5 text-xs rounded bg-white/5 text-gray-400 hover:bg-white/10"
          >
            Insert header row
          </button>
          <input
            value={batchLabel}
            onChange={(e) => setBatchLabel(e.target.value)}
            placeholder="Batch label (e.g. Q1 utility bills)"
            className="flex-1 px-2 py-1.5 text-xs bg-lattice-deep border border-lattice-border rounded text-white"
          />
        </div>

        <textarea
          value={csvText}
          onChange={(e) => setCsvText(e.target.value)}
          rows={6}
          placeholder={CSV_HEADER}
          className="w-full px-2 py-1.5 text-xs font-mono bg-lattice-deep border border-lattice-border rounded text-white resize-y"
        />

        {liveParseErrors.length > 0 && (
          <div className="rounded border border-amber-500/30 bg-amber-500/5 p-2">
            <div className="text-[10px] uppercase tracking-wider text-amber-300 mb-1">
              {liveParseErrors.length} row{liveParseErrors.length === 1 ? '' : 's'} could
              not be parsed
            </div>
            <ul className="space-y-0.5">
              {liveParseErrors.slice(0, 8).map((e, i) => (
                <li key={i} className="text-[10px] text-amber-200/80">
                  {e}
                </li>
              ))}
            </ul>
          </div>
        )}

        <button
          onClick={runImport}
          disabled={loading || rows.length === 0}
          className="px-3 py-1.5 text-xs rounded bg-emerald-500 text-black font-bold hover:bg-emerald-400 disabled:opacity-40 inline-flex items-center gap-1"
        >
          {loading ? (
            <Loader2 className="w-3 h-3 animate-spin" />
          ) : (
            <Upload className="w-3 h-3" />
          )}
          Import {rows.length} row{rows.length === 1 ? '' : 's'}
        </button>

        {parseErrors.length > 0 && !result && (
          <div className="text-[10px] text-rose-400">{parseErrors.join(' · ')}</div>
        )}

        {result && (
          <div className="rounded-md border border-white/10 bg-white/[0.02] p-3 space-y-2">
            <div className="flex items-center gap-3 text-xs">
              <span className="inline-flex items-center gap-1 text-emerald-300">
                <CheckCircle2 className="w-3.5 h-3.5" />
                {result.importedCount} imported
              </span>
              {result.errorCount > 0 && (
                <span className="inline-flex items-center gap-1 text-rose-300">
                  <AlertTriangle className="w-3.5 h-3.5" />
                  {result.errorCount} rejected
                </span>
              )}
              <span className="ml-auto font-mono text-emerald-300">
                {result.totalTonnesImported.toFixed(2)} tCO₂e added
              </span>
            </div>
            {result.errors.length > 0 && (
              <ul className="space-y-0.5 max-h-40 overflow-y-auto">
                {result.errors.map((e, i) => (
                  <li
                    key={i}
                    className={cn('text-[10px] text-rose-300/90 flex gap-2')}
                  >
                    <span className="font-mono text-gray-400">row {e.row}</span>
                    <span>{e.error}</span>
                  </li>
                ))}
              </ul>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

export default ActivityImportPanel;
