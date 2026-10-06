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
import { FirstRunTour } from '@/components/lens/FirstRunTour';
import { DepthBadge } from '@/components/lens/DepthBadge';
import { NorthStarFrame } from '@/components/lens/NorthStarFrame';
import { PoliceFeed } from '@/components/law-enforcement/PoliceFeed';
import { LawEnforcementActionPanel } from '@/components/law-enforcement/LawEnforcementActionPanel';
import { RmsCadConsole } from '@/components/law-enforcement/RmsCadConsole';
import { LawEnforcementOverviewPanel } from '@/components/law-enforcement/LawEnforcementOverviewPanel';
import { CaseManagementPanel } from '@/components/law-enforcement/CaseManagementPanel';
import { PipingProvider } from '@/components/panel-polish';
import { useLensCommand } from '@/hooks/useLensCommand';
import { useAuth } from '@/hooks/useAuth';
import { titleCaseDisplayName } from '@/components/chat/claudeCleanGreeting';

type ModeTab = 'Overview' | 'Cases' | 'Console' | 'Analysis' | 'Field Notes';

const MODE_TABS: { id: ModeTab; icon: typeof LayoutDashboard; label: string; title: string; hint: string }[] = [
  { id: 'Overview', icon: LayoutDashboard, label: 'Overview', title: 'The shift at a glance', hint: 'Calls, units, roster, evidence, warrants, reports, bookings' },
  { id: 'Cases', icon: FolderOpen, label: 'Cases', title: 'Open cases', hint: 'Case lifecycle with linked reports, evidence, bookings and warrants' },
  { id: 'Console', icon: Radio, label: 'RMS / CAD Console', title: 'Dispatch and records', hint: 'Dispatch, chain-of-custody, roster, crime map, warrants, reports, booking' },
  { id: 'Analysis', icon: Sparkles, label: 'Quick Analysis', title: 'Run the numbers', hint: 'Case strength, patrol allocation, crime stats, incident report' },
  { id: 'Field Notes', icon: Newspaper, label: 'Field Notes', title: 'What the street is saying', hint: 'Live law-enforcement community pulse' },
];

export default function LawEnforcementLensPage() {
  const { user } = useAuth();
  const who = titleCaseDisplayName(user?.username);
  const [mode, setMode] = useState<ModeTab>('Overview');

  useLensCommand(
    [
      ...MODE_TABS.map((tab, i) => ({
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

  const current = MODE_TABS.find((t) => t.id === mode)!;

  return (
    <LensShell lensId="law-enforcement" asMain={false}>
      <FirstRunTour lensId="law-enforcement" />
      <DepthBadge lensId="law-enforcement" size="sm" className="ml-2" />
      <NorthStarFrame
        lensId="law-enforcement"
        crumb="Law Enforcement"
        title={`${current.title}${mode === 'Overview' && who ? `, ${who}` : ''}`}
        subtitle="Dispatch, evidence chain-of-custody, roster, crime mapping, warrants and reports."
        tabs={MODE_TABS.map((t, i) => ({ id: t.id, label: t.label, keys: String(i + 1), hint: t.hint, icon: t.icon }))}
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
          <section className="rounded-2xl border border-white/10 bg-[#111] p-4">
            <PoliceFeed />
          </section>
        )}
      </NorthStarFrame>
    </LensShell>
  );
}
