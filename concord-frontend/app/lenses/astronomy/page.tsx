'use client';

/**
 * ─────────────────────────────────────────────────────────────────────────
 * CONCORD // ASTRONOMY  — Stellarium + SkySafari shape (Frontend Rebuild
 * Program, Wave 2 batch 4 — Space/lab science archetype)
 * ─────────────────────────────────────────────────────────────────────────
 * Every panel on this page is real and wired to its own macro in
 * `server/domains/astronomy.js` — full audit + reference-parity checklist in
 * `docs/lens-specs/astronomy-capability-map.md`.
 *
 * REMOVED (fabrication + duplication the old page shipped):
 *   - A second, weaker "catalog + observation log" surface built on the
 *     generic `useLensData('astronomy', 'object' | 'observation', …)`
 *     artifact CRUD, duplicating what `AstronomySkySection`'s real
 *     `target-*`/`observation-log`/`session-*` macros already do one scroll
 *     down the same page.
 *   - `isVisibleTonight(name)` — a hash of the object's NAME STRING rendered
 *     as a "Tonight visible / Not visible" badge. Fake astronomical data on
 *     the same page as the real `celestialPosition` altitude/azimuth math.
 *   - The auto-generated scaffold shell that ships on every un-rebuilt
 *     lens page — a manifest-driven quick-action strip, an auto-discovered
 *     button wall, a "recently mine" card, a generic AI-actions panel, and
 *     a generic capabilities list — none of which counted as a designed
 *     feature even though the macros underneath were real.
 *
 * ADDED: `AstroCalculators` surfaces three real backend macros
 * (`planObservation`, `lightTravelTime`, `orbitalMechanics`) that had zero
 * frontend references before this rebuild.
 * ─────────────────────────────────────────────────────────────────────────
 */

import { useRef, useState } from 'react';
import { Orbit, Keyboard, Sparkles, CalendarClock, Radio, Bot } from 'lucide-react';
import { LensShell } from '@/components/lens/LensShell';
import { FirstRunTour } from '@/components/lens/FirstRunTour';
import { DepthBadge } from '@/components/lens/DepthBadge';
import { DTUExportButton } from '@/components/lens/DTUExportButton';
import { LiveIndicator } from '@/components/lens/LiveIndicator';
import { RealtimeDataPanel } from '@/components/lens/RealtimeDataPanel';
import { LensFeedButton } from '@/components/lens/LensFeedButton';
import { PipingProvider } from '@/components/panel-polish';
import { useLensNav } from '@/hooks/useLensNav';
import { useLensCommand } from '@/hooks/useLensCommand';
import { useRealtimeLens } from '@/hooks/useRealtimeLens';
import { cn } from '@/lib/utils';

import { AstronomySkySection } from '@/components/astronomy/AstronomySkySection';
import { SkyChartWorkbench } from '@/components/astronomy/SkyChartWorkbench';
import { AstroCalculators } from '@/components/astronomy/AstroCalculators';
import { NasaExplorer } from '@/components/astronomy/NasaExplorer';
import { NasaLivePanel } from '@/components/astronomy/NasaLivePanel';
import { SpaceflightNewsPanel } from '@/components/space/SpaceflightNewsPanel';
import { UpcomingLaunchesPanel } from '@/components/space/UpcomingLaunchesPanel';
import { IssPassPanel } from '@/components/astronomy/IssPassPanel';
import { AstronomyActionPanel } from '@/components/astronomy/AstronomyActionPanel';

type GroupId = 'sky' | 'log' | 'calc' | 'live' | 'assistant';

const GROUPS: { id: GroupId; label: string; hotkey: string; icon: typeof Orbit }[] = [
  { id: 'sky', label: 'Sky Chart', hotkey: '1', icon: Sparkles },
  { id: 'log', label: 'Observing Log', hotkey: '2', icon: CalendarClock },
  { id: 'calc', label: 'Calculators', hotkey: '3', icon: Orbit },
  { id: 'live', label: 'Live Data', hotkey: '4', icon: Radio },
  { id: 'assistant', label: 'Assistant', hotkey: '5', icon: Bot },
];

export default function AstronomyLensPage() {
  useLensNav('astronomy');
  const { latestData: realtimeData, isLive, lastUpdated, insights } = useRealtimeLens('astronomy');
  const [group, setGroup] = useState<GroupId>('sky');
  const searchInputRef = useRef<HTMLInputElement>(null);

  useLensCommand(
    [
      ...GROUPS.map((g) => ({
        id: `group-${g.id}`,
        keys: g.hotkey,
        description: `Go to ${g.label}`,
        category: 'navigation' as const,
        action: () => setGroup(g.id),
      })),
      { id: 'focus-search', keys: '/', description: 'Focus search', category: 'navigation' as const, action: () => searchInputRef.current?.focus() },
    ],
    { lensId: 'astronomy' }
  );

  const renderGroup = () => {
    switch (group) {
      case 'sky':
        return <SkyChartWorkbench />;
      case 'log':
        return <AstronomySkySection />;
      case 'calc':
        return <AstroCalculators />;
      case 'live':
        return (
          <div className="space-y-4">
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
              <SpaceflightNewsPanel domain="astronomy" />
              <UpcomingLaunchesPanel domain="astronomy" />
            </div>
            <IssPassPanel domain="astronomy" />
            <section className="rounded-xl">
              <NasaLivePanel />
            </section>
            <section className="rounded-xl border border-zinc-800 bg-zinc-950/40 p-4">
              <NasaExplorer />
            </section>
          </div>
        );
      case 'assistant':
        return (
          <PipingProvider>
            <div className="space-y-3">
              <LensFeedButton domain="astronomy" />
              <AstronomyActionPanel />
            </div>
          </PipingProvider>
        );
      default:
        return null;
    }
  };

  return (
    <LensShell lensId="astronomy" asMain={false}>
      <FirstRunTour lensId="astronomy" />
      <div data-lens-theme="astronomy" className="min-h-full p-4 space-y-4">
        {/* Command bar */}
        <header className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex items-center gap-3">
            <div className="w-9 h-9 rounded-lg bg-indigo-500/20 flex items-center justify-center shrink-0">
              <Orbit className="w-5 h-5 text-indigo-400" />
            </div>
            <div>
              <div className="flex items-center gap-2">
                <h1 className="text-xl font-bold">Astronomy</h1>
                <DepthBadge lensId="astronomy" size="sm" />
              </div>
              <div className="flex items-center gap-2 text-xs text-gray-400">
                <LiveIndicator isLive={isLive} lastUpdated={lastUpdated} compact />
                <span>Celestial catalog, observation logging, and mission-planning calculators</span>
              </div>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <span className="hidden md:flex items-center gap-1 text-[10px] text-gray-600" title="1–5 switch view · / focus search">
              <Keyboard className="w-3.5 h-3.5" /> 1–5 · /
            </span>
            <DTUExportButton domain="astronomy" data={{}} compact />
          </div>
        </header>

        {/* Tabs */}
        <nav className="flex gap-2 border-b border-white/10 pb-2 overflow-x-auto">
          {GROUPS.map((g) => {
            const Icon = g.icon;
            const active = group === g.id;
            return (
              <button
                key={g.id}
                onClick={() => setGroup(g.id)}
                className={cn(
                  'flex items-center gap-1.5 px-4 py-2 rounded-t-lg text-sm font-medium whitespace-nowrap transition-colors',
                  active
                    ? 'bg-indigo-400/20 text-indigo-400 border-b-2 border-indigo-400'
                    : 'text-gray-400 hover:text-white'
                )}
              >
                <Icon className="w-3.5 h-3.5" /> {g.label}
              </button>
            );
          })}
        </nav>

        <div className="min-h-[240px]">{renderGroup()}</div>

        {insights && (
          <RealtimeDataPanel domain="astronomy" data={realtimeData} isLive={isLive} lastUpdated={lastUpdated} insights={insights} compact />
        )}
      </div>
    </LensShell>
  );
}
