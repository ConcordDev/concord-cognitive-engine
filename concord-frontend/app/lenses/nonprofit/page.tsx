'use client';

/* ------------------------------------------------------------------ */
/*  Nonprofit lens — donor CRM, recurring giving, campaigns, grants,   */
/*  volunteers, P2P fundraising, and ProPublica 990 lookup.            */
/*  All 49 `nonprofit.*` macros are real (server/domains/nonprofit.js).*/
/*  Every value rendered here comes from a real macro call — no seed/  */
/*  mock data. See docs/lens-specs/nonprofit-capability-map.md.        */
/* ------------------------------------------------------------------ */

import { useState } from 'react';
import { LensShell } from '@/components/lens/LensShell';
import { SessionRail } from '@/components/lens/SessionRail';
import { CrossLensRecentsPanel } from '@/components/lens/CrossLensRecentsPanel';
import { FirstRunTour } from '@/components/lens/FirstRunTour';
import { DepthBadge } from '@/components/lens/DepthBadge';
import { PropublicaSearch } from '@/components/nonprofit/PropublicaSearch';
import { NonprofitActionPanel } from '@/components/nonprofit/NonprofitActionPanel';
import { CampaignManager } from '@/components/nonprofit/CampaignManager';
import { NonprofitWorkbench } from '@/components/nonprofit/NonprofitWorkbench';
import { NonprofitOverviewPanel } from '@/components/nonprofit/NonprofitOverviewPanel';
import { PipingProvider } from '@/components/panel-polish';
import { useLensNav } from '@/hooks/useLensNav';
import { useLensCommand } from '@/hooks/useLensCommand';
import { ds } from '@/lib/design-system';
import { cn } from '@/lib/utils';
import {
  Heart, LayoutDashboard, Users, Megaphone, Sparkles, HeartHandshake,
} from 'lucide-react';
import { useRealtimeLens } from '@/hooks/useRealtimeLens';
import { LiveIndicator } from '@/components/lens/LiveIndicator';
import { DTUExportButton } from '@/components/lens/DTUExportButton';
import { RealtimeDataPanel } from '@/components/lens/RealtimeDataPanel';

/* ------------------------------------------------------------------ */
/*  Tabs — every tab below is backed by a real, macro-calling          */
/*  component (no generic artifact-store CRUD). Overview aggregates    */
/*  nonprofit-dashboard + donor-list + volunteer-list; Workbench is     */
/*  the Bloomerang/Givebutter donor-CRM + recurring-giving + comms +    */
/*  receipts + donation-pages + volunteers + P2P surface; Campaigns is  */
/*  campaign CRUD + donation log; Analysis is the ad-hoc retention/     */
/*  grant/pace calculators + ProPublica EIN lookup + mint/DM/publish/   */
/*  agent; Explorer is the ProPublica name-search browser.              */
/* ------------------------------------------------------------------ */

type ModeTab = 'Overview' | 'Workbench' | 'Campaigns' | 'Analysis' | 'Explorer';

const MODE_TABS: { id: ModeTab; icon: typeof Heart; label: string }[] = [
  { id: 'Overview', icon: LayoutDashboard, label: 'Overview' },
  { id: 'Workbench', icon: Users, label: 'Donor & Fundraising Workbench' },
  { id: 'Campaigns', icon: Megaphone, label: 'Campaigns' },
  { id: 'Analysis', icon: Sparkles, label: 'Quick Analysis' },
  { id: 'Explorer', icon: HeartHandshake, label: '990 Explorer' },
];

export default function NonprofitLensPage() {
  useLensNav('nonprofit');
  const { latestData: realtimeData, isLive, lastUpdated, insights: realtimeInsights } = useRealtimeLens('nonprofit');

  const [mode, setMode] = useState<ModeTab>('Overview');

  useLensCommand(
    MODE_TABS.map((tab, i) => ({
      id: `tab-${tab.id}`,
      keys: String(i + 1),
      description: `Switch to ${tab.label}`,
      category: 'navigation' as const,
      action: () => setMode(tab.id),
    })),
    { lensId: 'nonprofit' },
  );

  return (
    <LensShell lensId="nonprofit" asMain={false}>
      <FirstRunTour lensId="nonprofit" />      <DepthBadge lensId="nonprofit" size="sm" className="ml-2" />
      <div data-lens-theme="nonprofit" className={ds.pageContainer}>
        <header className={ds.sectionHeader}>
          <div className="flex items-center gap-3">
            <Heart className="w-7 h-7 text-neon-pink" />
            <div>
              <div className="flex items-center gap-2">
                <h1 className={ds.heading1}>Nonprofit &amp; Community</h1>
                <LiveIndicator isLive={isLive} lastUpdated={lastUpdated} compact />
              </div>
              <p className={ds.textMuted}>Donors, gifts, grants, campaigns, volunteers, and 990 research</p>
            </div>
          </div>
          <DTUExportButton domain="nonprofit" data={realtimeData || {}} compact />
        </header>

        {realtimeData && (
          <RealtimeDataPanel domain="nonprofit" data={realtimeData} isLive={isLive} lastUpdated={lastUpdated} insights={realtimeInsights} compact />
        )}

        <nav className="flex items-center gap-1 border-b border-lattice-border pb-3 flex-wrap">
          {MODE_TABS.map((tab) => {
            const Icon = tab.icon;
            return (
              <button
                key={tab.id}
                onClick={() => setMode(tab.id)}
                className={cn(
                  'flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-medium transition-colors whitespace-nowrap',
                  mode === tab.id ? 'bg-neon-pink/20 text-neon-pink' : 'text-gray-400 hover:text-white hover:bg-lattice-elevated',
                )}
              >
                <Icon className="w-4 h-4" />
                {tab.label}
              </button>
            );
          })}
        </nav>

        {mode === 'Overview' && <NonprofitOverviewPanel />}
        {mode === 'Workbench' && <NonprofitWorkbench />}
        {mode === 'Campaigns' && <CampaignManager />}
        {mode === 'Analysis' && (
          <PipingProvider>
            <NonprofitActionPanel />
          </PipingProvider>
        )}
        {mode === 'Explorer' && (
          <section className="rounded-xl border border-zinc-800 bg-zinc-950/40 p-4">
            <PropublicaSearch />
          </section>
        )}
      </div>

      <a href="#nonprofit-skip" className="sr-only focus:not-sr-only focus:ring-2 focus:ring-amber-500 focus:outline-none">Skip to nonprofit content</a>
      <SessionRail lensId="nonprofit" hideWhenEmpty className="mt-4" />      <CrossLensRecentsPanel lensId="nonprofit" sinceDays={7} limit={6} hideWhenEmpty className="mt-3" />
    </LensShell>
  );
}
