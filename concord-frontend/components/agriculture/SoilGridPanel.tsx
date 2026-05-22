'use client';

// Soil-sampling grid generator + lab-result import. Generates a regular
// sampling grid over a field's bounding box, then imports lab results back
// against each grid point and shows field-level nutrient averages.

import { useCallback, useEffect, useState } from 'react';
import dynamic from 'next/dynamic';
import { Sprout, Loader2, Grid3x3, Upload } from 'lucide-react';
import { lensRun } from '@/lib/api/client';
import type { AgField } from './PrecisionAgPanel';

const MapView = dynamic(() => import('@/components/common/MapView'), { ssr: false });

interface SoilLab {
  importedAt?: string;
  ph?: number;
  organicMatterPct?: number;
  n_ppm?: number;
  p_ppm?: number;
  k_ppm?: number;
  cec?: number;
  sulfur_ppm?: number;
  zinc_ppm?: number;
}
interface GridPoint {
  pointId: string;
  row: number;
  col: number;
  lat: number;
  lng: number;
  lab: SoilLab | null;
}
interface SoilGrid {
  id: string;
  fieldId: string;
  generatedAt: string;
  pattern: string;
  dim: number;
  acresPerSample: number;
  sampleCount: number;
  points: GridPoint[];
  averages?: Record<string, number>;
  pointsWithResults?: number;
}

const NUTRIENT_LABELS: Record<string, string> = {
  ph: 'pH',
  organicMatterPct: 'OM %',
  n_ppm: 'N ppm',
  p_ppm: 'P ppm',
  k_ppm: 'K ppm',
  cec: 'CEC',
  sulfur_ppm: 'S ppm',
  zinc_ppm: 'Zn ppm',
};

// Parse a pasted lab-result batch: JSON array or CSV keyed by pointId.
function parseResults(raw: string): Record<string, unknown>[] {
  const trimmed = raw.trim();
  if (!trimmed) return [];
  if (trimmed.startsWith('[')) {
    const parsed = JSON.parse(trimmed);
    return Array.isArray(parsed) ? parsed : [];
  }
  const lines = trimmed.split(/\r?\n/).filter((l) => l.trim());
  if (lines.length < 2) return [];
  const header = lines[0].split(',').map((h) => h.trim());
  return lines.slice(1).map((line) => {
    const cells = line.split(',');
    const row: Record<string, unknown> = {};
    header.forEach((h, i) => {
      const v = (cells[i] ?? '').trim();
      row[h] = v === '' ? null : Number.isNaN(Number(v)) ? v : Number(v);
    });
    return row;
  });
}

export function SoilGridPanel({
  fields,
  fieldsLoading,
}: {
  fields: AgField[];
  fieldsLoading: boolean;
}) {
  const [fieldId, setFieldId] = useState('');
  const [grids, setGrids] = useState<SoilGrid[]>([]);
  const [loading, setLoading] = useState(false);
  const [generating, setGenerating] = useState(false);
  const [importing, setImporting] = useState(false);
  const [acresPerSample, setAcresPerSample] = useState(2.5);
  const [raw, setRaw] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [info, setInfo] = useState<string | null>(null);

  useEffect(() => {
    if (!fieldId && fields.length > 0) setFieldId(fields[0].id);
  }, [fields, fieldId]);

  const refresh = useCallback(async () => {
    if (!fieldId) {
      setGrids([]);
      return;
    }
    setLoading(true);
    try {
      const r = await lensRun('agriculture', 'soil-grids-list', { fieldId });
      if (r.data?.ok) {
        setGrids(((r.data.result as { grids?: SoilGrid[] } | null)?.grids || []) as SoilGrid[]);
      }
    } catch (e) {
      console.error('[SoilGrid] list failed', e);
    } finally {
      setLoading(false);
    }
  }, [fieldId]);

  useEffect(() => {
    refresh();
  }, [refresh]);

  async function generate() {
    if (!fieldId) return;
    setError(null);
    setInfo(null);
    setGenerating(true);
    try {
      const r = await lensRun('agriculture', 'soil-grid-generate', {
        fieldId,
        acresPerSample,
      });
      if (r.data?.ok) {
        const g = (r.data.result as { grid?: SoilGrid } | null)?.grid;
        setInfo(`Generated ${g?.sampleCount ?? 0}-point sampling grid.`);
        await refresh();
      } else {
        setError(r.data?.error || 'Grid generation failed');
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setGenerating(false);
    }
  }

  const latest = grids[0] || null;

  async function importResults() {
    if (!latest) return;
    setError(null);
    setInfo(null);
    let results: Record<string, unknown>[];
    try {
      results = parseResults(raw);
    } catch (e) {
      setError(`Could not parse lab results: ${e instanceof Error ? e.message : String(e)}`);
      return;
    }
    if (results.length === 0) {
      setError('Paste lab results keyed by pointId (JSON array or CSV).');
      return;
    }
    setImporting(true);
    try {
      const r = await lensRun('agriculture', 'soil-grid-import-results', {
        gridId: latest.id,
        results,
      });
      if (r.data?.ok) {
        const res = r.data.result as { applied?: number; unmatched?: number } | null;
        setInfo(
          `Imported ${res?.applied ?? 0} result(s)${
            res?.unmatched ? `, ${res.unmatched} unmatched pointId(s)` : ''
          }.`,
        );
        setRaw('');
        await refresh();
      } else {
        setError(r.data?.error || 'Lab-result import failed');
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setImporting(false);
    }
  }

  if (fieldsLoading) {
    return (
      <div className="flex items-center justify-center py-10 text-xs text-gray-500">
        <Loader2 className="w-4 h-4 animate-spin mr-2" /> Loading fields…
      </div>
    );
  }
  if (fields.length === 0) {
    return (
      <div className="py-10 text-center text-xs text-gray-500">
        <Sprout className="w-6 h-6 mx-auto mb-2 opacity-30" />
        No fields yet. Add a field (with coordinates) to generate a soil-sampling grid.
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-1 sm:grid-cols-[2fr_1fr_auto] gap-2">
        <select
          value={fieldId}
          onChange={(e) => setFieldId(e.target.value)}
          className="px-2 py-1.5 text-xs bg-lattice-deep border border-lattice-border rounded text-white"
        >
          {fields.map((f) => (
            <option key={f.id} value={f.id}>
              {f.name} ({f.acreage} ac)
            </option>
          ))}
        </select>
        <input
          type="number"
          step="0.5"
          value={acresPerSample}
          onChange={(e) => setAcresPerSample(Number(e.target.value))}
          placeholder="Acres / sample"
          className="px-2 py-1.5 text-xs bg-lattice-deep border border-lattice-border rounded text-white"
        />
        <button
          onClick={generate}
          disabled={generating}
          className="px-3 py-1.5 text-xs rounded bg-lime-500 text-black font-bold hover:bg-lime-400 disabled:opacity-40 inline-flex items-center justify-center gap-1"
        >
          {generating ? (
            <Loader2 className="w-3 h-3 animate-spin" />
          ) : (
            <Grid3x3 className="w-3 h-3" />
          )}
          Generate grid
        </button>
      </div>

      {error && (
        <div className="text-xs text-rose-300 bg-rose-500/10 border border-rose-500/20 rounded px-3 py-2">
          {error}
        </div>
      )}
      {info && (
        <div className="text-xs text-emerald-300 bg-emerald-500/10 border border-emerald-500/20 rounded px-3 py-2">
          {info}
        </div>
      )}

      {loading ? (
        <div className="flex items-center justify-center py-8 text-xs text-gray-500">
          <Loader2 className="w-4 h-4 animate-spin mr-2" /> Loading grids…
        </div>
      ) : !latest ? (
        <div className="py-8 text-center text-xs text-gray-500">
          No sampling grid for this field yet. Generate one above.
        </div>
      ) : (
        <div className="space-y-3">
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 text-center">
            {[
              { k: 'Sample points', v: `${latest.sampleCount}` },
              { k: 'Grid', v: `${latest.dim}×${latest.dim}` },
              { k: 'Acres / sample', v: `${latest.acresPerSample}` },
              { k: 'With lab data', v: `${latest.pointsWithResults ?? 0}` },
            ].map((m) => (
              <div key={m.k} className="rounded bg-lattice-deep px-2 py-1.5">
                <div className="text-sm font-bold text-lime-300">{m.v}</div>
                <div className="text-[10px] text-gray-500">{m.k}</div>
              </div>
            ))}
          </div>

          <MapView
            markers={latest.points.map((p) => ({
              lat: p.lat,
              lng: p.lng,
              label: p.pointId,
              popup: p.lab
                ? `pH ${p.lab.ph ?? '—'} · OM ${p.lab.organicMatterPct ?? '—'}% · P ${
                    p.lab.p_ppm ?? '—'
                  } · K ${p.lab.k_ppm ?? '—'}`
                : 'awaiting lab result',
            }))}
            className="h-72 rounded"
          />

          {latest.averages && Object.keys(latest.averages).length > 0 && (
            <div>
              <div className="text-[11px] uppercase tracking-wider text-gray-400 mb-1">
                Field-level nutrient averages
              </div>
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
                {Object.entries(latest.averages).map(([k, v]) => (
                  <div key={k} className="rounded bg-lattice-deep px-2 py-1.5 text-center">
                    <div className="text-sm font-bold text-emerald-300">{v}</div>
                    <div className="text-[10px] text-gray-500">{NUTRIENT_LABELS[k] || k}</div>
                  </div>
                ))}
              </div>
            </div>
          )}

          <div>
            <label className="text-[11px] text-gray-400 block mb-1">
              Import lab results — JSON array or CSV keyed by pointId (columns: pointId, ph,
              organicMatterPct, n_ppm, p_ppm, k_ppm, cec, sulfur_ppm, zinc_ppm)
            </label>
            <textarea
              value={raw}
              onChange={(e) => setRaw(e.target.value)}
              rows={4}
              spellCheck={false}
              placeholder={
                'pointId,ph,organicMatterPct,p_ppm,k_ppm\n' + 'S1,6.4,3.2,28,165\nS2,6.1,2.8,22,140'
              }
              className="w-full px-2 py-2 text-[11px] font-mono bg-lattice-deep border border-lattice-border rounded text-white"
            />
          </div>
          <button
            onClick={importResults}
            disabled={importing}
            className="px-3 py-1.5 text-xs rounded bg-emerald-500 text-black font-bold hover:bg-emerald-400 disabled:opacity-40 inline-flex items-center gap-1"
          >
            {importing ? (
              <Loader2 className="w-3 h-3 animate-spin" />
            ) : (
              <Upload className="w-3 h-3" />
            )}
            Import lab results
          </button>
          <div className="text-[10px] text-gray-600">
            Grid generated {new Date(latest.generatedAt).toLocaleString()}
          </div>
        </div>
      )}
    </div>
  );
}

export default SoilGridPanel;
