'use client';

/**
 * Law enforcement lens: north-star chrome over RMS/CAD parity (Axon Records /
 * Mark43). All 29 `law-enforcement.*` macros are real
 * (server/domains/lawenforcement.js); every value rendered comes from a real
 * macro call. See docs/lens-specs/law-enforcement-capability-map.md.
 */

import { useState } from 'react';
import { LayoutDashboard, Radio, Sparkles, Newspaper, FolderOpen, FolderPlus } from 'lucide-react';
import { LensShell } from '@/components/lens/LensShell';
import { DepthBadge } from '@/components/lens/DepthBadge';
import { NorthStarFrame } from '@/components/lens/NorthStarFrame';
import { PoliceFeed } from '@/components/law-enforcement/PoliceFeed';
import { omitCommunityRedditViews } from '@/lib/community/reddit-flag';
import { CommunityRedditSlot } from '@/lib/community/CommunityRedditSlot';
import { LawEnforcementActionPanel } from '@/components/law-enforcement/LawEnforcementActionPanel';
import { RmsCadConsole } from '@/components/law-enforcement/RmsCadConsole';
import { LawEnforcementOverviewPanel } from '@/components/law-enforcement/LawEnforcementOverviewPanel';
import { CaseManagementPanel } from '@/components/law-enforcement/CaseManagementPanel';
import { PipingProvider } from '@/components/panel-polish';
import { useLensCommand } from '@/hooks/useLensCommand';

type ModeTab = 'Overview' | 'Cases' | 'Console' | 'Analysis' | 'Field Notes';

const MODE_TABS: { id: ModeTab; icon: typeof LayoutDashboard; label: string; hint: string }[] = [
  { id: 'Overview', icon: LayoutDashboard, label: 'Overview', hint: 'Calls, units, roster, evidence, warrants, reports, bookings' },
  { id: 'Cases', icon: FolderOpen, label: 'Cases', hint: 'Case lifecycle with linked reports, evidence, bookings and warrants' },
  { id: 'Console', icon: Radio, label: 'RMS / CAD Console', hint: 'Dispatch, chain-of-custody, roster, crime map, warrants, reports, booking' },
  { id: 'Analysis', icon: Sparkles, label: 'Quick Analysis', hint: 'Case strength, patrol allocation, crime stats, incident report' },
  { id: 'Field Notes', icon: Newspaper, label: 'Field Notes', hint: 'Live law-enforcement community pulse' },
];

export default function LawEnforcementLensPage() {
  const [mode, setMode] = useState<ModeTab>('Overview');
  const modeTabs = omitCommunityRedditViews(MODE_TABS, ['Field Notes']);

  useLensCommand(
    [
      ...modeTabs.map((tab, i) => ({
        id: `tab-${tab.id}`,
        keys: String(i + 1),
        description: `Switch to ${tab.label}`,
        category: 'navigation' as const,
        action: () => setMode(tab.id),
      })),
      { id: 'le-open-case', keys: 'n', description: 'Open a case', category: 'actions' as const, action: () => setMode('Cases') },
    ],
    { lensId: 'law-enforcement' },
  );


  return (
    <LensShell lensId="law-enforcement" asMain={false}>

      <DepthBadge lensId="law-enforcement" size="sm" className="ml-2" />
      <NorthStarFrame
        lensId="law-enforcement"
        crumb="Law Enforcement"
        subtitle="Dispatch, evidence chain-of-custody, roster, crime mapping, warrants and reports."
        tabs={modeTabs.map((t, i) => ({ id: t.id, label: t.label, keys: String(i + 1), hint: t.hint, icon: t.icon }))}
        activeTab={mode}
        onTab={(id) => setMode(id as ModeTab)}
        cta={{ label: 'Open a case', icon: FolderPlus, onClick: () => setMode('Cases'), title: 'Open a case (N)' }}
      >
        {mode === 'Overview' && <LawEnforcementOverviewPanel />}
        {mode === 'Cases' && <CaseManagementPanel />}
        {mode === 'Console' && <RmsCadConsole />}
        {mode === 'Analysis' && (
          <PipingProvider>
            <LawEnforcementActionPanel />
          </PipingProvider>
        )}
        {mode === 'Field Notes' && (
          <CommunityRedditSlot>
            <section className="rounded-2xl border border-white/10 bg-[#111] p-4">
              <PoliceFeed />
            </section>
          </CommunityRedditSlot>
        )}
      </NorthStarFrame>
    </LensShell>
  );
}
