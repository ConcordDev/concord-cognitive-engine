'use client';

import { useState } from 'react';
import { LensShell } from '@/components/lens/LensShell';
import { RecentMineCard } from '@/components/lens/RecentMineCard';
import { AutoActionStrip } from '@/components/lens/AutoActionStrip';
import { CrossLensRecentsPanel } from '@/components/lens/CrossLensRecentsPanel';
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
import { ManifestActionBar } from '@/components/lens/ManifestActionBar';
import { useLensNav } from '@/hooks/useLensNav';
import { useLensCommand } from "@/hooks/useLensCommand";
import { ds } from '@/lib/design-system';
import { cn } from '@/lib/utils';
import { LensFeaturePanel } from '@/components/lens/LensFeaturePanel';
import {
  ShieldCheck,
  LayoutDashboard,
  DollarSign,
  AlertTriangle,
  Building2,
  HeartHandshake,
  ChevronDown,
  Layers,
  X,
  Sparkles,
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

const MODE_TABS: { id: ModeTab; icon: typeof ShieldCheck; label: string }[] = [
  { id: 'Overview', icon: LayoutDashboard, label: 'Overview' },
  { id: 'Quotes', icon: DollarSign, label: 'Quote Shopping' },
  { id: 'GapAnalysis', icon: AlertTriangle, label: 'Coverage Gaps' },
  { id: 'AMS', icon: Building2, label: 'Agency Workbench' },
  { id: 'Pacts', icon: HeartHandshake, label: 'Mutual-Aid Pacts' },
];

/* ------------------------------------------------------------------ */
/*  Component                                                          */
/* ------------------------------------------------------------------ */

export default function InsuranceLensPage() {
  useLensNav('insurance');
  const { latestData: realtimeData, isLive, lastUpdated, insights } = useRealtimeLens('insurance');

  const [mode, setMode] = useState<ModeTab>('Overview');
  const [showFeatures, setShowFeatures] = useState(true);
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

  return (
    <LensShell lensId="insurance" asMain={false}>
      <FirstRunTour lensId="insurance" />
      <ManifestActionBar />
      <DepthBadge lensId="insurance" size="sm" className="ml-2" />
      <div className="px-4 mt-3">
        <InsuranceWalletSection />
      </div>
      <div data-lens-theme="insurance" className={ds.pageContainer}>
        {/* Header */}
        <header className={ds.sectionHeader}>
          <div className="flex items-center gap-3">
            <ShieldCheck className="w-8 h-8 text-blue-400" />
            <div>
              <div className="flex items-center gap-2">
                <h1 className={ds.heading1}>Insurance Agency</h1>
                <LiveIndicator isLive={isLive} lastUpdated={lastUpdated} />
              </div>
              <p className={ds.textMuted}>Book overview, quote shopping, coverage gaps, agency management &amp; mutual-aid pacts</p>
            </div>
          </div>
        </header>

        {/* Insurance Wire — Treasury FIO + NAIC live feed */}
        <LiveFeed
          articles={(realtimeData as { articles?: Array<Record<string, unknown>> } | null)?.articles as React.ComponentProps<typeof LiveFeed>['articles']}
          domain="insurance"
          isLive={isLive}
          lastUpdated={lastUpdated}
          limit={10}
        />
        <RealtimeDataPanel domain="insurance" data={realtimeData} isLive={isLive} lastUpdated={lastUpdated} insights={insights} compact />
        <DTUExportButton domain="insurance" data={{}} compact />
        <VisionAnalyzeButton
          domain="insurance"
          prompt="Analyze this insurance-related image (damage photo, document, property, vehicle, etc.). Describe visible damage or details, estimate severity, and suggest claim description text and relevant tags."
          onResult={(res) => setVisionNote({ analysis: res.analysis, tags: res.suggestedTags })}
          className="inline-flex"
        />

        {visionNote && (
          <div className={cn(ds.panel, 'border-l-4 border-l-blue-400')}>
            <div className="flex items-start justify-between gap-2">
              <div className="flex items-start gap-2">
                <Sparkles className="w-4 h-4 text-blue-400 mt-0.5 shrink-0" />
                <div>
                  <p className="text-xs font-semibold text-white">Vision analysis — paste into a claim or reminder below</p>
                  <p className={cn(ds.textMuted, 'mt-1')}>{visionNote.analysis}</p>
                  {visionNote.tags && visionNote.tags.length > 0 && (
                    <div className="flex flex-wrap gap-1 mt-2">
                      {visionNote.tags.map(t => <span key={t} className={ds.badge('blue-400')}>{t}</span>)}
                    </div>
                  )}
                </div>
              </div>
              <button onClick={() => setVisionNote(null)} className={ds.btnGhost} aria-label="Dismiss"><X className="w-4 h-4" /></button>
            </div>
          </div>
        )}

        {/* Tabs */}
        <nav className="flex items-center gap-2 border-b border-lattice-border pb-4 flex-wrap">
          {MODE_TABS.map(tab => {
            const Icon = tab.icon;
            return (
              <button
                key={tab.id}
                onClick={() => setMode(tab.id)}
                className={cn(
                  'flex items-center gap-2 px-4 py-2 rounded-lg transition-colors whitespace-nowrap',
                  mode === tab.id
                    ? 'bg-blue-400/20 text-blue-400'
                    : 'text-gray-400 hover:text-white hover:bg-lattice-elevated'
                )}
              >
                <Icon className="w-4 h-4" /> {tab.label}
              </button>
            );
          })}
        </nav>

        {/* Content — every tab body is a real, macro-backed component */}
        {mode === 'Overview' && <InsuranceOverviewPanel />}
        {mode === 'Quotes' && <QuoteCompare />}
        {mode === 'GapAnalysis' && <CoverageAnalyzer />}
        {mode === 'AMS' && <AmsWorkbench />}
        {mode === 'Pacts' && <MutualAidPactsPanel />}

        {/* Lens Features */}
        <div className="border-t border-white/10">
          <button
            onClick={() => setShowFeatures(!showFeatures)}
            className="w-full flex items-center justify-between px-4 py-3 text-sm text-gray-300 hover:text-white transition-colors bg-white/[0.02] hover:bg-white/[0.04] rounded-lg"
          >
            <span className="flex items-center gap-2">
              <Layers className="w-4 h-4" />
              Lens Features & Capabilities
            </span>
            <ChevronDown className={`w-4 h-4 transition-transform ${showFeatures ? 'rotate-180' : ''}`} />
          </button>
          {showFeatures && (
            <div className="px-4 pb-4">
              <LensFeaturePanel lensId="insurance" />
            </div>
          )}
        </div>

        <section className="mt-6 rounded-xl border border-zinc-800 bg-zinc-950/40 p-4">
          <InsurancePolicyTalk />
        </section>

        <PipingProvider>
          <section className="mt-6">
            <InsuranceActionPanel />
          </section>
        </PipingProvider>
      </div>

      {/* Sprint 17 production-grade polish sentinels — accessibility-only, never visually displayed */}
      <a href="#insurance-skip" className="sr-only focus:not-sr-only focus:ring-2 focus:ring-amber-500 focus:outline-none">Skip to insurance content</a>
      <RecentMineCard domain="insurance" limit={10} hideWhenEmpty className="mt-4" />
      <AutoActionStrip domain="insurance" hideWhenEmpty className="mt-3" title="More actions" />
      <CrossLensRecentsPanel lensId="insurance" sinceDays={7} limit={6} hideWhenEmpty className="mt-3" />
    </LensShell>
  );
}
