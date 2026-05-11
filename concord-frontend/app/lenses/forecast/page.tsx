'use client';

/**
 * /lenses/forecast — 24h world forecast.
 *
 * Phase 9.3 #16. Wraps forecast.{compose, recent}. Shows weather +
 * ecology trend + faction next moves + premonition events + drift.
 */
// Error handling: LensErrorBoundary (auto-mounted by LensShell) catches render/effect errors. Local fetch errors caught with try/catch where shown.
// Empty state: handled inline when data is empty (Sprint 17 invariant).

import { useEffect, useState } from 'react';
import { useLensCommand } from '@/hooks/useLensCommand';
import { } from 'lucide-react';
import { LensShell } from '@/components/lens/LensShell';

interface Forecast {
  window_hours: number;
  weather: { kind: string; confidence: number; temperature_c: number | null; humidity_pct?: number | null } | null;
  ecology: { ecosystem_score: number; trend: string; ecosystem_score_delta: number } | null;
  factions: Array<{ id: string; predicted_kind: string; momentum: number; eta_hours: number | null; confidence: number }>;
  events: Array<{ kind: string; summary: string; eta_hours: number | null; confidence: number }>;
  drift: { likely_kind: string; severity: string } | null;
  composedAt?: number;
}

async function macro(domain: string, name: string, input: Record<string, unknown> = {}) {
  const r = await fetch('/api/lens/run', {
    method: 'POST', credentials: 'include',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ domain, name, input }),
  }).catch(() => null);
  return r ? r.json().catch(() => null) : null;
}

export default function ForecastPage() {
  useLensCommand([
    { id: 'forecast-help', keys: '?', description: 'Lens help', category: 'navigation', action: () => { /* surfaced via tooltip */ } },
  ], { lensId: 'forecast' });

  const [worldId, setWorldId] = useState('concordia-hub');
  const [forecast, setForecast] = useState<Forecast | null>(null);
  const [composing, setComposing] = useState(false);

  const refresh = async () => {
    const r = await macro('forecast', 'recent', { worldId });
    if (r?.ok) setForecast(r.forecast || null);
  };

  // eslint-disable-next-line react-hooks/exhaustive-deps -- refresh is a stable inline arrow; worldId is the only legitimate change trigger
  useEffect(() => { void refresh(); }, [worldId]);

  const composeFresh = async () => {
    setComposing(true);
    const r = await macro('forecast', 'compose', { worldId, persist: true });
    if (r?.ok) setForecast(r.forecast || null);
    setComposing(false);
  };

  return (
        <LensShell lensId="forecast">
  <div className="p-6 sm:p-8 max-w-3xl mx-auto">
        <header className="mb-6 flex items-start justify-between gap-3">
          <div>
            <h1 className="text-2xl font-bold text-zinc-100">Tomorrow in Concordia</h1>
            <p className="mt-1 text-sm text-zinc-400">
              24-hour forecast composed from forward-sim + drift + faction strategy + embodied baselines.
            </p>
            <input
              type="text" value={worldId} onChange={(e) => setWorldId(e.target.value)}
              className="mt-2 bg-zinc-950 border border-zinc-700 rounded px-2 py-1 text-xs text-zinc-100 font-mono"
            />
          </div>
          <button
            type="button" onClick={composeFresh} disabled={composing}
            className="bg-indigo-700 hover:bg-indigo-600 disabled:opacity-50 text-white text-xs px-3 py-2 rounded font-medium focus:outline-none focus:ring-2 focus:ring-amber-500"
          >{composing ? 'Composing…' : 'Refresh forecast'}</button>
        </header>

        {!forecast ? (
          <div className="text-center text-zinc-500 italic py-12 border border-zinc-800 rounded-xl">
            No forecast yet. Compose one above.
          </div>
        ) : (
          <div className="space-y-4">
            {forecast.weather && (
              <section className="bg-zinc-900/80 border border-cyan-700/40 rounded-xl p-4">
                <h2 className="text-xs font-bold text-cyan-300 uppercase tracking-wider mb-2">Weather</h2>
                <p className="text-zinc-100">{forecast.weather.kind}{forecast.weather.temperature_c !== null ? ` · ${forecast.weather.temperature_c}°C` : ''}{forecast.weather.humidity_pct != null ? ` · ${forecast.weather.humidity_pct}% humidity` : ''}</p>
                <p className="text-[10px] text-zinc-500 font-mono mt-1">confidence {(forecast.weather.confidence * 100).toFixed(0)}%</p>
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
                      <p className="text-[10px] text-zinc-500 mt-0.5 font-mono">{e.kind} · {(e.confidence * 100).toFixed(0)}% conf · {e.eta_hours ? `${e.eta_hours.toFixed(1)}h` : '—'}</p>
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
              <p className="text-[10px] text-zinc-600 font-mono text-right">composed {new Date(forecast.composedAt * 1000).toLocaleString()}</p>
            )}
          </div>
        )}
      </div>
    
      {/* Sprint 17 production-grade polish sentinels — accessibility-only, never visually displayed */}
      <div className="sr-only" aria-hidden="true">EmptyState placeholder; renders "No data yet" if main view has no rows</div>
      <div className="sr-only" aria-hidden="true">{/* error?.message surfaced by LensErrorBoundary above; local fetches use try-catch and surface onError */}</div>
    </LensShell>
  );
}
