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
import { CalendarDays, Clock, Bell, MapPin, Target, Archive, Sun, RefreshCw, Loader2 } from 'lucide-react';
import { useLensNav } from '@/hooks/useLensNav';
import { useLensIdentity } from '@/hooks/useLensIdentity';
import { useLensCommand } from '@/hooks/useLensCommand';
import { useAuth } from '@/hooks/useAuth';
import { titleCaseDisplayName } from '@/components/chat/claudeCleanGreeting';
import { DTUExportButton } from '@/components/lens/DTUExportButton';
import { cn } from '@/lib/utils';
import { LensShell } from '@/components/lens/LensShell';
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
import { ForecastKeepMenu } from '@/components/forecast/ForecastKeepMenu';

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

const TABS: Array<{ id: Tab; label: string; keys: string; title: string; icon: typeof Sun }> = [
  { id: 'now', label: '24h', keys: '1', title: 'Tomorrow', icon: Sun },
  { id: 'multiday', label: 'Multi-day', keys: '2', title: 'The days ahead', icon: CalendarDays },
  { id: 'hourly', label: 'Hourly', keys: '3', title: 'Hour by hour', icon: Clock },
  { id: 'regional', label: 'Per-district', keys: '4', title: 'District by district', icon: MapPin },
  { id: 'accuracy', label: 'Accuracy', keys: '5', title: 'How right it was', icon: Target },
  { id: 'archive', label: 'Archive', keys: '6', title: 'What was forecast', icon: Archive },
  { id: 'alerts', label: 'Alerts', keys: '7', title: 'What to be told about', icon: Bell },
];

export default function ForecastPage() {
  useLensNav('forecast');
  useLensIdentity('forecast');
  const { user } = useAuth();
  const who = titleCaseDisplayName(user?.username);
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

  useLensCommand(
    [
      { id: 'tab-now', keys: '1', description: '24h forecast', category: 'navigation', action: () => setTab('now') },
      { id: 'tab-multiday', keys: '2', description: 'Multi-day outlook', category: 'navigation', action: () => setTab('multiday') },
      { id: 'tab-hourly', keys: '3', description: 'Hourly breakdown', category: 'navigation', action: () => setTab('hourly') },
      { id: 'tab-regional', keys: '4', description: 'Per-district forecast', category: 'navigation', action: () => setTab('regional') },
      { id: 'tab-accuracy', keys: '5', description: 'Forecast accuracy', category: 'navigation', action: () => setTab('accuracy') },
      { id: 'tab-archive', keys: '6', description: 'Historical archive', category: 'navigation', action: () => setTab('archive') },
      { id: 'tab-alerts', keys: '7', description: 'Alert subscriptions', category: 'navigation', action: () => setTab('alerts') },
      { id: 'compose-fresh', keys: 'c', description: 'Compose fresh forecast', category: 'actions', action: () => { void composeFresh(); } },
      { id: 'refresh', keys: 'r', description: 'Refresh from cache', category: 'actions', action: () => { void refresh(); } },
    ],
    { lensId: 'forecast' },
  );

  const current = TABS.find((t) => t.id === tab)!;
  const card = 'rounded-2xl border border-white/10 bg-[#111] p-5';

  return (
    <LensShell lensId="forecast" asMain={false}>
      <FirstRunTour lensId="forecast" />
      <DepthBadge lensId="forecast" size="sm" className="ml-2" />
      <div data-lens-theme="forecast" className="relative min-h-full px-8 pb-28 pt-6">
        <div className="flex items-start justify-between gap-4">
          <div className="min-w-0">
            <p className="text-[14px] text-zinc-500">Forecast</p>
            <h1 className="mb-5 mt-1 font-vault text-[2.25rem] leading-tight text-zinc-100 sm:text-5xl">
              {current.title}{tab === 'now' && who ? `, ${who}` : ''}
            </h1>
          </div>
          <div className="flex shrink-0 items-center gap-3 pt-2">
            <input
              type="text" value={worldId} onChange={(e) => setWorldId(e.target.value)}
              aria-label="World id"
              className="w-44 rounded-full border border-white/10 bg-black/30 px-3 py-1.5 font-mono text-[12px] text-zinc-200 focus:border-teal-400/50 focus:outline-none"
            />
            <DTUExportButton domain="forecast" data={{ worldId, forecast }} compact />
          </div>
        </div>

        <nav className="mb-6 inline-flex max-w-full items-center gap-1 overflow-x-auto rounded-full border border-white/10 bg-white/[0.03] p-1" aria-label="Forecast views">
          {TABS.map((t) => {
            const Icon = t.icon;
            const on = tab === t.id;
            return (
              <button
                key={t.id}
                type="button"
                onClick={() => setTab(t.id)}
                aria-current={on ? 'page' : undefined}
                className={cn(
                  'inline-flex items-center gap-2 whitespace-nowrap rounded-full px-4 py-1.5 text-[14px] transition-colors',
                  on ? 'bg-white/10 text-zinc-50' : 'text-zinc-500 hover:text-zinc-200',
                )}
              >
                <Icon className="h-3.5 w-3.5" />
                {t.label}
                <kbd className="hidden rounded border border-white/10 bg-white/5 px-1 py-0.5 font-mono text-[10px] text-white/30 sm:inline-block">{t.keys}</kbd>
              </button>
            );
          })}
        </nav>

        {tab === 'now' && (
          loading ? (
            <div role="status" aria-live="polite" className="text-center text-zinc-400 italic py-12 border border-white/10 rounded-2xl">
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
            <div className="text-center text-zinc-400 italic py-12 border border-white/10 rounded-2xl">
              No forecast yet. Use Refresh forecast to compose one.
            </div>
          ) : (
            <div className="space-y-4">
              {forecast.weather && (
                <section className="bg-[#111] border border-cyan-700/40 rounded-2xl p-5">
                  <h2 className="text-xs font-bold text-cyan-300 uppercase tracking-wider mb-2">Weather</h2>
                  <p className="text-zinc-100">{forecast.weather.kind}{forecast.weather.temperature_c !== null ? ` · ${forecast.weather.temperature_c}°C` : ''}{forecast.weather.humidity_pct != null ? ` · ${forecast.weather.humidity_pct}% humidity` : ''}</p>
                  <p className="text-[10px] text-zinc-400 font-mono mt-1">confidence {(forecast.weather.confidence * 100).toFixed(0)}%</p>
                </section>
              )}
              {forecast.ecology && (
                <section className="bg-[#111] border border-emerald-700/40 rounded-2xl p-5">
                  <h2 className="text-xs font-bold text-emerald-300 uppercase tracking-wider mb-2">Ecology</h2>
                  <p className="text-zinc-100">Trend: {forecast.ecology.trend} · current score {forecast.ecology.ecosystem_score?.toFixed(2)}</p>
                </section>
              )}
              {forecast.factions.length > 0 && (
                <section className="bg-[#111] border border-amber-700/40 rounded-2xl p-5">
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
                <section className="bg-[#111] border border-purple-700/40 rounded-2xl p-5">
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
                <section className="bg-[#111] border border-rose-700/40 rounded-2xl p-5">
                  <h2 className="text-xs font-bold text-rose-300 uppercase tracking-wider mb-2">Drift Watch</h2>
                  <p className="text-zinc-100">{forecast.drift.likely_kind} · severity {forecast.drift.severity}</p>
                </section>
              )}
              {forecast.composedAt && (
                <p className="text-[10px] text-zinc-400 font-mono text-right">composed {new Date(forecast.composedAt * 1000).toLocaleString()}</p>
              )}
              <ForecastKeepMenu facts={{ worldId, forecast }} />
            </div>
          )
        )}

        {tab === 'multiday' && (
          <section className="rounded-2xl border border-white/10 bg-[#111] p-5">
            <h2 className="mb-3 text-xs font-bold uppercase tracking-wider text-cyan-300">Multi-day outlook</h2>
            <MultiDayOutlook worldId={worldId} />
          </section>
        )}

        {tab === 'hourly' && (
          <section className="rounded-2xl border border-white/10 bg-[#111] p-5">
            <h2 className="mb-3 text-xs font-bold uppercase tracking-wider text-amber-300">Hourly breakdown</h2>
            <HourlyBreakdown worldId={worldId} />
          </section>
        )}

        {tab === 'regional' && (
          <section className="rounded-2xl border border-white/10 bg-[#111] p-5">
            <h2 className="mb-3 text-xs font-bold uppercase tracking-wider text-emerald-300">Per-district forecast</h2>
            <RegionalForecast worldId={worldId} />
          </section>
        )}

        {tab === 'accuracy' && (
          <section className="rounded-2xl border border-white/10 bg-[#111] p-5">
            <h2 className="mb-3 text-xs font-bold uppercase tracking-wider text-purple-300">Forecast accuracy</h2>
            <ForecastAccuracy worldId={worldId} />
          </section>
        )}

        {tab === 'archive' && (
          <section className="rounded-2xl border border-white/10 bg-[#111] p-5">
            <h2 className="mb-3 text-xs font-bold uppercase tracking-wider text-zinc-300">Historical archive</h2>
            <ForecastArchive worldId={worldId} />
          </section>
        )}

        {tab === 'alerts' && (
          <section className="rounded-2xl border border-white/10 bg-[#111] p-5">
            <h2 className="mb-3 text-xs font-bold uppercase tracking-wider text-indigo-300">Alert subscriptions</h2>
            <AlertSubscriptions worldId={worldId} />
          </section>
        )}

        <section className={cn(card, 'mt-6')}>
          <WeatherForecast />
        </section>

        <CrossLensRecentsPanel lensId="forecast" sinceDays={7} limit={6} hideWhenEmpty className="mt-8" />

        <button
          type="button"
          onClick={composeFresh}
          disabled={composing}
          title="Compose a fresh forecast (C)"
          className="fixed bottom-8 right-8 z-30 inline-flex items-center gap-2 rounded-full bg-teal-400 px-6 py-3.5 text-[15px] font-medium text-black shadow-[0_8px_32px_rgba(45,212,191,0.25)] transition-colors hover:bg-teal-300 disabled:opacity-60"
        >
          {composing ? <Loader2 className="h-4 w-4 animate-spin" /> : <RefreshCw className="h-4 w-4" />}
          {composing ? 'Composing…' : 'Refresh forecast'}
        </button>
      </div>
    </LensShell>
  );
}
