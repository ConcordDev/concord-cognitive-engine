'use client';

import { useCallback, useState } from 'react';
import { LensShell } from '@/components/lens/LensShell';
import { NorthStarFrame } from '@/components/lens/NorthStarFrame';
import { useAuth } from '@/hooks/useAuth';
import { titleCaseDisplayName } from '@/components/chat/claudeCleanGreeting';
import { FirstRunTour } from '@/components/lens/FirstRunTour';
import { DepthBadge } from '@/components/lens/DepthBadge';
import { MarketingDashboardSection } from '@/components/marketing/MarketingDashboardSection';
import { MarketingFeed } from '@/components/marketing/MarketingFeed';
import { MarketingActionPanel } from '@/components/marketing/MarketingActionPanel';
import { MarketingEmailPanel } from '@/components/marketing/MarketingEmailPanel';
import { MarketingWorkflowsPanel } from '@/components/marketing/MarketingWorkflowsPanel';
import { MarketingPagesPanel } from '@/components/marketing/MarketingPagesPanel';
import { MarketingSocialPanel } from '@/components/marketing/MarketingSocialPanel';
import { MarketingScoringPanel } from '@/components/marketing/MarketingScoringPanel';
import { MarketingSEOPanel } from '@/components/marketing/MarketingSEOPanel';
import { MarketingContactsPanel } from '@/components/marketing/MarketingContactsPanel';
import { MarketingCalendarPanel } from '@/components/marketing/MarketingCalendarPanel';
import { PipingProvider } from '@/components/panel-polish';
import { useLensNav } from '@/hooks/useLensNav';
import { useLensCommand } from '@/hooks/useLensCommand';
import { cn } from '@/lib/utils';
import {
  Mail, Share2, Globe, Workflow, LayoutTemplate,
  SlidersHorizontal, Contact, CalendarDays, Sparkles,
} from 'lucide-react';
import { useRealtimeLens } from '@/hooks/useRealtimeLens';
import { LiveIndicator } from '@/components/lens/LiveIndicator';
import { DTUExportButton } from '@/components/lens/DTUExportButton';
import { RealtimeDataPanel } from '@/components/lens/RealtimeDataPanel';

/**
 * Marketing lens — a real HubSpot/Mailchimp-parity marketing OS.
 *
 * The domain's 64 macros are already fully surfaced by real, macro-wired
 * panels: `MarketingDashboardSection` owns the Marketing Hub (campaigns
 * with daily metric logging + KPIs + budget pacing, leads/CRM pipeline
 * with attribution, content calendar + A/B tests, channel performance +
 * segments); the "Execution Studio" tab strip below covers email
 * (real send path), workflow automation, landing pages, social scheduling,
 * lead scoring models, SEO audits, a full contacts CRM, and the campaign
 * calendar; `MarketingActionPanel` is the quick-analysis desk for the four
 * pure-compute macros (ROI / A-B test significance / funnel / audience
 * segment); `MarketingFeed` pulls live real-world marketing discussion.
 * This page is their shell — no separate fake CRUD store duplicating what
 * the Hub already does, no generic macro-button wall.
 */

type StudioTab = 'email' | 'workflows' | 'pages' | 'social' | 'scoring' | 'seo' | 'crm' | 'calendar';

const STUDIO_TABS: { id: StudioTab; label: string; icon: typeof Mail; key: string }[] = [
  { id: 'email', label: 'Email', icon: Mail, key: '1' },
  { id: 'workflows', label: 'Workflows', icon: Workflow, key: '2' },
  { id: 'pages', label: 'Landing Pages', icon: LayoutTemplate, key: '3' },
  { id: 'social', label: 'Social', icon: Share2, key: '4' },
  { id: 'scoring', label: 'Lead Scoring', icon: SlidersHorizontal, key: '5' },
  { id: 'seo', label: 'SEO', icon: Globe, key: '6' },
  { id: 'crm', label: 'CRM', icon: Contact, key: '7' },
  { id: 'calendar', label: 'Calendar', icon: CalendarDays, key: '8' },
];

export default function MarketingLensPage() {
  useLensNav('marketing');
  const { latestData: realtimeData, isLive, lastUpdated, insights } = useRealtimeLens('marketing');

  const { user } = useAuth();
  const who = titleCaseDisplayName(user?.username);
  const [studioTab, setStudioTab] = useState<StudioTab>('email');

  const composeEmail = useCallback(() => {
    setStudioTab('email');
    requestAnimationFrame(() => document.getElementById('marketing-studio')?.scrollIntoView({ behavior: 'smooth', block: 'start' }));
  }, []);

  useLensCommand(
    STUDIO_TABS.map((t) => ({
      id: `studio-${t.id}`,
      keys: t.key,
      description: `Execution Studio: ${t.label}`,
      category: 'navigation' as const,
      action: () => setStudioTab(t.id),
    })),
    { lensId: 'marketing' }
  );

  const renderStudioPanel = () => {
    switch (studioTab) {
      case 'email': return <MarketingEmailPanel />;
      case 'workflows': return <MarketingWorkflowsPanel />;
      case 'pages': return <MarketingPagesPanel />;
      case 'social': return <MarketingSocialPanel />;
      case 'scoring': return <MarketingScoringPanel />;
      case 'seo': return <MarketingSEOPanel />;
      case 'crm': return <MarketingContactsPanel />;
      case 'calendar': return <MarketingCalendarPanel />;
      default:
        // Unreachable given StudioTab's closed union + the switch above
        // covers every member, but if a future tab is ever added without
        // a matching case, this keeps the user looking at an honest
        // message instead of a blank screen.
        return (
          <div className="rounded-xl border border-zinc-800 bg-zinc-950/40 p-6 text-center text-sm text-zinc-400">
            No panel is wired for this view yet.
          </div>
        );
    }
  };

  return (
    <LensShell lensId="marketing" asMain={false}>
      <FirstRunTour lensId="marketing" />
      <DepthBadge lensId="marketing" size="sm" className="ml-2" />

      <NorthStarFrame
        lensId="marketing"
        crumb="Marketing"
        title={`Grow your audience${who ? `, ${who}` : ''}`}
        subtitle="Campaigns, leads, content, automation and analytics."
        actions={
          <>
            <LiveIndicator isLive={isLive} lastUpdated={lastUpdated} />
            <DTUExportButton domain="marketing" data={{}} compact />
          </>
        }
        cta={{ label: 'Compose an email', icon: Mail, onClick: composeEmail, title: 'Open the email studio' }}
      >
      <div data-lens-theme="marketing" className="space-y-6">
        <RealtimeDataPanel domain="marketing" data={realtimeData} isLive={isLive} lastUpdated={lastUpdated} insights={insights} compact />

        <MarketingDashboardSection />

        {/* Execution Studio — the HubSpot-parity action surfaces */}
        <section id="marketing-studio" className="scroll-mt-6 overflow-hidden rounded-2xl border border-white/10 bg-[#111]">
          <header className="flex items-center gap-2 px-4 py-3 border-b border-zinc-800 bg-gradient-to-r from-pink-600/15 to-transparent">
            <Sparkles className="w-5 h-5 text-pink-400" />
            <h2 className="text-sm font-bold text-zinc-100">Execution Studio</h2>
            <span className="text-[11px] text-zinc-400">email · automation · pages · social · scoring · SEO · CRM · calendar</span>
          </header>
          <nav className="flex gap-1 px-2 pt-2 border-b border-zinc-800 overflow-x-auto">
            {STUDIO_TABS.map((t) => {
              const Icon = t.icon;
              const active = studioTab === t.id;
              return (
                <button key={t.id} type="button" onClick={() => setStudioTab(t.id)}
                  className={cn('flex items-center gap-1.5 px-3 py-2 text-xs font-medium rounded-t-lg whitespace-nowrap focus:outline-none focus:ring-2 focus:ring-pink-500',
                    active ? 'bg-zinc-900 text-pink-300 border-x border-t border-zinc-800' : 'text-zinc-400 hover:text-zinc-200')}>
                  <Icon className="w-3.5 h-3.5" /> {t.label}
                </button>
              );
            })}
          </nav>
          <div className="p-4">{renderStudioPanel()}</div>
        </section>

        <section className="space-y-2">
          <h2 className="flex items-center gap-2 text-sm font-semibold text-white px-1">
            <Sparkles className="w-4 h-4 text-pink-400" /> Quick Analysis
          </h2>
          <PipingProvider>
            <MarketingActionPanel />
          </PipingProvider>
        </section>

        <section className="rounded-xl border border-zinc-800 bg-zinc-950/40 p-4">
          <MarketingFeed />
        </section>
      </div>
      </NorthStarFrame>
    </LensShell>
  );
}
