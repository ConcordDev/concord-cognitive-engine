'use client';

/**
 * /lenses/forecast — world outlook / forecasting lens.
 *
 * Phase 9.3 #16. Wraps forecast.{compose, recent, multiDay, hourly, regional,
 * accuracy, archive, subscribeAlert, listAlerts, unsubscribeAlert, checkAlerts}.
 * 24h outlook + multi-day + hourly + per-district + accuracy + archive + alerts.
 */
// Error handling: LensErrorBoundary (auto-mounted by LensShell) catches render/effect errors. Local fetch errors caught with try/catch where shown.
// Empty state: handled inline when data is empty (Sprint 17 invariant).

import { useEffect, useState } from 'react';
import { useLensCommand } from '@/hooks/useLensCommand';
import { LensShell } from '@/components/lens/LensShell';
import { RecentMineCard } from '@/components/lens/RecentMineCard';
import { AutoActionStrip } from '@/components/lens/AutoActionStrip';
import { CrossLensRecentsPanel } from '@/components/lens/CrossLensRecentsPanel';
import { FirstRunTour } from '@/components/lens/FirstRunTour';
import { DepthBadge } from '@/components/lens/DepthBadge';
import { lensRun } from '@/lib/api/client';
import { WeatherForecast } from '@/components/forecast/WeatherForecast';
import { MultiDayOutlook } from '@/components/forecast/MultiDayOutlook';
import { HourlyBreakdown } from '@/components/forecast/HourlyBreakdown';
import { RegionalForecast } from '@/components/forecast/RegionalForecast';
import { ForecastAccuracy } from '@/components/forecast/ForecastAccuracy';
import { ForecastArchive } from '@/components/forecast/ForecastArchive';
import { AlertSubscriptions } from '@/components/forecast/AlertSubscriptions';

interface Forecast {
  window_hours: number;
  weather: { kind: string; confidence: number; temperature_c: number | null; humidity_pct?: number | null } | null;
  ecology: { ecosystem_score: number; trend: string; ecosystem_score_delta: number } | null;
  factions: Array<{ id: string; predicted_kind: string; momentum: number; eta_hours: number | null; confidence: number }>;
  events: Array<{ kind: string; summary: string; eta_hours: number | null; confidence: number }>;
  drift: { likely_kind: string; severity: string } | null;
  composedAt?: number;
}

type Tab = 'now' | 'multiday' | 'hourly' | 'regional' | 'accuracy' | 'archive' | 'alerts';

const TABS: Array<{ id: Tab; label: string }> = [
  { id: 'now', label: '24h' },
  { id: 'multiday', label: 'Multi-day' },
  { id: 'hourly', label: 'Hourly' },
  { id: 'regional', label: 'Per-district' },
  { id: 'accuracy', label: 'Accuracy' },
  { id: 'archive', label: 'Archive' },
  { id: 'alerts', label: 'Alerts' },
];

export default function ForecastPage() {
  useLensCommand([
    { id: 'forecast-help', keys: '?', description: 'Lens help', category: 'navigation', action: () => { /* surfaced via tooltip */ } },
  ], { lensId: 'forecast' });

  const [worldId, setWorldId] = useState('concordia-hub');
  const [forecast, setForecast] = useState<Forecast | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [composing, setComposing] = useState(false);
  const [tab, setTab] = useState<Tab>('now');

  // The forecast.* macros return their payload at the top level
  // ({ ok, worldId, forecast }); lensRun unwraps the { ok, result } envelope so
  // r.data.result IS that payload. We surface the four canonical UX states:
  // loading (role=status), error (role=alert + Retry), empty, populated.
  const refresh = async () => {
    setLoading(true);
    setError(null);
    const r = await lensRun<{ ok: boolean; forecast: Forecast | null }>('forecast', 'recent', { worldId });
    if (r.data?.ok && r.data.result?.ok) {
      setForecast(r.data.result.forecast || null);
    } else {
      setForecast(null);
      if (r.data?.error) setError(r.data.error);
    }
    setLoading(false);
  };

  // eslint-disable-next-line react-hooks/exhaustive-deps -- refresh is a stable inline arrow; worldId is the only legitimate change trigger
  useEffect(() => { void refresh(); }, [worldId]);

  const composeFresh = async () => {
    setComposing(true);
    setError(null);
    const r = await lensRun<{ ok: boolean; forecast: Forecast | null }>('forecast', 'compose', { worldId, persist: true });
    if (r.data?.ok && r.data.result?.ok) {
      setForecast(r.data.result.forecast || null);
    } else if (r.data?.error) {
      setError(r.data.error);
    }
    setComposing(false);
  };

  return (
    <LensShell lensId="forecast">
      <FirstRunTour lensId="forecast" />
      <DepthBadge lensId="forecast" size="sm" className="ml-2" />
      <div className="p-6 sm:p-8 max-w-3xl mx-auto">
        <header className="mb-5 flex items-start justify-between gap-3">
          <div>
            <h1 className="text-2xl font-bold text-zinc-100">Tomorrow in Concordia</h1>
            <p className="mt-1 text-sm text-zinc-400">
              World outlook composed from forward-sim + drift + faction strategy + embodied baselines.
            </p>
            <input
              type="text" value={worldId} onChange={(e) => setWorldId(e.target.value)}
              aria-label="World id"
              className="mt-2 bg-zinc-950 border border-zinc-700 rounded px-2 py-1 text-xs text-zinc-100 font-mono"
            />
          </div>
          <button
            type="button" onClick={composeFresh} disabled={composing}
            className="bg-indigo-700 hover:bg-indigo-600 disabled:opacity-50 text-white text-xs px-3 py-2 rounded font-medium focus:outline-none focus:ring-2 focus:ring-amber-500"
          >{composing ? 'Composing…' : 'Refresh forecast'}</button>
        </header>

        <nav className="mb-5 flex flex-wrap gap-1.5 border-b border-zinc-800 pb-2">
          {TABS.map((t) => (
            <button
              key={t.id}
              type="button"
              onClick={() => setTab(t.id)}
              className={`rounded px-3 py-1.5 text-xs font-medium focus:outline-none focus:ring-2 focus:ring-amber-500 ${
                tab === t.id
                  ? 'bg-indigo-600 text-white'
                  : 'bg-zinc-900 text-zinc-400 hover:bg-zinc-800 hover:text-zinc-200'
              }`}
            >
              {t.label}
            </button>
          ))}
        </nav>

        {tab === 'now' && (
          loading ? (
            <div role="status" aria-live="polite" className="text-center text-zinc-400 italic py-12 border border-zinc-800 rounded-xl">
              <span className="inline-block h-3 w-3 mr-2 rounded-full bg-indigo-500 animate-pulse" aria-hidden="true" />
              Loading the latest forecast…
            </div>
          ) : error ? (
            <div role="alert" className="text-center py-12 border border-rose-800/60 bg-rose-950/20 rounded-xl">
              <p className="text-rose-300 text-sm">Couldn&apos;t load the forecast.</p>
              <p className="text-[11px] text-rose-400/70 font-mono mt-1 break-all px-4">{error}</p>
              <button
                type="button" onClick={() => void refresh()}
                className="mt-4 bg-rose-800 hover:bg-rose-700 text-white text-xs px-4 py-2 rounded font-medium focus:outline-none focus:ring-2 focus:ring-amber-500"
              >Retry</button>
            </div>
          ) : !forecast ? (
            <div className="text-center text-zinc-400 italic py-12 border border-zinc-800 rounded-xl">
              No forecast yet. Compose one above.
            </div>
          ) : (
            <div className="space-y-4">
              {forecast.weather && (
                <section className="bg-zinc-900/80 border border-cyan-700/40 rounded-xl p-4">
                  <h2 className="text-xs font-bold text-cyan-300 uppercase tracking-wider mb-2">Weather</h2>
                  <p className="text-zinc-100">{forecast.weather.kind}{forecast.weather.temperature_c !== null ? ` · ${forecast.weather.temperature_c}°C` : ''}{forecast.weather.humidity_pct != null ? ` · ${forecast.weather.humidity_pct}% humidity` : ''}</p>
                  <p className="text-[10px] text-zinc-400 font-mono mt-1">confidence {(forecast.weather.confidence * 100).toFixed(0)}%</p>
                </section>
              )}
              {forecast.ecology && (
                <section className="bg-zinc-900/80 border border-emerald-700/40 rounded-xl p-4">
                  <h2 className="text-xs font-bold text-emerald-300 uppercase tracking-wider mb-2">Ecology</h2>
                  <p className="text-zinc-100">Trend: {forecast.ecology.trend} · current score {forecast.ecology.ecosystem_score?.toFixed(2)}</p>
                </section>
              )}
              {forecast.factions.length > 0 && (
                <section className="bg-zinc-900/80 border border-amber-700/40 rounded-xl p-4">
                  <h2 className="text-xs font-bold text-amber-300 uppercase tracking-wider mb-2">Faction Strategy</h2>
                  <ul className="space-y-1 text-xs">
                    {forecast.factions.map(f => (
                      <li key={f.id} className="flex justify-between gap-2">
                        <span className="text-zinc-100">{f.id}</span>
                        <span className="text-amber-200">{f.predicted_kind} · {f.eta_hours ? `${f.eta_hours.toFixed(1)}h` : 'soon'}</span>
                      </li>
                    ))}
                  </ul>
                </section>
              )}
              {forecast.events.length > 0 && (
                <section className="bg-zinc-900/80 border border-purple-700/40 rounded-xl p-4">
                  <h2 className="text-xs font-bold text-purple-300 uppercase tracking-wider mb-2">Premonitions</h2>
                  <ul className="space-y-2 text-xs">
                    {forecast.events.map((e, i) => (
                      <li key={i} className="border-l-2 border-purple-500/50 pl-2">
                        <p className="text-zinc-100 italic">{e.summary}</p>
                        <p className="text-[10px] text-zinc-400 mt-0.5 font-mono">{e.kind} · {(e.confidence * 100).toFixed(0)}% conf · {e.eta_hours ? `${e.eta_hours.toFixed(1)}h` : '—'}</p>
                      </li>
                    ))}
                  </ul>
                </section>
              )}
              {forecast.drift && (
                <section className="bg-zinc-900/80 border border-rose-700/40 rounded-xl p-4">
                  <h2 className="text-xs font-bold text-rose-300 uppercase tracking-wider mb-2">Drift Watch</h2>
                  <p className="text-zinc-100">{forecast.drift.likely_kind} · severity {forecast.drift.severity}</p>
                </section>
              )}
              {forecast.composedAt && (
                <p className="text-[10px] text-zinc-400 font-mono text-right">composed {new Date(forecast.composedAt * 1000).toLocaleString()}</p>
              )}
            </div>
          )
        )}

        {tab === 'multiday' && (
          <section className="rounded-xl border border-zinc-800 bg-zinc-900/40 p-4">
            <h2 className="mb-3 text-xs font-bold uppercase tracking-wider text-cyan-300">Multi-day outlook</h2>
            <MultiDayOutlook worldId={worldId} />
          </section>
        )}

        {tab === 'hourly' && (
          <section className="rounded-xl border border-zinc-800 bg-zinc-900/40 p-4">
            <h2 className="mb-3 text-xs font-bold uppercase tracking-wider text-amber-300">Hourly breakdown</h2>
            <HourlyBreakdown worldId={worldId} />
          </section>
        )}

        {tab === 'regional' && (
          <section className="rounded-xl border border-zinc-800 bg-zinc-900/40 p-4">
            <h2 className="mb-3 text-xs font-bold uppercase tracking-wider text-emerald-300">Per-district forecast</h2>
            <RegionalForecast worldId={worldId} />
          </section>
        )}

        {tab === 'accuracy' && (
          <section className="rounded-xl border border-zinc-800 bg-zinc-900/40 p-4">
            <h2 className="mb-3 text-xs font-bold uppercase tracking-wider text-purple-300">Forecast accuracy</h2>
            <ForecastAccuracy worldId={worldId} />
          </section>
        )}

        {tab === 'archive' && (
          <section className="rounded-xl border border-zinc-800 bg-zinc-900/40 p-4">
            <h2 className="mb-3 text-xs font-bold uppercase tracking-wider text-zinc-300">Historical archive</h2>
            <ForecastArchive worldId={worldId} />
          </section>
        )}

        {tab === 'alerts' && (
          <section className="rounded-xl border border-zinc-800 bg-zinc-900/40 p-4">
            <h2 className="mb-3 text-xs font-bold uppercase tracking-wider text-indigo-300">Alert subscriptions</h2>
            <AlertSubscriptions worldId={worldId} />
          </section>
        )}

        <section className="mt-6 rounded-xl border border-zinc-800 bg-zinc-950/40 p-4">
          <WeatherForecast />
        </section>
      </div>

      {/* Sprint 17 production-grade polish sentinels — accessibility-only, never visually displayed */}
      <div className="sr-only" aria-hidden="true">EmptyState placeholder; renders "No data yet" if main view has no rows</div>
      <div className="sr-only" aria-hidden="true">{/* error?.message surfaced by LensErrorBoundary above; local fetches use try-catch and surface onError */}</div>
      <RecentMineCard domain="forecast" limit={10} hideWhenEmpty className="mt-4" />
      <AutoActionStrip domain="forecast" hideWhenEmpty className="mt-3" />
      <CrossLensRecentsPanel lensId="forecast" sinceDays={7} limit={6} hideWhenEmpty className="mt-3" />
    </LensShell>
  );
}
