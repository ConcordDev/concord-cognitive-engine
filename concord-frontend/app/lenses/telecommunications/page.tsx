'use client';

/* ------------------------------------------------------------------ */
/*  Telecommunications lens — RF network planning + NOC ops.           */
/*  All 22 `telecommunications.*` macros are real (server/domains/     */
/*  telecommunications.js): 4 legacy single-shot calculators           */
/*  (networkCapacity/signalQuality/coverageMap/costPerLine) wired by   */
/*  TelecommunicationsActionPanel, plus an 18-macro planning suite     */
/*  (tower CRUD, COST-231 Hata propagation, interference analysis,     */
/*  capacity projection, topology, spectrum planner, outage/SLA        */
/*  tracking, drive-test validation) wired by RFPlanner. Every value   */
/*  rendered here comes from a real macro call — no seed/mock data.    */
/* ------------------------------------------------------------------ */

import { useEffect, useState, useCallback } from 'react';
import { LensShell } from '@/components/lens/LensShell';
import { CrossLensRecentsPanel } from '@/components/lens/CrossLensRecentsPanel';
import { FirstRunTour } from '@/components/lens/FirstRunTour';
import { DepthBadge } from '@/components/lens/DepthBadge';
import { TelcoRepos } from '@/components/telecommunications/TelcoRepos';
import { TelecommunicationsActionPanel } from '@/components/telecommunications/TelecommunicationsActionPanel';
import { RFPlanner, RF_PLANNER_TABS } from '@/components/telecommunications/RFPlanner';
import { PipingProvider } from '@/components/panel-polish';
import { LensPageShell } from '@/components/lens/LensPageShell';
import { lensRun } from '@/lib/api/client';
import { useLensCommand } from '@/hooks/useLensCommand';
import {
  Radio,
  AlertTriangle,
  Antenna,
  Wifi,
  Signal,
} from 'lucide-react';

/** Live counts pulled straight from the real macros (towerList / spectrumList /
 * outageList) — no fabricated Network/Subscriber/Fiber artifact types. */
interface OverviewCounts {
  towers: number;
  activeTowers: number;
  spectrumMhz: number;
  openOutages: number;
}

export default function TelecommunicationsLensPage() {
  const [overview, setOverview] = useState<OverviewCounts | null>(null);
  const [overviewError, setOverviewError] = useState<string | null>(null);
  const [rfTab, setRfTab] = useState<(typeof RF_PLANNER_TABS)[number]['key']>('sites');

  const loadOverview = useCallback(async () => {
    try {
      const [towerRes, spectrumRes, outageRes] = await Promise.all([
        lensRun<{ towers: Array<{ status: string }> }>('telecommunications', 'towerList', {}),
        lensRun<{ allocations: Array<{ widthMhz: number }> }>('telecommunications', 'spectrumList', {}),
        lensRun<{ outages: Array<{ status: string }> }>('telecommunications', 'outageList', {}),
      ]);
      const towers = towerRes.data.ok ? towerRes.data.result?.towers || [] : [];
      const allocations = spectrumRes.data.ok ? spectrumRes.data.result?.allocations || [] : [];
      const outages = outageRes.data.ok ? outageRes.data.result?.outages || [] : [];
      setOverview({
        towers: towers.length,
        activeTowers: towers.filter((t) => t.status === 'active').length,
        spectrumMhz: Math.round(allocations.reduce((s, a) => s + (a.widthMhz || 0), 0) * 100) / 100,
        openOutages: outages.filter((o) => o.status === 'open').length,
      });
    } catch (e) {
      setOverviewError(e instanceof Error ? e.message : String(e));
    }
  }, []);

  useEffect(() => {
    loadOverview();
  }, [loadOverview]);

  // Discoverable keyboard shortcuts to jump between RF Planner sub-tabs —
  // matches the fluidity invariant (every scoped command must be surfaced,
  // not just functional).
  useLensCommand(
    RF_PLANNER_TABS.map((t, i) => ({
      id: `rf-tab-${t.key}`,
      keys: String(i + 1),
      description: `RF Planner → ${t.label}`,
      category: 'navigation',
      action: () => setRfTab(t.key),
    })),
    { lensId: 'telecommunications' },
  );

  return (
    <LensShell lensId="telecommunications" asMain={false}>
      <FirstRunTour lensId="telecommunications" />      <DepthBadge lensId="telecommunications" size="sm" className="ml-2" />
      <LensPageShell
        domain="telecommunications"
        title="Telecommunications"
        description="RF network planning, spectrum allocation, outage/SLA tracking & NOC ops"
        headerIcon={<Radio className="w-5 h-5 text-violet-400" />}
      >
        {/* Live stat strip — real towerList/spectrumList/outageList counts */}
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
          <div className="p-3 bg-zinc-900 rounded-lg border border-zinc-800">
            <div className="flex items-center gap-2 mb-1">
              <Antenna className="w-4 h-4 text-violet-400" />
            </div>
            <p className="text-2xl font-bold text-violet-400">
              {overview ? overview.activeTowers : '—'}
              {overview ? <span className="text-sm text-zinc-500"> / {overview.towers}</span> : null}
            </p>
            <p className="text-xs text-gray-400">Active sites</p>
          </div>
          <div className="p-3 bg-zinc-900 rounded-lg border border-zinc-800">
            <div className="flex items-center gap-2 mb-1">
              <Wifi className="w-4 h-4 text-cyan-400" />
            </div>
            <p className="text-2xl font-bold text-cyan-400">{overview ? overview.spectrumMhz : '—'}</p>
            <p className="text-xs text-gray-400">MHz allocated</p>
          </div>
          <div className="p-3 bg-zinc-900 rounded-lg border border-zinc-800">
            <div className="flex items-center gap-2 mb-1">
              <Signal className="w-4 h-4 text-green-400" />
            </div>
            <p className="text-2xl font-bold text-green-400">
              {overview ? overview.towers - overview.openOutages : '—'}
            </p>
            <p className="text-xs text-gray-400">Sites w/o open incident</p>
          </div>
          <div className="p-3 bg-zinc-900 rounded-lg border border-zinc-800">
            <div className="flex items-center gap-2 mb-1">
              <AlertTriangle className="w-4 h-4 text-red-400" />
            </div>
            <p className="text-2xl font-bold text-red-400">{overview ? overview.openOutages : '—'}</p>
            <p className="text-xs text-gray-400">Open outages</p>
          </div>
        </div>
        {overviewError && (
          <div role="alert" className="rounded-lg border border-red-500/40 bg-red-500/5 px-3 py-2 text-xs text-red-300">
            Couldn&apos;t load live counts: {overviewError}
          </div>
        )}

        <section>
          <RFPlanner tab={rfTab} onTabChange={setRfTab} />
        </section>

        <PipingProvider>
          <section className="mt-6 max-w-7xl mx-auto px-4">
            <TelecommunicationsActionPanel />
          </section>
        </PipingProvider>

        <section className="mt-6 rounded-xl border border-zinc-800 bg-zinc-950/40 p-4">
          <TelcoRepos />
        </section>
      </LensPageShell>      <CrossLensRecentsPanel lensId="telecommunications" sinceDays={7} limit={6} hideWhenEmpty className="mt-3" />
    </LensShell>
  );
}
