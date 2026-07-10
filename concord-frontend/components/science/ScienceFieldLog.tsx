'use client';

import { useState } from 'react';
import { MapPin, Plus, Trash2, Download, Layers } from 'lucide-react';
import { lensRun } from '@/lib/api/client';
import { cn } from '@/lib/utils';
import { RunButton } from '@/components/science/ScienceWorkbench';

interface ObsRow { date: string; observer: string; type: string; notes: string; lat: string; lon: string }

interface ExportResult { format: string; records: number; data: unknown; exportedAt: string }
interface ClusterResult { clusters: Array<{ id: number; observations: number; center: { lat: number; lon: number } }>; totalObservations: number; radiusKm: number }

const emptyRow = (): ObsRow => ({ date: '', observer: '', type: '', notes: '', lat: '', lon: '' });

/**
 * Field observation log — GPS-tagged field records exported (CSV/GeoJSON)
 * or spatially clustered via the dataExport / spatialCluster macros
 * (server/domains/science.js). These two macros previously had zero
 * frontend caller anywhere in the lens; the "Action Result" panel in
 * app/lenses/science/page.tsx had dead render blocks for their output
 * shapes but no button ever triggered them.
 */
export function ScienceFieldLog() {
  const [rows, setRows] = useState<ObsRow[]>([emptyRow()]);
  const [format, setFormat] = useState<'csv' | 'geojson'>('csv');
  const [radiusKm, setRadiusKm] = useState('1');
  const [busy, setBusy] = useState<'export' | 'cluster' | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [exportResult, setExportResult] = useState<ExportResult | null>(null);
  const [clusterResult, setClusterResult] = useState<ClusterResult | null>(null);

  const setRow = (i: number, patch: Partial<ObsRow>) =>
    setRows((rs) => rs.map((r, j) => (j === i ? { ...r, ...patch } : r)));

  const observations = () =>
    rows
      .filter((r) => r.date.trim() || r.notes.trim() || (r.lat.trim() && r.lon.trim()))
      .map((r) => ({
        date: r.date || undefined,
        observer: r.observer || undefined,
        type: r.type || undefined,
        notes: r.notes || undefined,
        gps: r.lat.trim() && r.lon.trim() ? { lat: Number(r.lat), lon: Number(r.lon) } : undefined,
      }));

  const runExport = async () => {
    const obs = observations();
    if (!obs.length) { setError('Add at least one observation'); return; }
    setBusy('export'); setError(null); setExportResult(null);
    const r = await lensRun<ExportResult>('science', 'dataExport', { observations: obs, format });
    if (r.data?.ok && r.data.result) setExportResult(r.data.result);
    else setError(r.data?.error || 'Export failed');
    setBusy(null);
  };

  const runCluster = async () => {
    const obs = observations();
    const withGps = obs.filter((o) => o.gps);
    if (!withGps.length) { setError('Add at least one observation with lat/lon'); return; }
    setBusy('cluster'); setError(null); setClusterResult(null);
    const r = await lensRun<ClusterResult>('science', 'spatialCluster', { observations: obs, radiusKm: Number(radiusKm) || 1 });
    if (r.data?.ok && r.data.result) setClusterResult(r.data.result);
    else setError(r.data?.error || 'Spatial cluster failed');
    setBusy(null);
  };

  const download = () => {
    if (!exportResult) return;
    let content: string;
    let mime: string;
    let ext: string;
    if (exportResult.format === 'geojson') {
      content = JSON.stringify(exportResult.data, null, 2);
      mime = 'application/geo+json';
      ext = 'geojson';
    } else {
      // Honest CSV: build real comma-separated text from the returned
      // observation array (the macro's non-geojson branch returns the raw
      // array, not CSV text — the client converts it so the "CSV" label is
      // accurate).
      const arr = Array.isArray(exportResult.data) ? exportResult.data as Record<string, unknown>[] : [];
      const headers = Array.from(arr.reduce((s, o) => { Object.keys(o).forEach((k) => s.add(k)); return s; }, new Set<string>()));
      const lines = [headers.join(','), ...arr.map((o) => headers.map((h) => {
        const v = o[h];
        return v == null ? '' : typeof v === 'object' ? JSON.stringify(v).replace(/"/g, '""') : String(v);
      }).join(','))];
      content = lines.join('\n');
      mime = 'text/csv';
      ext = 'csv';
    }
    const blob = new Blob([content], { type: mime });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `field-observations-${exportResult.exportedAt.slice(0, 10)}.${ext}`;
    a.click();
    URL.revokeObjectURL(url);
  };

  return (
    <div className="p-3 space-y-3">
      <h3 className="text-sm font-semibold text-gray-200 flex items-center gap-1.5">
        <MapPin className="w-4 h-4 text-teal-400" /> Field Observation Log
      </h3>
      <p className="text-[11px] text-gray-400">GPS-tagged field records — export as CSV/GeoJSON or find spatial clusters.</p>

      <div className="space-y-1.5">
        {rows.map((r, i) => (
          <div key={i} className="rounded border border-white/10 p-1.5 space-y-1">
            <div className="grid grid-cols-3 gap-1">
              <input type="date" value={r.date} onChange={(e) => setRow(i, { date: e.target.value })}
                className="px-1.5 py-1 text-[11px] bg-black/40 border border-white/10 rounded text-gray-100" />
              <input value={r.observer} onChange={(e) => setRow(i, { observer: e.target.value })}
                placeholder="Observer" className="px-1.5 py-1 text-[11px] bg-black/40 border border-white/10 rounded text-gray-100" />
              <input value={r.type} onChange={(e) => setRow(i, { type: e.target.value })}
                placeholder="Type" className="px-1.5 py-1 text-[11px] bg-black/40 border border-white/10 rounded text-gray-100" />
            </div>
            <div className="grid grid-cols-[1fr_auto_auto_auto] gap-1">
              <input value={r.notes} onChange={(e) => setRow(i, { notes: e.target.value })}
                placeholder="Notes" className="px-1.5 py-1 text-[11px] bg-black/40 border border-white/10 rounded text-gray-100" />
              <input value={r.lat} onChange={(e) => setRow(i, { lat: e.target.value })}
                placeholder="Lat" className="w-20 px-1.5 py-1 text-[11px] bg-black/40 border border-white/10 rounded text-gray-100 font-mono" />
              <input value={r.lon} onChange={(e) => setRow(i, { lon: e.target.value })}
                placeholder="Lon" className="w-20 px-1.5 py-1 text-[11px] bg-black/40 border border-white/10 rounded text-gray-100 font-mono" />
              <button type="button" onClick={() => setRows((rs) => rs.filter((_, j) => j !== i))}
                className="text-gray-600 hover:text-red-400" aria-label="Remove observation">
                <Trash2 className="w-3.5 h-3.5" />
              </button>
            </div>
          </div>
        ))}
        <button type="button" onClick={() => setRows((rs) => [...rs, emptyRow()])}
          className="text-[11px] text-teal-400 hover:text-teal-200">
          <Plus className="w-3 h-3 inline" /> Add observation
        </button>
      </div>

      <div className="flex items-center gap-2 flex-wrap border-t border-white/10 pt-2">
        <select value={format} onChange={(e) => setFormat(e.target.value as typeof format)}
          className="px-2 py-1.5 text-xs bg-black/40 border border-white/10 rounded text-gray-100">
          <option value="csv">CSV</option>
          <option value="geojson">GeoJSON</option>
        </select>
        <RunButton onClick={runExport} busy={busy === 'export'}>
          <Download className="w-3 h-3" /> Export
        </RunButton>
        <input type="number" min="0.1" step="0.1" value={radiusKm} onChange={(e) => setRadiusKm(e.target.value)}
          className="w-20 px-2 py-1.5 text-xs bg-black/40 border border-white/10 rounded text-gray-100 font-mono" title="Cluster radius (km)" />
        <RunButton onClick={runCluster} busy={busy === 'cluster'}>
          <Layers className="w-3 h-3" /> Spatial Cluster
        </RunButton>
      </div>

      {error && <p className="text-xs text-red-400">{error}</p>}

      {exportResult && (
        <div className="rounded border border-teal-500/20 bg-teal-500/5 p-2.5 flex items-center justify-between text-xs">
          <span className="text-gray-300">{exportResult.records} record(s) exported ({exportResult.format})</span>
          <button type="button" onClick={download}
            className={cn('inline-flex items-center gap-1 px-2 py-0.5 rounded border border-teal-500/40 text-teal-200')}>
            <Download className="w-3 h-3" /> Download
          </button>
        </div>
      )}

      {clusterResult && (
        <div className="rounded border border-teal-500/20 bg-teal-500/5 p-2.5 text-xs space-y-1">
          <p className="text-gray-300">
            {clusterResult.clusters.length} cluster(s) from {clusterResult.totalObservations} observation(s) within {clusterResult.radiusKm}km
          </p>
          <ul className="space-y-0.5">
            {clusterResult.clusters.map((c) => (
              <li key={c.id} className="font-mono text-[10px] text-gray-400">
                Cluster {c.id}: {c.observations} obs · center ({c.center.lat.toFixed(3)}, {c.center.lon.toFixed(3)})
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}

export default ScienceFieldLog;
