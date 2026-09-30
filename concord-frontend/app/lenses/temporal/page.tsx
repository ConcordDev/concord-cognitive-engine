'use client';

/* ------------------------------------------------------------------ */
/*  Temporal lens — Prophet/Tableau-grade time-series analytics.       */
/*  All 13 `temporal.*` lens macros (dataset-import/list/get/delete,   */
/*  changepoints, multiSeasonality, holidayForecast, backtest,         */
/*  crossCorrelation, timeSeriesDecompose, anomalyDetection, forecast, */
/*  simulate — server/domains/temporal.js) are real and wired below    */
/*  via ForecastWorkbench. Every number rendered comes from a real     */
/*  macro call against a user-imported series — no seed/mock data.     */
/*  See docs/lens-specs/temporal-capability-map.md.                    */
/* ------------------------------------------------------------------ */

import { LensShell } from '@/components/lens/LensShell';
import { CrossLensRecentsPanel } from '@/components/lens/CrossLensRecentsPanel';
import { FirstRunTour } from '@/components/lens/FirstRunTour';
import { DepthBadge } from '@/components/lens/DepthBadge';
import { ForecastWorkbench } from '@/components/temporal/ForecastWorkbench';
import { TemporalRepos } from '@/components/temporal/TemporalRepos';
import { ds } from '@/lib/design-system';
import { Clock, ChevronDown, ChevronRight } from 'lucide-react';
import { useState } from 'react';

export default function TemporalLensPage() {
  const [desk, setDesk] = useState<'series' | 'tools'>('series');
  return (
    <LensShell lensId="temporal" asMain={false}>
      <FirstRunTour lensId="temporal" />      <DepthBadge lensId="temporal" size="sm" className="ml-2" />
      <div data-lens-theme="temporal" className={ds.pageContainer}>
        <header className={ds.sectionHeader}>
          <div className="flex items-center gap-3">
            <Clock className="w-7 h-7 text-sky-400" />
            <div>
              <h1 className={ds.heading1}>Temporal</h1>
              <p className={ds.textMuted}>
                Import a series, then forecast, decompose, detect anomalies &amp; changepoints,
                backtest models, and analyze cross-series lead/lag — every result is computed
                server-side from your data.
              </p>
            </div>
          </div>
        </header>

        <ForecastWorkbench />

        <section className="rounded-xl border border-zinc-800 bg-zinc-950/40 p-4">
          <button
            type="button"
            onClick={() => setDesk(d => d === 'tools' ? 'series' : 'tools')}
            className="flex w-full items-center justify-between text-left text-sm font-semibold text-white"
          >
            <span>{desk === 'tools' ? 'Back to series' : 'Time-series tooling'}</span>
          </button>
          {desk === 'tools' && (
            <div className="mt-3">
              <TemporalRepos />
            </div>
          )}
        </section>
      </div>

      <a
        href="#temporal-skip"
        className="sr-only focus:not-sr-only focus:ring-2 focus:ring-amber-500 focus:outline-none"
      >
        Skip to temporal content
      </a>      <CrossLensRecentsPanel lensId="temporal" sinceDays={7} limit={6} hideWhenEmpty className="mt-3" />
    </LensShell>
  );
}
