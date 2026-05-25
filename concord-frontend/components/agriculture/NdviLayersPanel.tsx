'use client';

// Satellite NDVI / vegetation-index layers. Pulls a real 30-day index time
// series derived from open Sentinel-2-class drivers (Open-Meteo archive) per
// field, persists captured layers, and charts the canopy-vigor trend.

import { useCallback, useEffect, useState } from 'react';
import { Satellite, Loader2, Trash2, RefreshCw } from 'lucide-react';
import { lensRun } from '@/lib/api/client';
import { cn } from '@/lib/utils';
import { ChartKit } from '@/components/viz/ChartKit';
import type { AgField } from './PrecisionAgPanel';

interface NdviPoint {
  date: string;
  value: number;
}
interface NdviLayer {
  id: string;
  fieldId: string;
  index: string;
  capturedAt: string;
  windowDays: number;
  avgIndex: number;
  latestIndex: number;
  peakIndex: number;
  vigorClass: string;
  series: NdviPoint[];
  source: string;
}

const INDICES = [
  { id: 'ndvi', label: 'NDVI — canopy greenness' },
  { id: 'evi', label: 'EVI — enhanced vegetation' },
  { id: 'ndre', label: 'NDRE — red-edge / late season' },
  { id: 'ndwi', label: 'NDWI — water / moisture' },
];

const VIGOR_COLOUR: Record<string, string> = {
  vigorous: 'text-emerald-300',
  moderate: 'text-lime-300',
  stressed: 'text-amber-300',
  bare: 'text-rose-300',
};

export function NdviLayersPanel({
  fields,
  fieldsLoading,
}: {
  fields: AgField[];
  fieldsLoading: boolean;
}) {
  const [fieldId, setFieldId] = useState('');
  const [index, setIndex] = useState('ndvi');
  const [layers, setLayers] = useState<NdviLayer[]>([]);
  const [loading, setLoading] = useState(false);
  const [fetching, setFetching] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!fieldId && fields.length > 0) setFieldId(fields[0].id);
  }, [fields, fieldId]);

  const refresh = useCallback(async () => {
    if (!fieldId) {
      setLayers([]);
      return;
    }
    setLoading(true);
    try {
      const r = await lensRun('agriculture', 'satellite-ndvi-list', { fieldId });
      if (r.data?.ok) {
        setLayers(((r.data.result as { layers?: NdviLayer[] } | null)?.layers || []) as NdviLayer[]);
      }
    } catch (e) {
      console.error('[NDVI] list failed', e);
    } finally {
      setLoading(false);
    }
  }, [fieldId]);

  useEffect(() => {
    refresh();
  }, [refresh]);

  const selectedField = fields.find((f) => f.id === fieldId) || null;

  async function fetchLayer() {
    if (!selectedField) return;
    setFetching(true);
    setError(null);
    try {
      const r = await lensRun('agriculture', 'satellite-ndvi-fetch', {
        fieldId: selectedField.id,
        lat: selectedField.lat,
        lng: selectedField.lng,
        index,
      });
      if (r.data?.ok) {
        await refresh();
      } else {
        setError(r.data?.error || 'Satellite fetch failed');
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setFetching(false);
    }
  }

  async function remove(id: string) {
    try {
      await lensRun('agriculture', 'satellite-ndvi-delete', { id });
      setLayers((prev) => prev.filter((l) => l.id !== id));
    } catch (e) {
      console.error('[NDVI] delete failed', e);
    }
  }

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
        <Satellite className="w-6 h-6 mx-auto mb-2 opacity-30" />
        No fields yet. Add a field (with coordinates) to pull satellite imagery.
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-1 sm:grid-cols-[2fr_2fr_auto] gap-2">
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
        <select
          value={index}
          onChange={(e) => setIndex(e.target.value)}
          className="px-2 py-1.5 text-xs bg-lattice-deep border border-lattice-border rounded text-white"
        >
          {INDICES.map((i) => (
            <option key={i.id} value={i.id}>
              {i.label}
            </option>
          ))}
        </select>
        <button
          onClick={fetchLayer}
          disabled={fetching || !selectedField}
          className="px-3 py-1.5 text-xs rounded bg-emerald-500 text-black font-bold hover:bg-emerald-400 disabled:opacity-40 inline-flex items-center justify-center gap-1"
        >
          {fetching ? (
            <Loader2 className="w-3 h-3 animate-spin" />
          ) : (
            <RefreshCw className="w-3 h-3" />
          )}
          Pull layer
        </button>
      </div>

      {error && (
        <div className="text-xs text-rose-300 bg-rose-500/10 border border-rose-500/20 rounded px-3 py-2">
          {error}
        </div>
      )}

      {loading ? (
        <div className="flex items-center justify-center py-8 text-xs text-gray-400">
          <Loader2 className="w-4 h-4 animate-spin mr-2" /> Loading layers…
        </div>
      ) : layers.length === 0 ? (
        <div className="py-8 text-center text-xs text-gray-400">
          No imagery layers captured for this field yet.
        </div>
      ) : (
        <div className="space-y-4">
          {layers.map((layer) => (
            <div
              key={layer.id}
              className="rounded-lg border border-white/10 bg-white/[0.02] p-3"
            >
              <div className="flex items-center gap-3 mb-2">
                <span className="text-xs font-mono uppercase text-emerald-300">
                  {layer.index}
                </span>
                <span
                  className={cn(
                    'text-[10px] uppercase tracking-wider',
                    VIGOR_COLOUR[layer.vigorClass] || 'text-gray-400',
                  )}
                >
                  {layer.vigorClass}
                </span>
                <span className="text-[10px] text-gray-400">
                  {new Date(layer.capturedAt).toLocaleString()}
                </span>
                <button
                  onClick={() => remove(layer.id)}
                  className="ml-auto p-1 text-rose-400 hover:text-rose-300"
                  aria-label="Delete layer"
                >
                  <Trash2 className="w-3 h-3" />
                </button>
              </div>
              <div className="grid grid-cols-3 gap-2 mb-3">
                {[
                  { k: 'Latest', v: layer.latestIndex },
                  { k: 'Window avg', v: layer.avgIndex },
                  { k: 'Peak', v: layer.peakIndex },
                ].map((m) => (
                  <div
                    key={m.k}
                    className="rounded bg-lattice-deep px-2 py-1.5 text-center"
                  >
                    <div className="text-sm font-bold text-emerald-300">
                      {m.v.toFixed(3)}
                    </div>
                    <div className="text-[10px] text-gray-400">{m.k}</div>
                  </div>
                ))}
              </div>
              <ChartKit
                kind="area"
                data={layer.series as unknown as Array<Record<string, unknown>>}
                xKey="date"
                series={[{ key: 'value', label: layer.index.toUpperCase(), color: '#22c55e' }]}
                height={160}
                showLegend={false}
              />
              <div className="mt-1 text-[10px] text-gray-400">
                {layer.windowDays}-day window · source: {layer.source}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

export default NdviLayersPanel;
