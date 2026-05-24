'use client';

// Weather-driven spray-window advisor. Reads the live Open-Meteo hourly
// forecast for a field and rates each hour for pesticide application against
// agronomic wind / temp / rain / inversion thresholds.

import { useCallback, useEffect, useState } from 'react';
import { Wind, Loader2, RefreshCw, CheckCircle2, AlertTriangle } from 'lucide-react';
import { lensRun } from '@/lib/api/client';
import { cn } from '@/lib/utils';
import { ChartKit } from '@/components/viz/ChartKit';
import type { AgField } from './PrecisionAgPanel';

interface SprayHour {
  time: string;
  tempF: number | null;
  windMph: number | null;
  precipIn: number;
  precipProbPct: number;
  humidityPct: number | null;
  score: number;
  rating: string;
  reasons: string[];
}
interface SprayWindow {
  start: string;
  end: string;
  hours: number;
  avgScore: number;
}
interface SprayResult {
  horizonHours: number;
  hours: SprayHour[];
  windows: SprayWindow[];
  idealHourCount: number;
  nextWindow: SprayWindow | null;
  summary: string;
  source: string;
}

const RATING_COLOUR: Record<string, string> = {
  ideal: 'bg-emerald-500/15 text-emerald-300',
  marginal: 'bg-amber-500/15 text-amber-300',
  'do-not-spray': 'bg-rose-500/15 text-rose-300',
};

const HORIZONS = [24, 48, 72, 120, 168];

export function SprayWindowPanel({
  fields,
  fieldsLoading,
}: {
  fields: AgField[];
  fieldsLoading: boolean;
}) {
  const [fieldId, setFieldId] = useState('');
  const [horizon, setHorizon] = useState(72);
  const [result, setResult] = useState<SprayResult | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!fieldId && fields.length > 0) setFieldId(fields[0].id);
  }, [fields, fieldId]);

  const selectedField = fields.find((f) => f.id === fieldId) || null;

  const advise = useCallback(async () => {
    if (!selectedField) return;
    setLoading(true);
    setError(null);
    try {
      const r = await lensRun('agriculture', 'spray-window-advisor', {
        lat: selectedField.lat,
        lng: selectedField.lng,
        horizonHours: horizon,
      });
      if (r.data?.ok) {
        setResult(r.data.result as SprayResult);
      } else {
        setResult(null);
        setError(r.data?.error || 'Spray advisor failed');
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  }, [selectedField, horizon]);

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
        <Wind className="w-6 h-6 mx-auto mb-2 opacity-30" />
        No fields yet. Add a field (with coordinates) to check spray conditions.
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
        <select
          value={horizon}
          onChange={(e) => setHorizon(Number(e.target.value))}
          className="px-2 py-1.5 text-xs bg-lattice-deep border border-lattice-border rounded text-white"
        >
          {HORIZONS.map((h) => (
            <option key={h} value={h}>
              Next {h}h
            </option>
          ))}
        </select>
        <button
          onClick={advise}
          disabled={loading || !selectedField}
          className="px-3 py-1.5 text-xs rounded bg-sky-500 text-black font-bold hover:bg-sky-400 disabled:opacity-40 inline-flex items-center justify-center gap-1"
        >
          {loading ? (
            <Loader2 className="w-3 h-3 animate-spin" />
          ) : (
            <RefreshCw className="w-3 h-3" />
          )}
          Check window
        </button>
      </div>

      {error && (
        <div className="text-xs text-rose-300 bg-rose-500/10 border border-rose-500/20 rounded px-3 py-2">
          {error}
        </div>
      )}

      {result && (
        <div className="space-y-3">
          <div
            className={cn(
              'rounded-lg px-3 py-2 text-xs flex items-center gap-2 border',
              result.nextWindow
                ? 'bg-emerald-500/10 border-emerald-500/20 text-emerald-200'
                : 'bg-amber-500/10 border-amber-500/20 text-amber-200',
            )}
          >
            {result.nextWindow ? (
              <CheckCircle2 className="w-4 h-4" />
            ) : (
              <AlertTriangle className="w-4 h-4" />
            )}
            {result.summary}
          </div>

          <div className="grid grid-cols-3 gap-2 text-center">
            <div className="rounded bg-lattice-deep px-2 py-1.5">
              <div className="text-sm font-bold text-emerald-300">{result.idealHourCount}</div>
              <div className="text-[10px] text-gray-400">Ideal hours</div>
            </div>
            <div className="rounded bg-lattice-deep px-2 py-1.5">
              <div className="text-sm font-bold text-sky-300">{result.windows.length}</div>
              <div className="text-[10px] text-gray-400">Open windows</div>
            </div>
            <div className="rounded bg-lattice-deep px-2 py-1.5">
              <div className="text-sm font-bold text-gray-300">{result.horizonHours}h</div>
              <div className="text-[10px] text-gray-400">Horizon</div>
            </div>
          </div>

          <ChartKit
            kind="area"
            data={result.hours.map((h) => ({
              time: new Date(h.time).toLocaleString([], {
                month: 'short',
                day: 'numeric',
                hour: 'numeric',
              }),
              score: h.score,
            }))}
            xKey="time"
            series={[{ key: 'score', label: 'Sprayability', color: '#0ea5e9' }]}
            height={170}
            showLegend={false}
          />

          {result.windows.length > 0 && (
            <div>
              <div className="text-[11px] uppercase tracking-wider text-gray-400 mb-1">
                Open spray windows
              </div>
              <ul className="space-y-1">
                {result.windows.map((w, i) => (
                  <li
                    key={i}
                    className="text-xs flex items-center gap-2 rounded bg-emerald-500/[0.06] border border-emerald-500/15 px-2 py-1.5"
                  >
                    <span className="text-emerald-300">
                      {new Date(w.start).toLocaleString([], {
                        weekday: 'short',
                        hour: 'numeric',
                      })}
                      {' → '}
                      {new Date(w.end).toLocaleString([], { weekday: 'short', hour: 'numeric' })}
                    </span>
                    <span className="text-gray-400">{w.hours}h</span>
                    <span className="ml-auto text-gray-400">score {w.avgScore}</span>
                  </li>
                ))}
              </ul>
            </div>
          )}

          <div className="max-h-64 overflow-y-auto rounded border border-white/10">
            <table className="w-full text-[11px]">
              <thead className="text-gray-400 sticky top-0 bg-[#0b0f14]">
                <tr>
                  <th className="text-left px-2 py-1 font-normal">Hour</th>
                  <th className="px-2 py-1 font-normal">°F</th>
                  <th className="px-2 py-1 font-normal">Wind</th>
                  <th className="px-2 py-1 font-normal">Rain%</th>
                  <th className="px-2 py-1 font-normal">Rating</th>
                </tr>
              </thead>
              <tbody>
                {result.hours.map((h, i) => (
                  <tr key={i} className="border-t border-white/5">
                    <td className="px-2 py-1 text-gray-300">
                      {new Date(h.time).toLocaleString([], {
                        month: 'short',
                        day: 'numeric',
                        hour: 'numeric',
                      })}
                    </td>
                    <td className="px-2 py-1 text-center text-gray-400">{h.tempF ?? '—'}</td>
                    <td className="px-2 py-1 text-center text-gray-400">
                      {h.windMph != null ? `${h.windMph} mph` : '—'}
                    </td>
                    <td className="px-2 py-1 text-center text-gray-400">{h.precipProbPct}%</td>
                    <td className="px-2 py-1 text-center">
                      <span
                        className={cn(
                          'px-1.5 py-0.5 rounded text-[10px] uppercase tracking-wider',
                          RATING_COLOUR[h.rating] || 'bg-gray-500/15 text-gray-300',
                        )}
                        title={h.reasons.join('; ')}
                      >
                        {h.rating}
                      </span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <div className="text-[10px] text-gray-400">source: {result.source}</div>
        </div>
      )}
    </div>
  );
}

export default SprayWindowPanel;
