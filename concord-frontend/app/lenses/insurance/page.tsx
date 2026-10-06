'use client';

import { useState } from 'react';
import { LensShell } from '@/components/lens/LensShell';
import { NorthStarFrame } from '@/components/lens/NorthStarFrame';
import { FirstRunTour } from '@/components/lens/FirstRunTour';
import { DepthBadge } from '@/components/lens/DepthBadge';
import { InsuranceWalletSection } from '@/components/insurance/InsuranceWalletSection';
import { InsurancePolicyTalk } from '@/components/insurance/InsurancePolicyTalk';
import { InsuranceActionPanel } from '@/components/insurance/InsuranceActionPanel';
import { PipingProvider } from '@/components/panel-polish';
import InsuranceOverviewPanel from '@/components/insurance/InsuranceOverviewPanel';
import QuoteCompare from '@/components/insurance/QuoteCompare';
import CoverageAnalyzer from '@/components/insurance/CoverageAnalyzer';
import AmsWorkbench from '@/components/insurance/AmsWorkbench';
import MutualAidPactsPanel from '@/components/insurance/MutualAidPactsPanel';
import { useLensNav } from '@/hooks/useLensNav';
import { useLensCommand } from "@/hooks/useLensCommand";
import { useAuth } from '@/hooks/useAuth';
import { titleCaseDisplayName } from '@/components/chat/claudeCleanGreeting';
import {
  LayoutDashboard,
  DollarSign,
  AlertTriangle,
  Building2,
  HeartHandshake,
  X,
  Sparkles,
  Plus,
} from 'lucide-react';
import { useRealtimeLens } from '@/hooks/useRealtimeLens';
import { LiveIndicator } from '@/components/lens/LiveIndicator';
import { DTUExportButton } from '@/components/lens/DTUExportButton';
import { RealtimeDataPanel } from '@/components/lens/RealtimeDataPanel';
import { VisionAnalyzeButton } from '@/components/common/VisionAnalyzeButton';
import LiveFeed from '@/components/lens/LiveFeed';

/* ------------------------------------------------------------------ */
/*  Tabs — every tab below is backed by a real `insurance.*` macro.    */
/*  Policy / claim / agent / asset / reminder management already live  */
/*  in the always-visible InsuranceWalletSection above the tab bar, so */
/*  the tabs here cover the remaining, non-overlapping real surfaces:  */
/*  book overview, quote shopping, coverage-gap analysis, the Applied  */
/*  Epic / EZLynx-parity agency-management workbench, and mutual-aid   */
/*  death pacts.                                                       */
/* ------------------------------------------------------------------ */

type ModeTab = 'Overview' | 'Quotes' | 'GapAnalysis' | 'AMS' | 'Pacts';

const MODE_TABS: { id: ModeTab; icon: typeof LayoutDashboard; label: string; title: string }[] = [
  { id: 'Overview', icon: LayoutDashboard, label: 'Overview', title: 'Your book of business' },
  { id: 'Quotes', icon: DollarSign, label: 'Quote Shopping', title: 'The best price for the cover' },
  { id: 'GapAnalysis', icon: AlertTriangle, label: 'Coverage Gaps', title: 'Where you are exposed' },
  { id: 'AMS', icon: Building2, label: 'Agency Workbench', title: 'Run the agency' },
  { id: 'Pacts', icon: HeartHandshake, label: 'Mutual-Aid Pacts', title: 'Cover each other' },
];

/* ------------------------------------------------------------------ */
/*  Component                                                          */
/* ------------------------------------------------------------------ */

export default function InsuranceLensPage() {
  useLensNav('insurance');
  const { latestData: realtimeData, isLive, lastUpdated, insights } = useRealtimeLens('insurance');

  const { user } = useAuth();
  const who = titleCaseDisplayName(user?.username);
  const [mode, setMode] = useState<ModeTab>('Overview');
  const [visionNote, setVisionNote] = useState<{ analysis: string; tags?: string[] } | null>(null);

  useLensCommand(
    MODE_TABS.map((tab, i) => ({
      id: `tab-${tab.id}`,
      keys: String(i + 1),
      description: `Switch to ${tab.label}`,
      category: 'navigation' as const,
      action: () => setMode(tab.id),
    })),
    { lensId: "insurance" }
  );

  const current = MODE_TABS.find((t) => t.id === mode)!;

  return (
    <LensShell lensId="insurance" asMain={false}>
      <FirstRunTour lensId="insurance" />
      <DepthBadge lensId="insurance" size="sm" className="ml-2" />
      <NorthStarFrame
        lensId="insurance"
        crumb="Insurance"
        title={`${current.title}${mode === 'Overview' && who ? `, ${who}` : ''}`}
        subtitle="Policies, claims, quotes, coverage gaps, agency management and mutual-aid pacts."
        actions={
          <>
            <LiveIndicator isLive={isLive} lastUpdated={lastUpdated} compact />
            <DTUExportButton domain="insurance" data={{}} compact />
            <VisionAnalyzeButton
              domain="insurance"
              prompt="Analyze this insurance-related image (damage photo, document, property, vehicle, etc.). Describe visible damage or details, estimate severity, and suggest claim description text and relevant tags."
              onResult={(res) => setVisionNote({ analysis: res.analysis, tags: res.suggestedTags })}
              className="inline-flex"
            />
          </>
        }
        tabs={MODE_TABS.map((t, i) => ({ id: t.id, label: t.label, icon: t.icon, keys: String(i + 1) }))}
        activeTab={mode}
        onTab={(id) => setMode(id as ModeTab)}
        tabsLabel="Insurance views"
        cta={{
          label: 'Compare quotes',
          icon: Plus,
          onClick: () => setMode('Quotes'),
          title: 'Open quote shopping',
        }}
      >
        <div className="space-y-5">
          <InsuranceWalletSection />

          {visionNote && (
            <div className="rounded-2xl border border-white/10 border-l-4 border-l-blue-400 bg-[#111] p-4">
              <div className="flex items-start justify-between gap-2">
                <div className="flex items-start gap-2">
                  <Sparkles className="mt-0.5 h-4 w-4 shrink-0 text-blue-400" />
                  <div>
                    <p className="text-xs font-semibold text-white">Vision analysis — paste into a claim or reminder below</p>
                    <p className="mt-1 text-sm text-gray-400">{visionNote.analysis}</p>
                    {visionNote.tags && visionNote.tags.length > 0 && (
                      <div className="mt-2 flex flex-wrap gap-1">
                        {visionNote.tags.map((t) => (
                          <span key={t} className="rounded-full border border-blue-400/30 bg-blue-400/10 px-2 py-0.5 text-xs text-blue-300">{t}</span>
                        ))}
                      </div>
                    )}
                  </div>
                </div>
                <button type="button" onClick={() => setVisionNote(null)} className="rounded p-1 text-gray-400 hover:text-white" aria-label="Dismiss"><X className="h-4 w-4" /></button>
              </div>
            </div>
          )}

          {mode === 'Overview' && (
            <>
              <LiveFeed
                articles={(realtimeData as { articles?: Array<Record<string, unknown>> } | null)?.articles as React.ComponentProps<typeof LiveFeed>['articles']}
                domain="insurance"
                isLive={isLive}
                lastUpdated={lastUpdated}
                limit={10}
              />
              <RealtimeDataPanel domain="insurance" data={realtimeData} isLive={isLive} lastUpdated={lastUpdated} insights={insights} compact />
            </>
          )}

          {mode === 'Overview' && <InsuranceOverviewPanel />}
          {mode === 'Quotes' && <QuoteCompare />}
          {mode === 'GapAnalysis' && <CoverageAnalyzer />}
          {mode === 'AMS' && <AmsWorkbench />}
          {mode === 'Pacts' && <MutualAidPactsPanel />}

          <div className="grid gap-5 xl:grid-cols-2">
            <section className="rounded-2xl border border-white/10 bg-[#111] p-4">
              <h2 className="mb-3 text-sm font-semibold text-white">Community discussion (Reddit)</h2>
              <InsurancePolicyTalk />
            </section>
            <section className="rounded-2xl border border-white/10 bg-[#111] p-4">
              <h2 className="mb-3 text-sm font-semibold text-white">More actions</h2>
              <PipingProvider>
                <InsuranceActionPanel />
              </PipingProvider>
            </section>
          </div>
        </div>
      </NorthStarFrame>
    </LensShell>
  );
}
