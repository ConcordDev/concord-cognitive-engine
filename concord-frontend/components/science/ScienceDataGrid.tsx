'use client';

import { useState, useEffect, useCallback } from 'react';
import { Plus, Trash2, Save, Database, FileSpreadsheet, ArrowLeft, Target } from 'lucide-react';
import { lensRun } from '@/lib/api/client';
import { cn } from '@/lib/utils';
import { useDatasets, RunButton, type DatasetFull } from '@/components/science/ScienceWorkbench';

interface FieldStat {
  field: string; total: number; present: number; missing: number; completeness: number;
  numeric?: { min: number; max: number; mean: number; median: number; stdDev: number; q1: number; q3: number; outlierCount: number };
}
interface QualityReport {
  totalRecords: number; totalFields: number; overallCompleteness: number;
  qualityRating: string; fieldStats: Record<string, FieldStat>;
}

/**
 * Spreadsheet-style data-entry grid. Datasets persist server-side via the
 * dataset-save / dataset-update / dataset-get / dataset-delete macros.
 * No seed data — a fresh user sees an empty list and an empty grid.
 */
export function ScienceDataGrid() {
  const { datasets, loading, error, refresh } = useDatasets();
  const [editing, setEditing] = useState<DatasetFull | null>(null);
  const [columns, setColumns] = useState<string[]>([]);
  const [rows, setRows] = useState<string[][]>([]);
  const [name, setName] = useState('');
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const [quality, setQuality] = useState<QualityReport | null>(null);
  const [qualityBusy, setQualityBusy] = useState(false);

  useEffect(() => { refresh(); }, [refresh]);

  const startNew = () => {
    setEditing(null);
    setName('');
    setColumns(['Column 1', 'Column 2']);
    setRows([['', '']]);
    setMsg(null);
  };

  const openDataset = useCallback(async (id: string) => {
    setBusy(true);
    setMsg(null);
    const r = await lensRun<{ dataset: DatasetFull }>('science', 'dataset-get', { id });
    if (r.data?.ok && r.data.result?.dataset) {
      const d = r.data.result.dataset;
      setEditing(d);
      setName(d.name);
      setColumns(d.columns.map(String));
      setRows((d.rows || []).map((row) => d.columns.map((_, ci) => {
        const v = Array.isArray(row) ? row[ci] : undefined;
        return v == null ? '' : String(v);
      })));
    } else {
      setMsg(r.data?.error || 'Failed to open dataset');
    }
    setBusy(false);
  }, []);

  const addColumn = () => {
    setColumns((c) => [...c, `Column ${c.length + 1}`]);
    setRows((r) => r.map((row) => [...row, '']));
  };
  const removeColumn = (ci: number) => {
    if (columns.length <= 1) return;
    setColumns((c) => c.filter((_, i) => i !== ci));
    setRows((r) => r.map((row) => row.filter((_, i) => i !== ci)));
  };
  const renameColumn = (ci: number, v: string) =>
    setColumns((c) => c.map((col, i) => (i === ci ? v : col)));
  const addRow = () => setRows((r) => [...r, columns.map(() => '')]);
  const removeRow = (ri: number) => setRows((r) => r.filter((_, i) => i !== ri));
  const setCell = (ri: number, ci: number, v: string) =>
    setRows((r) => r.map((row, i) => (i === ri ? row.map((c, j) => (j === ci ? v : c)) : row)));

  /* coerce numeric-looking cells to numbers so charts/stats can use them */
  const coercedRows = (): unknown[][] =>
    rows.map((row) => row.map((c) => {
      const t = c.trim();
      if (t === '') return '';
      const n = Number(t);
      return Number.isFinite(n) && /^-?\d*\.?\d+(e-?\d+)?$/i.test(t) ? n : t;
    }));

  const save = async () => {
    const trimmed = name.trim();
    if (!trimmed) { setMsg('Dataset name required'); return; }
    if (columns.some((c) => !c.trim())) { setMsg('Column names cannot be empty'); return; }
    setBusy(true);
    setMsg(null);
    const payload = { name: trimmed, columns: columns.map((c) => c.trim()), rows: coercedRows() };
    const r = editing
      ? await lensRun('science', 'dataset-update', { id: editing.id, ...payload })
      : await lensRun('science', 'dataset-save', payload);
    if (r.data?.ok) {
      setMsg('Saved');
      setEditing(null);
      setColumns([]);
      setRows([]);
      setName('');
      await refresh();
    } else {
      setMsg(r.data?.error || 'Save failed');
    }
    setBusy(false);
  };

  const del = async (id: string) => {
    setBusy(true);
    const r = await lensRun('science', 'dataset-delete', { id });
    if (r.data?.ok) await refresh();
    else setMsg(r.data?.error || 'Delete failed');
    setBusy(false);
  };

  /* Data-quality report — runs against the CURRENT grid content (no save
     required), converting the columns/rows into row objects the way
     dataQualityReport (server/domains/science.js) actually reads them. */
  const runQuality = async () => {
    if (columns.length === 0 || rows.length === 0) { setMsg('Add at least one row first'); return; }
    setQualityBusy(true);
    setMsg(null);
    setQuality(null);
    const dataset = coercedRows().map((row) =>
      Object.fromEntries(columns.map((c, i) => [c.trim() || `col${i + 1}`, row[i]])));
    const r = await lensRun<QualityReport>('science', 'dataQualityReport', { dataset });
    if (r.data?.ok && r.data.result) setQuality(r.data.result);
    else setMsg(r.data?.error || 'Quality report failed');
    setQualityBusy(false);
  };

  const inGrid = editing !== null || columns.length > 0;

  if (!inGrid) {
    return (
      <div className="p-3 space-y-3">
        <div className="flex items-center justify-between">
          <h3 className="text-sm font-semibold text-gray-200 flex items-center gap-1.5">
            <Database className="w-4 h-4 text-teal-400" /> Datasets
          </h3>
          <RunButton onClick={startNew} busy={false}>
            <Plus className="w-3 h-3" /> New Dataset
          </RunButton>
        </div>
        {error && <p className="text-xs text-red-400">{error}</p>}
        {loading ? (
          <p className="text-xs text-gray-400">Loading…</p>
        ) : datasets.length === 0 ? (
          <p className="text-xs text-gray-400">No datasets yet. Create one to start entering data.</p>
        ) : (
          <ul className="space-y-1.5">
            {datasets.map((d) => (
              <li
                key={d.id}
                className="flex items-center justify-between rounded border border-white/10 bg-black/30 px-3 py-2"
              >
                <button
                  type="button"
                  onClick={() => openDataset(d.id)}
                  className="flex items-center gap-2 text-left flex-1 min-w-0"
                >
                  <FileSpreadsheet className="w-4 h-4 text-teal-400 shrink-0" />
                  <span className="min-w-0">
                    <span className="block text-xs text-gray-100 truncate">{d.name}</span>
                    <span className="block text-[10px] text-gray-400">
                      {d.columns.length} cols · {d.rowCount} rows
                    </span>
                  </span>
                </button>
                <button
                  type="button"
                  onClick={() => del(d.id)}
                  className="p-1 rounded hover:bg-red-500/10 text-gray-400 hover:text-red-400"
                  aria-label="Delete dataset"
                >
                  <Trash2 className="w-3.5 h-3.5" />
                </button>
              </li>
            ))}
          </ul>
        )}
        {msg && <p className="text-xs text-gray-400">{msg}</p>}
      </div>
    );
  }

  return (
    <div className="p-3 space-y-3">
      <div className="flex items-center gap-2">
        <button
          type="button"
          onClick={() => { setEditing(null); setColumns([]); setRows([]); setName(''); setMsg(null); }}
          className="p-1 rounded hover:bg-white/5 text-gray-400"
          aria-label="Back"
        >
          <ArrowLeft className="w-4 h-4" />
        </button>
        <input
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="Dataset name"
          className="flex-1 px-2 py-1.5 text-xs bg-black/40 border border-white/10 rounded text-gray-100"
        />
        <RunButton onClick={save} busy={busy}>
          <Save className="w-3 h-3" /> Save
        </RunButton>
      </div>

      <div className="overflow-auto border border-white/10 rounded">
        <table className="text-xs border-collapse w-full">
          <thead>
            <tr>
              <th className="w-8 bg-black/50 border border-white/5" />
              {columns.map((c, ci) => (
                <th key={ci} className="bg-black/50 border border-white/5 p-1 min-w-[110px]">
                  <div className="flex items-center gap-1">
                    <input
                      value={c}
                      onChange={(e) => renameColumn(ci, e.target.value)}
                      className="w-full px-1 py-0.5 bg-transparent text-teal-200 font-medium text-[11px] outline-none"
                    />
                    <button
                      type="button"
                      onClick={() => removeColumn(ci)}
                      className="text-gray-600 hover:text-red-400"
                      aria-label="Remove column"
                    >
                      <Trash2 className="w-3 h-3" />
                    </button>
                  </div>
                </th>
              ))}
              <th className="w-8 bg-black/50 border border-white/5">
                <button
                  type="button"
                  onClick={addColumn}
                  className="text-teal-400 hover:text-teal-200"
                  aria-label="Add column"
                >
                  <Plus className="w-3.5 h-3.5" />
                </button>
              </th>
            </tr>
          </thead>
          <tbody>
            {rows.map((row, ri) => (
              <tr key={ri}>
                <td className="bg-black/40 border border-white/5 text-center text-gray-600 text-[10px]">
                  {ri + 1}
                </td>
                {row.map((cell, ci) => (
                  <td key={ci} className="border border-white/5 p-0">
                    <input
                      value={cell}
                      onChange={(e) => setCell(ri, ci, e.target.value)}
                      className="w-full px-1.5 py-1 bg-transparent text-gray-100 font-mono text-[11px] outline-none focus:bg-teal-500/5"
                    />
                  </td>
                ))}
                <td className="border border-white/5 text-center">
                  <button
                    type="button"
                    onClick={() => removeRow(ri)}
                    className="text-gray-600 hover:text-red-400"
                    aria-label="Remove row"
                  >
                    <Trash2 className="w-3 h-3" />
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <div className="flex items-center gap-2 flex-wrap">
        <button
          type="button"
          onClick={addRow}
          className={cn(
            'inline-flex items-center gap-1 px-2 py-1 text-[11px] rounded',
            'border border-white/10 text-gray-300 hover:bg-white/5',
          )}
        >
          <Plus className="w-3 h-3" /> Add Row
        </button>
        <RunButton onClick={runQuality} busy={qualityBusy}>
          <Target className="w-3 h-3" /> Data Quality Report
        </RunButton>
      </div>

      {quality && (
        <div className="rounded border border-teal-500/20 bg-teal-500/5 p-2.5 space-y-2 text-xs">
          <div className="flex items-center justify-between">
            <span className="text-teal-200 font-semibold">
              {quality.totalRecords} record(s) · {quality.totalFields} field(s) · {quality.overallCompleteness}% complete
            </span>
            <span className={cn(
              'px-1.5 py-0.5 rounded text-[10px] uppercase',
              quality.qualityRating === 'excellent' || quality.qualityRating === 'good'
                ? 'bg-emerald-500/15 text-emerald-300' : 'bg-amber-500/15 text-amber-300',
            )}>
              {quality.qualityRating}
            </span>
          </div>
          <div className="space-y-1">
            {Object.values(quality.fieldStats).map((f) => (
              <div key={f.field} className="flex items-center gap-2 text-[11px]">
                <span className="w-24 truncate text-gray-300">{f.field}</span>
                <div className="flex-1 h-1.5 bg-black/40 rounded overflow-hidden">
                  <div className="h-full bg-teal-400" style={{ width: `${f.completeness}%` }} />
                </div>
                <span className="w-14 text-right font-mono text-gray-400">{f.completeness}%</span>
                {f.numeric && (
                  <span className="text-gray-500 font-mono">
                    μ={f.numeric.mean} σ={f.numeric.stdDev} {f.numeric.outlierCount > 0 ? `· ${f.numeric.outlierCount} outlier(s)` : ''}
                  </span>
                )}
              </div>
            ))}
          </div>
        </div>
      )}

      {msg && <p className="text-xs text-gray-400">{msg}</p>}
    </div>
  );
}

export default ScienceDataGrid;
