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
import { NorthStarFrame } from '@/components/lens/NorthStarFrame';
import { useAuth } from '@/hooks/useAuth';
import { titleCaseDisplayName } from '@/components/chat/claudeCleanGreeting';
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
  { id: 'Workbench', icon: Users, label: 'Workbench' },
  { id: 'Campaigns', icon: Megaphone, label: 'Campaigns' },
  { id: 'Analysis', icon: Sparkles, label: 'Quick Analysis' },
  { id: 'Explorer', icon: HeartHandshake, label: '990 Explorer' },
];

export default function NonprofitLensPage() {
  useLensNav('nonprofit');
  const { latestData: realtimeData, isLive, lastUpdated, insights: realtimeInsights } = useRealtimeLens('nonprofit');

  const { user } = useAuth();
  const who = titleCaseDisplayName(user?.username);
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
      <NorthStarFrame
        lensId="nonprofit"
        crumb="Nonprofit"
        title={`Giving${who ? `, ${who}` : ''}`}
        subtitle="Donors, gifts, grants, campaigns, volunteers and 990 research"
        actions={
          <>
            <LiveIndicator isLive={isLive} lastUpdated={lastUpdated} compact />
            <DTUExportButton domain="nonprofit" data={realtimeData || {}} compact />
          </>
        }
        tabs={MODE_TABS}
        activeTab={mode}
        onTab={(id) => setMode(id as ModeTab)}
        tabsLabel="Nonprofit views"
        cta={{ label: 'Record a gift', icon: Heart, onClick: () => setMode('Workbench'), title: 'Open the donor workbench' }}
      >
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

        {realtimeData && (
          <RealtimeDataPanel domain="nonprofit" data={realtimeData} isLive={isLive} lastUpdated={lastUpdated} insights={realtimeInsights} compact />
        )}
      </NorthStarFrame>
      <SessionRail lensId="nonprofit" hideWhenEmpty className="mt-4" />
    </LensShell>
  );
}
