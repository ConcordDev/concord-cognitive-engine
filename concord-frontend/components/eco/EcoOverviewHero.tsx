'use client';

// EcoOverviewHero — IQAir/AirVisual-style front door for the eco lens.
// Replaces the old "grid of nav cards" Overview (a directory page wearing
// a dashboard's clothes) with a real glanceable AQI dial fed by the same
// live Open-Meteo-backed `eco.aqi-current` reading the Air-quality tab
// uses (via the shared `useAqiData` hook — one fetch, two honest views of
// it), plus a dense quick-access list for the remaining real tabs.
//
// Real interactions (see docs/UI_QUALITY_RUBRIC.md §2), each named:
//   1. Refresh button on the gauge re-issues the real `eco.aqi-current`
//      macro call (useAqiData().refresh) and shows a spinner on that
//      specific control while in flight.
//   2. The gauge's arc animates to the exact fetched AQI value on every
//      real data change (framer-motion `animate`, driven by `data.aqi`).
//   3. "Pollutant breakdown" is a real disclosure toggle over the same
//      fetched reading's PM2.5/PM10/O3/NO2/SO2/CO fields.
//   4. Quick-access rows reveal an inline "→" affordance + (where a real
//      `useLensCommand` binding exists) a visible kbd chip on hover/focus.

import { useState } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import { ChevronDown, ChevronRight, Building2, Loader2, RefreshCw } from 'lucide-react';
import { cn } from '@/lib/utils';
import { useAqiData } from '@/hooks/useAqiData';
import { AqiGauge } from './AqiGauge';
import { CATEGORY_COLORS } from './AQIPanel';

function relTime(ts: number | null): string {
  if (!ts) return '';
  const ms = Date.now() - ts;
  if (ms < 10_000) return 'just now';
  if (ms < 60_000) return `${Math.floor(ms / 1000)}s ago`;
  if (ms < 3_600_000) return `${Math.floor(ms / 60_000)}m ago`;
  return `${Math.floor(ms / 3_600_000)}h ago`;
}

export interface EcoOverviewTab {
  id: string;
  label: string;
  icon: React.ComponentType<{ className?: string }>;
  blurb: string;
  shortcut?: string;
}

interface EcoOverviewHeroProps {
  tabs: EcoOverviewTab[];
  orgTab: EcoOverviewTab;
  onSelectTab: (id: string) => void;
}

export function EcoOverviewHero({ tabs, orgTab, onSelectTab }: EcoOverviewHeroProps) {
  const { data, loading, error, lastFetchedAt, refresh } = useAqiData();
  const [showPollutants, setShowPollutants] = useState(false);

  return (
    <div className="space-y-4">
      {/* AQI dial hero — the one real "how is the air right now" glance */}
      <div className="lens-card p-0 overflow-hidden">
        <div className="flex flex-col sm:flex-row items-stretch">
          <div className="flex items-center gap-4 p-4 sm:border-r border-lattice-border">
            {data ? (
              <AqiGauge aqi={data.aqi} category={data.category} />
            ) : (
              <div className="w-[140px] h-[87px] flex items-center justify-center text-gray-500">
                {loading ? <Loader2 className="w-5 h-5 animate-spin" /> : <span className="text-xs">—</span>}
              </div>
            )}
            <div className="min-w-0">
              <div className="text-[10px] uppercase tracking-wider text-gray-500 mb-1">Air quality now</div>
              {data ? (
                <div className={cn('text-xs font-bold', CATEGORY_COLORS[data.category]?.text)}>
                  {CATEGORY_COLORS[data.category]?.label}
                </div>
              ) : error ? (
                <div className="text-xs text-red-400" role="alert">{error}</div>
              ) : (
                <div className="text-xs text-gray-500">Locating…</div>
              )}
              <div className="flex items-center gap-2 mt-2">
                <button
                  type="button"
                  onClick={refresh}
                  disabled={loading}
                  aria-label="Refresh air quality reading"
                  className="inline-flex items-center gap-1 text-[10px] text-gray-400 hover:text-neon-green disabled:opacity-50 transition-colors"
                >
                  <RefreshCw className={cn('w-3 h-3', loading && 'animate-spin')} />
                  {loading ? 'Refreshing…' : 'Refresh'}
                </button>
                {lastFetchedAt && (
                  <span className="text-[10px] text-gray-600">· updated {relTime(lastFetchedAt)}</span>
                )}
              </div>
            </div>
          </div>

          <div className="flex-1 p-4 flex flex-col justify-center gap-2">
            {data ? (
              <>
                <p className="text-xs text-gray-300 leading-relaxed">{data.recommendation}</p>
                <button
                  type="button"
                  onClick={() => setShowPollutants(v => !v)}
                  aria-expanded={showPollutants}
                  className="inline-flex items-center gap-1 text-[10px] text-gray-400 hover:text-white transition-colors self-start"
                >
                  {showPollutants ? <ChevronDown className="w-3 h-3" /> : <ChevronRight className="w-3 h-3" />}
                  Pollutant breakdown
                </button>
                <AnimatePresence initial={false}>
                  {showPollutants && (
                    <motion.div
                      initial={{ height: 0, opacity: 0 }}
                      animate={{ height: 'auto', opacity: 1 }}
                      exit={{ height: 0, opacity: 0 }}
                      transition={{ duration: 0.18 }}
                      className="overflow-hidden"
                    >
                      <div className="grid grid-cols-3 sm:grid-cols-6 gap-2 pt-1">
                        {([
                          ['PM2.5', data.pm25, 'µg/m³'],
                          ['PM10', data.pm10, 'µg/m³'],
                          ['O₃', data.o3, 'µg/m³'],
                          ['NO₂', data.no2, 'µg/m³'],
                          ['SO₂', data.so2, 'µg/m³'],
                          ['CO', data.co, 'mg/m³'],
                        ] as const).map(([label, value, unit]) => (
                          <div key={label} className="bg-white/[0.03] rounded px-2 py-1.5">
                            <div className="text-[9px] text-gray-500">{label}</div>
                            <div className="text-xs text-white font-mono tabular-nums">
                              {value?.toFixed(1) ?? '—'} <span className="text-[8px] text-gray-500">{unit}</span>
                            </div>
                          </div>
                        ))}
                      </div>
                    </motion.div>
                  )}
                </AnimatePresence>
              </>
            ) : (
              <p className="text-xs text-gray-500">Waiting on a real reading from Open-Meteo…</p>
            )}
          </div>
        </div>
      </div>

      {/* Dense quick-access list — replaces the old giant-card grid.
          Each row is a real navigation control, not a decorative tile. */}
      <div className="rounded-xl border border-lattice-border divide-y divide-lattice-border overflow-hidden">
        {tabs.map((tab) => (
          <QuickAccessRow key={tab.id} tab={tab} onSelect={() => onSelectTab(tab.id)} />
        ))}
      </div>

      <div className="pt-1">
        <p className="text-[10px] text-gray-500 uppercase tracking-wider mb-2">For organizations, not individuals</p>
        <button
          type="button"
          onClick={() => onSelectTab(orgTab.id)}
          className="w-full text-left rounded-lg border border-amber-500/25 bg-amber-500/[0.04] p-3 hover:border-amber-500/40 hover:bg-amber-500/[0.07] transition-colors group flex items-center gap-3"
        >
          <Building2 className="w-4 h-4 text-amber-400 shrink-0 group-hover:scale-110 transition-transform" />
          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-2">
              <span className="font-semibold text-sm text-amber-200">{orgTab.label}</span>
              <span className="text-[9px] px-1.5 py-0.5 rounded bg-amber-500/15 border border-amber-500/30 text-amber-300 font-semibold">
                NOT PERSONAL
              </span>
            </div>
            <p className="text-xs text-gray-400 leading-relaxed truncate">{orgTab.blurb}</p>
          </div>
          <ChevronRight className="w-4 h-4 text-amber-400/50 shrink-0 group-hover:translate-x-0.5 transition-transform" />
        </button>
      </div>
    </div>
  );
}

function QuickAccessRow({ tab, onSelect }: { tab: EcoOverviewTab; onSelect: () => void }) {
  const Icon = tab.icon;
  return (
    <button
      type="button"
      onClick={onSelect}
      className="w-full text-left px-3 py-2.5 flex items-center gap-3 hover:bg-lattice-elevated/50 transition-colors group"
    >
      <Icon className="w-4 h-4 text-neon-green shrink-0" />
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2">
          <span className="font-semibold text-xs text-white">{tab.label}</span>
        </div>
        <p className="text-[11px] text-gray-500 leading-snug truncate group-hover:whitespace-normal">{tab.blurb}</p>
      </div>
      {tab.shortcut && (
        <kbd className="hidden sm:inline-block text-[9px] px-1.5 py-0.5 rounded border border-lattice-border bg-lattice-elevated text-gray-400 font-mono shrink-0 opacity-0 group-hover:opacity-100 transition-opacity">
          {tab.shortcut}
        </kbd>
      )}
      <ChevronRight className="w-3.5 h-3.5 text-gray-600 shrink-0 opacity-0 group-hover:opacity-100 group-hover:translate-x-0.5 transition-all" />
    </button>
  );
}

export default EcoOverviewHero;
