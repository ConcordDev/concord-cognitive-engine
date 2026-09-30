'use client';

/**
 * Ethics lens — Decision Toolkit (nine real `ethics`-domain macros) plus a
 * live philosophy Q&A feed.
 *
 * Wave 3 rebuild note: this page previously carried a second, parallel
 * surface — six generic CRUD tabs (Frameworks / Dilemmas / Cases /
 * Principles / Reviews / Policies) built on `useLensData('ethics',
 * <type>, { seed: [] })` against a client-invented `EthicsArtifact` type
 * with ~20 fabricated fields (weight, jurisdiction, precedent, policyArea,
 * effectiveDate, …) that no `ethics` domain macro ever reads or produces.
 * Two of those tabs ("Cases" and "Reviews") duplicated — with a different,
 * fake, un-backed shape — the real macro-backed Case Library and Ethics
 * Review tools already in <DecisionToolkit>. Every item's "Activate" (Zap)
 * button called a nonexistent `ethics.analyze` lens-action, which silently
 * fell through to the generic AI-utility-brain catch-all
 * (`server.js:38281`) — an unlabelled LLM call dressed as a domain feature.
 * That whole surface has been removed; see docs/lens-specs/ethics-capability-map.md.
 */

import { useState } from 'react';
import { LensShell } from '@/components/lens/LensShell';
import { SessionRail } from '@/components/lens/SessionRail';
import { CrossLensRecentsPanel } from '@/components/lens/CrossLensRecentsPanel';
import { FirstRunTour } from '@/components/lens/FirstRunTour';
import { DepthBadge } from '@/components/lens/DepthBadge';
import { PhilosophyStack } from '@/components/ethics/PhilosophyStack';
import { DecisionToolkit, TOOL_TABS, type ToolTab } from '@/components/ethics/DecisionToolkit';
import { useLensCommand } from '@/hooks/useLensCommand';
import { Scale, ChevronDown, ChevronRight } from 'lucide-react';
import { LensPageShell } from '@/components/lens/LensPageShell';

export default function EthicsLensPage() {
  const [activeTab, setActiveTab] = useState<ToolTab>('multiframework');
  const [showPhilStack, setShowPhilStack] = useState(false);

  // One discoverable single-key shortcut per toolkit tab (shown in the kbd
  // chip on each tab button and in the command palette / help modal via
  // useLensCommand's own registration).
  useLensCommand(
    TOOL_TABS.map((t) => ({
      id: `tab-${t.id}`,
      keys: t.key,
      description: `Switch to ${t.label}`,
      category: 'navigation' as const,
      action: () => setActiveTab(t.id),
    })),
    { lensId: 'ethics' }
  );

  return (
    <LensShell lensId="ethics" asMain={false}>
      <FirstRunTour lensId="ethics" />      <DepthBadge lensId="ethics" size="sm" className="ml-2" />
      <LensPageShell
        domain="ethics"
        title="Ethics"
        description="Multi-framework decision analysis, stakeholder equity, bias auditing, and a peer-reviewed case library"
        headerIcon={<Scale className="w-6 h-6" />}
        headerIconColor="text-indigo-500"
      >

        <DecisionToolkit activeTab={activeTab} onTabChange={setActiveTab} />

        <section className="mt-6 rounded-xl border border-zinc-800 bg-zinc-950/40 p-4">
          <button
            type="button"
            onClick={() => setShowPhilStack(v => !v)}
            className="flex w-full items-center justify-between text-left text-sm font-semibold text-white"
          >
            <span>Philosophy Q&amp;A (Stack Exchange)</span>
            {showPhilStack ? <ChevronDown className="h-4 w-4" /> : <ChevronRight className="h-4 w-4" />}
          </button>
          {showPhilStack && (
            <div className="mt-3">
              <PhilosophyStack />
            </div>
          )}
        </section>
      </LensPageShell>

      <SessionRail lensId="ethics" hideWhenEmpty className="mt-4" />      <CrossLensRecentsPanel lensId="ethics" sinceDays={7} limit={6} hideWhenEmpty className="mt-3" />
    </LensShell>
  );
}
