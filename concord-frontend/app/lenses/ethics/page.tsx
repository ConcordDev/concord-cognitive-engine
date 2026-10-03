'use client';

/**
 * Ethics lens: north-star chrome over the nine-tool Decision Toolkit (real
 * `ethics`-domain macros) plus the live Philosophy Q&A feed, both kept on
 * screen. See docs/lens-specs/ethics-capability-map.md for the Wave 3 rebuild.
 */

import { useCallback, useState } from 'react';
import { Scale } from 'lucide-react';
import { LensShell } from '@/components/lens/LensShell';
import { SessionRail } from '@/components/lens/SessionRail';
import { FirstRunTour } from '@/components/lens/FirstRunTour';
import { DepthBadge } from '@/components/lens/DepthBadge';
import { NorthStarFrame } from '@/components/lens/NorthStarFrame';
import { PhilosophyStack } from '@/components/ethics/PhilosophyStack';
import { DecisionToolkit, TOOL_TABS, type ToolTab } from '@/components/ethics/DecisionToolkit';
import { useLensCommand } from '@/hooks/useLensCommand';
import { useAuth } from '@/hooks/useAuth';
import { titleCaseDisplayName } from '@/components/chat/claudeCleanGreeting';

export default function EthicsLensPage() {
  const { user } = useAuth();
  const who = titleCaseDisplayName(user?.username);
  const [activeTab, setActiveTab] = useState<ToolTab>('multiframework');

  const analyze = useCallback(() => {
    setActiveTab('multiframework');
    requestAnimationFrame(() => {
      const el = document.querySelector<HTMLElement>('[data-lens-theme="ethics"] textarea, [data-lens-theme="ethics"] input[type="text"]');
      el?.scrollIntoView({ behavior: 'smooth', block: 'center' });
      el?.focus();
    });
  }, []);

  useLensCommand(
    [
      ...TOOL_TABS.map((t) => ({
        id: `tab-${t.id}`,
        keys: t.key,
        description: `Switch to ${t.label}`,
        category: 'navigation' as const,
        action: () => setActiveTab(t.id),
      })),
      { id: 'new-analysis', keys: 'n', description: 'Analyze a new decision', category: 'actions' as const, action: analyze },
    ],
    { lensId: 'ethics' },
  );

  return (
    <LensShell lensId="ethics" asMain={false}>
      <FirstRunTour lensId="ethics" />
      <DepthBadge lensId="ethics" size="sm" className="ml-2" />
      <NorthStarFrame
        lensId="ethics"
        crumb="Ethics"
        title={`What is the right call${who ? `, ${who}` : ''}?`}
        subtitle="Multi-framework decision analysis, stakeholder equity, bias auditing, and a peer-reviewed case library."
        cta={{ label: 'Analyze a decision', icon: Scale, onClick: analyze, title: 'Analyze a decision (N)' }}
      >
        <DecisionToolkit activeTab={activeTab} onTabChange={setActiveTab} />

        <section className="mt-8 rounded-2xl border border-white/10 bg-[#111] p-4">
          <h2 className="mb-3 text-sm font-semibold text-zinc-100">Philosophy Q&amp;A (Stack Exchange)</h2>
          <PhilosophyStack />
        </section>
      </NorthStarFrame>

      <SessionRail lensId="ethics" hideWhenEmpty className="mt-4" />
    </LensShell>
  );
}
