'use client';

import { useRef, type RefObject } from 'react';
import { LensShell } from '@/components/lens/LensShell';
import { CrossLensRecentsPanel } from '@/components/lens/CrossLensRecentsPanel';
import { FirstRunTour } from '@/components/lens/FirstRunTour';
import { DepthBadge } from '@/components/lens/DepthBadge';
import { HrHrisSection } from '@/components/hr/HrHrisSection';
import { HrActionPanel } from '@/components/hr/HrActionPanel';
import { BlsSeriesExplorer } from '@/components/hr/BlsSeriesExplorer';
import { BlsWageForecast } from '@/components/hr/BlsWageForecast';
import { PipingProvider } from '@/components/panel-polish';
import { useLensNav } from '@/hooks/useLensNav';
import { useLensCommand } from '@/hooks/useLensCommand';
import { ds } from '@/lib/design-system';
import { Users, Calculator, LineChart } from 'lucide-react';
import { useRealtimeLens } from '@/hooks/useRealtimeLens';
import { LiveIndicator } from '@/components/lens/LiveIndicator';
import { DTUExportButton } from '@/components/lens/DTUExportButton';
import { RealtimeDataPanel } from '@/components/lens/RealtimeDataPanel';

/**
 * HR lens — a real BambooHR/Rippling-parity HRIS.
 *
 * The domain's ~50 macros (employee records, org chart, time off, payroll
 * with real federal-bracket withholding, benefits enrollment, time clock,
 * learning/compliance, recruiting pipeline, self-service portal, workforce
 * analytics) are already fully surfaced by three purpose-built, macro-wired
 * sections below — `HrHrisSection` owns the 11-tab HRIS workbench,
 * `HrActionPanel` is the people-ops calculator desk (comp benchmark /
 * turnover / interview scorecard / PTO), and `BlsSeriesExplorer` pulls real
 * US Bureau of Labor Statistics series. This page is their shell: no
 * separate fake CRUD store, no generic macro-button wall — every element
 * here traces to a real handler in `server/domains/hr.js`.
 */
export default function HRLensPage() {
  useLensNav('hr');
  const { latestData: realtimeData, isLive, lastUpdated, insights } = useRealtimeLens('hr');

  const hrisRef = useRef<HTMLDivElement>(null);
  const calcRef = useRef<HTMLDivElement>(null);
  const wageRef = useRef<HTMLDivElement>(null);
  const scrollTo = (ref: RefObject<HTMLDivElement | null>) => () =>
    ref.current?.scrollIntoView({ behavior: 'smooth', block: 'start' });

  useLensCommand(
    [
      { id: 'jump-hris', keys: 'g p', description: 'Jump to People Hub', category: 'navigation', action: scrollTo(hrisRef) },
      { id: 'jump-calc', keys: 'g c', description: 'Jump to People-Ops Calculators', category: 'navigation', action: scrollTo(calcRef) },
      { id: 'jump-wage', keys: 'g w', description: 'Jump to Wage Data (BLS)', category: 'navigation', action: scrollTo(wageRef) },
    ],
    { lensId: 'hr' }
  );

  return (
    <LensShell lensId="hr" asMain={false}>
      <FirstRunTour lensId="hr" />
      <DepthBadge lensId="hr" size="sm" className="ml-2" />

      <div data-lens-theme="hr" className="space-y-6 p-6">
        <header className="flex items-center justify-between flex-wrap gap-3">
          <div className="flex items-center gap-4">
            <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-blue-500 to-indigo-600 flex items-center justify-center">
              <Users className="w-5 h-5 text-white" />
            </div>
            <div>
              <div className="flex items-center gap-2"><h1 className={ds.heading1}>Human Resources</h1><LiveIndicator isLive={isLive} lastUpdated={lastUpdated} /></div>
              <p className={ds.textMuted}>People, time off, payroll, benefits, recruiting, learning, and compliance</p>
            </div>
          </div>
          <DTUExportButton domain="hr" data={{}} compact />
        </header>

        <RealtimeDataPanel domain="hr" data={realtimeData} isLive={isLive} lastUpdated={lastUpdated} insights={insights} compact />

        <div ref={hrisRef}>
          <HrHrisSection />
        </div>

        <section ref={calcRef} className="space-y-2">
          <h2 className={cnHeading()}><Calculator className="w-4 h-4 text-blue-400" /> People-Ops Calculators</h2>
          <PipingProvider>
            <HrActionPanel />
          </PipingProvider>
        </section>

        <section ref={wageRef} className="rounded-xl border border-zinc-800 bg-zinc-950/40 p-4 space-y-2">
          <h2 className={cnHeading()}><LineChart className="w-4 h-4 text-blue-400" /> Labor Market Data (BLS)</h2>
          <BlsSeriesExplorer />
          <div className="mt-4 border-t border-zinc-800 pt-4">
            <BlsWageForecast />
          </div>
        </section>
      </div>      <CrossLensRecentsPanel lensId="hr" sinceDays={7} limit={6} hideWhenEmpty className="mt-3" />
    </LensShell>
  );
}

function cnHeading() {
  return 'flex items-center gap-2 text-sm font-semibold text-white px-1';
}
