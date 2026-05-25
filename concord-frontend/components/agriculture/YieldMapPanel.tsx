'use client';

// Yield-map overlay from harvest-monitor data. Bins geo-tagged harvest points
// into a grid and renders a per-cell yield heatmap plus a geographic marker
// overlay. Points are real logged harvest-monitor rows or a pasted batch.

import { useCallback, useEffect, useMemo, useState } from 'react';
import dynamic from 'next/dynamic';
import { Grid3x3, Loader2, RefreshCw } from 'lucide-react';
import { lensRun } from '@/lib/api/client';
import { cn } from '@/lib/utils';
import type { AgField } from './PrecisionAgPanel';

const MapView = dynamic(() => import('@/components/common/MapView'), { ssr: false });

interface YieldCell {
  row: number;
  col: number;
  lat: number;
  lng: number;
  avgYieldPerAcre: number;
  sampleCount: number;
  relToFieldAvgPct: number;
  tier: string;
}
interface YieldMap {
  id: string;
  fieldId: string;
  builtAt: string;
  gridCells: number;
  pointCount: number;
  fieldAvgYield: number;
  fieldMinYield: number;
  fieldMaxYield: number;
  cells: YieldCell[];
}

const TIER_COLOUR: Record<string, string> = {
  high: 'bg-emerald-500',
  average: 'bg-amber-500',
  low: 'bg-rose-500',
};

// Parse a pasted harvest-monitor point batch: JSON array or CSV (lat,lng,yieldPerAcre).
function parsePoints(raw: string): Record<string, unknown>[] {
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

export function YieldMapPanel({
  fields,
  fieldsLoading,
}: {
  fields: AgField[];
  fieldsLoading: boolean;
}) {
  const [fieldId, setFieldId] = useState('');
  const [maps, setMaps] = useState<YieldMap[]>([]);
  const [loading, setLoading] = useState(false);
  const [building, setBuilding] = useState(false);
  const [raw, setRaw] = useState('');
  const [gridCells, setGridCells] = useState(12);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!fieldId && fields.length > 0) setFieldId(fields[0].id);
  }, [fields, fieldId]);

  const refresh = useCallback(async () => {
    if (!fieldId) {
      setMaps([]);
      return;
    }
    setLoading(true);
    try {
      const r = await lensRun('agriculture', 'yield-maps-list', { fieldId });
      if (r.data?.ok) {
        setMaps(((r.data.result as { maps?: YieldMap[] } | null)?.maps || []) as YieldMap[]);
      }
    } catch (e) {
      console.error('[YieldMap] list failed', e);
    } finally {
      setLoading(false);
    }
  }, [fieldId]);

  useEffect(() => {
    refresh();
  }, [refresh]);

  async function build() {
    if (!fieldId) return;
    setError(null);
    let points: Record<string, unknown>[] = [];
    if (raw.trim()) {
      try {
        points = parsePoints(raw);
      } catch (e) {
        setError(`Could not parse points: ${e instanceof Error ? e.message : String(e)}`);
        return;
      }
    }
    setBuilding(true);
    try {
      const params: Record<string, unknown> = { fieldId, gridCells };
      if (points.length > 0) params.points = points;
      const r = await lensRun('agriculture', 'yield-map-build', params);
      if (r.data?.ok) {
        setRaw('');
        await refresh();
      } else {
        setError(r.data?.error || 'Yield map build failed');
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBuilding(false);
    }
  }

  const latest = maps[0] || null;

  const gridLayout = useMemo(() => {
    if (!latest) return null;
    const maxRow = Math.max(...latest.cells.map((c) => c.row), 0);
    const maxCol = Math.max(...latest.cells.map((c) => c.col), 0);
    const lookup = new Map(latest.cells.map((c) => [`${c.row}_${c.col}`, c]));
    return { maxRow, maxCol, lookup };
  }, [latest]);

  if (fieldsLoading) {
    return (
      <div className="flex items-center justify-center py-10 text-xs text-gray-400">
        <Loader2 className="w-4 h-4 animate-spin mr-2" /> Loading fields…
      </div>
    );
  }
  if (fields.length === 0) {
    return (
      <div className="py-10 text-center text-xs text-gray-400">
        <Grid3x3 className="w-6 h-6 mx-auto mb-2 opacity-30" />
        No fields yet. Add a field to build a yield map.
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
              {f.name}
            </option>
          ))}
        </select>
        <input
          type="number"
          value={gridCells}
          onChange={(e) => setGridCells(Number(e.target.value))}
          min={4}
          max={48}
          placeholder="Grid (4–48)"
          className="px-2 py-1.5 text-xs bg-lattice-deep border border-lattice-border rounded text-white"
        />
        <button
          onClick={build}
          disabled={building}
          className="px-3 py-1.5 text-xs rounded bg-violet-500 text-white font-bold hover:bg-violet-400 disabled:opacity-40 inline-flex items-center justify-center gap-1"
        >
          {building ? (
            <Loader2 className="w-3 h-3 animate-spin" />
          ) : (
            <RefreshCw className="w-3 h-3" />
          )}
          Build map
        </button>
      </div>

      <div>
        <label className="text-[11px] text-gray-400 block mb-1">
          Harvest-monitor points — optional JSON array or CSV (lat,lng,yieldPerAcre). Blank
          uses logged harvest passes with coordinates.
        </label>
        <textarea
          value={raw}
          onChange={(e) => setRaw(e.target.value)}
          rows={4}
          spellCheck={false}
          placeholder={'lat,lng,yieldPerAcre\n41.501,-93.502,212\n41.503,-93.504,188'}
          className="w-full px-2 py-2 text-[11px] font-mono bg-lattice-deep border border-lattice-border rounded text-white"
        />
      </div>

      {error && (
        <div className="text-xs text-rose-300 bg-rose-500/10 border border-rose-500/20 rounded px-3 py-2">
          {error}
        </div>
      )}

      {loading ? (
        <div className="flex items-center justify-center py-8 text-xs text-gray-400">
          <Loader2 className="w-4 h-4 animate-spin mr-2" /> Loading maps…
        </div>
      ) : !latest ? (
        <div className="py-8 text-center text-xs text-gray-400">
          No yield map for this field yet. Log geo-tagged harvest passes or paste points, then
          build.
        </div>
      ) : (
        <div className="space-y-3">
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 text-center">
            {[
              { k: 'Field avg', v: `${latest.fieldAvgYield} bu/ac` },
              { k: 'Min', v: `${latest.fieldMinYield} bu/ac` },
              { k: 'Max', v: `${latest.fieldMaxYield} bu/ac` },
              { k: 'Points', v: `${latest.pointCount}` },
            ].map((m) => (
              <div key={m.k} className="rounded bg-lattice-deep px-2 py-1.5">
                <div className="text-sm font-bold text-violet-300">{m.v}</div>
                <div className="text-[10px] text-gray-400">{m.k}</div>
              </div>
            ))}
          </div>

          {gridLayout && (
            <div>
              <div className="text-[11px] uppercase tracking-wider text-gray-400 mb-1">
                Yield grid ({latest.gridCells}×{latest.gridCells})
              </div>
              <div
                className="grid gap-px bg-white/5 p-px rounded"
                style={{
                  gridTemplateColumns: `repeat(${gridLayout.maxCol + 1}, minmax(0,1fr))`,
                }}
              >
                {Array.from({ length: gridLayout.maxRow + 1 }).flatMap((_, r) =>
                  Array.from({ length: gridLayout.maxCol + 1 }).map((__, c) => {
                    const cell = gridLayout.lookup.get(`${r}_${c}`);
                    return (
                      <div
                        key={`${r}_${c}`}
                        title={
                          cell
                            ? `${cell.avgYieldPerAcre} bu/ac · ${cell.relToFieldAvgPct}% vs avg · ${cell.sampleCount} pts`
                            : 'no samples'
                        }
                        className={cn(
                          'aspect-square flex items-center justify-center text-[8px] font-mono',
                          cell
                            ? `${TIER_COLOUR[cell.tier] || 'bg-gray-600'} text-black/80`
                            : 'bg-lattice-deep text-gray-700',
                        )}
                      >
                        {cell ? Math.round(cell.avgYieldPerAcre) : ''}
                      </div>
                    );
                  }),
                )}
              </div>
              <div className="flex items-center gap-3 mt-1 text-[10px] text-gray-400">
                <span className="inline-flex items-center gap-1">
                  <span className="w-2.5 h-2.5 bg-emerald-500 inline-block rounded-sm" /> high
                </span>
                <span className="inline-flex items-center gap-1">
                  <span className="w-2.5 h-2.5 bg-amber-500 inline-block rounded-sm" /> average
                </span>
                <span className="inline-flex items-center gap-1">
                  <span className="w-2.5 h-2.5 bg-rose-500 inline-block rounded-sm" /> low
                </span>
              </div>
            </div>
          )}

          <MapView
            markers={latest.cells.map((cell) => ({
              lat: cell.lat,
              lng: cell.lng,
              label: `${cell.avgYieldPerAcre} bu/ac`,
              popup: `${cell.tier} · ${cell.relToFieldAvgPct}% vs field avg · ${cell.sampleCount} samples`,
            }))}
            className="h-72 rounded"
          />
          <div className="text-[10px] text-gray-400">
            Built {new Date(latest.builtAt).toLocaleString()}
          </div>
        </div>
      )}
    </div>
  );
}

export default YieldMapPanel;
