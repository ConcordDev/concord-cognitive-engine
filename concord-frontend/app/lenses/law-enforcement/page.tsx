'use client';

/* ------------------------------------------------------------------ */
/*  Law-enforcement lens — RMS/CAD parity (Axon Records / Mark43).     */
/*  All 29 `law-enforcement.*` macros are real                         */
/*  (server/domains/lawenforcement.js). Every value rendered here      */
/*  comes from a real macro call — no seed/mock data. See               */
/*  docs/lens-specs/law-enforcement-capability-map.md.                 */
/* ------------------------------------------------------------------ */

import { useState } from 'react';
import { LensShell } from '@/components/lens/LensShell';
import { CrossLensRecentsPanel } from '@/components/lens/CrossLensRecentsPanel';
import { FirstRunTour } from '@/components/lens/FirstRunTour';
import { DepthBadge } from '@/components/lens/DepthBadge';
import { PoliceFeed } from '@/components/law-enforcement/PoliceFeed';
import { LawEnforcementActionPanel } from '@/components/law-enforcement/LawEnforcementActionPanel';
import { RmsCadConsole } from '@/components/law-enforcement/RmsCadConsole';
import { LawEnforcementOverviewPanel } from '@/components/law-enforcement/LawEnforcementOverviewPanel';
import { CaseManagementPanel } from '@/components/law-enforcement/CaseManagementPanel';
import { PipingProvider } from '@/components/panel-polish';
import { useLensCommand } from '@/hooks/useLensCommand';
import { ds } from '@/lib/design-system';
import { cn } from '@/lib/utils';
import { Shield, LayoutDashboard, Radio, Sparkles, Newspaper, FolderOpen } from 'lucide-react';

/* ------------------------------------------------------------------ */
/*  Tabs — every tab below is backed by real, macro-calling components */
/*  (no generic artifact-store CRUD). Overview aggregates cadCallQueue/ */
/*  cadUnitBoard/rosterBoard/evidenceList/warrantList/reportList/       */
/*  bookingList; Cases is the persisted Case entity (migration 362 —   */
/*  caseCreate/caseGet/caseList/caseUpdate/caseLinked) with a real      */
/*  status lifecycle + linkage to reports/evidence/bookings/warrants   */
/*  by case number; Console is the full RMS/CAD console (dispatch,     */
/*  evidence chain-of-custody, roster, crime map, warrants, reports,   */
/*  booking); Analysis is the ad-hoc case-strength / patrol-allocation /*/
/*  crime-stats calculators + incident report + mint/DM/publish/agent; */
/*  Field Notes is the real-world LE-subreddit pulse.                  */
/* ------------------------------------------------------------------ */

type ModeTab = 'Overview' | 'Cases' | 'Console' | 'Analysis' | 'Field Notes';

const MODE_TABS: { id: ModeTab; icon: typeof Shield; label: string }[] = [
  { id: 'Overview', icon: LayoutDashboard, label: 'Overview' },
  { id: 'Cases', icon: FolderOpen, label: 'Cases' },
  { id: 'Console', icon: Radio, label: 'RMS / CAD Console' },
  { id: 'Analysis', icon: Sparkles, label: 'Quick Analysis' },
  { id: 'Field Notes', icon: Newspaper, label: 'Field Notes' },
];

export default function LawEnforcementLensPage() {
  const [mode, setMode] = useState<ModeTab>('Overview');

  useLensCommand(
    MODE_TABS.map((tab, i) => ({
      id: `tab-${tab.id}`,
      keys: String(i + 1),
      description: `Switch to ${tab.label}`,
      category: 'navigation' as const,
      action: () => setMode(tab.id),
    })),
    { lensId: 'law-enforcement' },
  );

  return (
    <LensShell lensId="law-enforcement" asMain={false}>
      <FirstRunTour lensId="law-enforcement" />      <DepthBadge lensId="law-enforcement" size="sm" className="ml-2" />
      <div data-lens-theme="law-enforcement" className={ds.pageContainer}>
        <header className={ds.sectionHeader}>
          <div className="flex items-center gap-3">
            <Shield className="w-7 h-7 text-blue-400" />
            <div>
              <h1 className={ds.heading1}>Law Enforcement</h1>
              <p className={ds.textMuted}>Dispatch, evidence chain-of-custody, roster, crime mapping, warrants &amp; reports</p>
            </div>
          </div>
        </header>

        <nav className="flex items-center gap-1 border-b border-lattice-border pb-3 flex-wrap">
          {MODE_TABS.map((tab) => {
            const Icon = tab.icon;
            return (
              <button
                key={tab.id}
                onClick={() => setMode(tab.id)}
                className={cn(
                  'flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-medium transition-colors whitespace-nowrap',
                  mode === tab.id ? 'bg-blue-500/20 text-blue-300' : 'text-gray-400 hover:text-white hover:bg-lattice-elevated',
                )}
              >
                <Icon className="w-4 h-4" />
                {tab.label}
              </button>
            );
          })}
        </nav>

        {mode === 'Overview' && <LawEnforcementOverviewPanel />}
        {mode === 'Cases' && <CaseManagementPanel />}
        {mode === 'Console' && <RmsCadConsole />}
        {mode === 'Analysis' && (
          <PipingProvider>
            <LawEnforcementActionPanel />
          </PipingProvider>
        )}
        {mode === 'Field Notes' && (
          <section className="rounded-xl border border-zinc-800 bg-zinc-950/40 p-4">
            <PoliceFeed />
          </section>
        )}
      </div>

      <a href="#law-enforcement-skip" className="sr-only focus:not-sr-only focus:ring-2 focus:ring-amber-500 focus:outline-none">Skip to law-enforcement content</a>      <CrossLensRecentsPanel lensId="law-enforcement" sinceDays={7} limit={6} hideWhenEmpty className="mt-3" />
    </LensShell>
  );
}
