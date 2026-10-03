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
import { Orbit, Plus, Sparkles, CalendarClock, Radio, Bot } from 'lucide-react';
import { LensShell } from '@/components/lens/LensShell';
import { FirstRunTour } from '@/components/lens/FirstRunTour';
import { DepthBadge } from '@/components/lens/DepthBadge';
import { DTUExportButton } from '@/components/lens/DTUExportButton';
import { LiveIndicator } from '@/components/lens/LiveIndicator';
import { RealtimeDataPanel } from '@/components/lens/RealtimeDataPanel';
import { LensFeedButton } from '@/components/lens/LensFeedButton';
import { NorthStarFrame } from '@/components/lens/NorthStarFrame';
import { useAuth } from '@/hooks/useAuth';
import { titleCaseDisplayName } from '@/components/chat/claudeCleanGreeting';
import { PipingProvider } from '@/components/panel-polish';
import { useLensNav } from '@/hooks/useLensNav';
import { useLensCommand } from '@/hooks/useLensCommand';
import { useRealtimeLens } from '@/hooks/useRealtimeLens';

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
  const { user } = useAuth();
  const who = titleCaseDisplayName(user?.username);
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
            <section className="rounded-2xl border border-white/10 bg-[#111] p-4">
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
        // Unreachable given GroupId's closed union + the switch above
        // covers every member, but if a future group is ever added to
        // GROUPS without a matching case, this keeps the user looking at
        // an honest message instead of a blank screen.
        return (
          <div className="rounded-2xl border border-white/10 bg-[#111] p-6 text-center text-sm text-zinc-400">
            No panel is wired for this view yet.
          </div>
        );
    }
  };

  const titles: Record<GroupId, string> = {
    sky: `Look up${who ? `, ${who}` : ''}`,
    log: 'Log what you observed',
    calc: 'Work out the orbit',
    live: 'Follow the sky live',
    assistant: 'Ask the observatory',
  };

  return (
    <LensShell lensId="astronomy" asMain={false}>
      <FirstRunTour lensId="astronomy" />
      <NorthStarFrame
        lensId="astronomy"
        crumb="Astronomy"
        title={titles[group]}
        subtitle="Celestial catalog, observation logging, and mission-planning calculators"
        actions={(
          <>
            <DepthBadge lensId="astronomy" size="sm" />
            <LiveIndicator isLive={isLive} lastUpdated={lastUpdated} compact />
            <DTUExportButton domain="astronomy" data={{}} compact />
          </>
        )}
        tabs={GROUPS.map((g) => ({ id: g.id, label: g.label, icon: g.icon, keys: g.hotkey }))}
        activeTab={group}
        onTab={(id) => setGroup(id as GroupId)}
        tabsLabel="Astronomy views"
        cta={{ label: 'Log an observation', icon: Plus, onClick: () => setGroup('log'), title: 'Open the observing log (2)' }}
      >
        <div className="min-h-[240px]">{renderGroup()}</div>

        {insights && (
          <div className="mt-5">
            <RealtimeDataPanel domain="astronomy" data={realtimeData} isLive={isLive} lastUpdated={lastUpdated} insights={insights} compact />
          </div>
        )}
      </NorthStarFrame>
    </LensShell>
  );
}
