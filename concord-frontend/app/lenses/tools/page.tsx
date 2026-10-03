'use client';

/**
 * Tools lens: north-star chrome over live web research, multi-language
 * compile/transpile, a multi-party e-signature workflow, and developer
 * tooling. Every tab is a real workflow over the `tools` domain macros
 * (tools.research, tools.compile, tools.esign-*).
 */

import { useCallback, useState } from 'react';
import { Globe, Hammer, FileSignature, GitBranch, Search } from 'lucide-react';
import { useLensNav } from '@/hooks/useLensNav';
import { useLensCommand } from '@/hooks/useLensCommand';
import { useAuth } from '@/hooks/useAuth';
import { titleCaseDisplayName } from '@/components/chat/claudeCleanGreeting';
import { LensShell } from '@/components/lens/LensShell';
import { FirstRunTour } from '@/components/lens/FirstRunTour';
import { DepthBadge } from '@/components/lens/DepthBadge';
import { NorthStarFrame } from '@/components/lens/NorthStarFrame';
import { ToolsRepos } from '@/components/tools/ToolsRepos';
import { WebResearchTool } from '@/components/tools/WebResearchTool';
import { CompileTool } from '@/components/tools/CompileTool';
import { ESignatureTool } from '@/components/tools/ESignatureTool';

type TabKey = 'web' | 'compile' | 'esign' | 'repos';

const TABS: { key: TabKey; label: string; keys: string; title: string; hint: string; icon: typeof Globe }[] = [
  { key: 'web', label: 'Web research', keys: 'w', title: 'Look it up', hint: 'Live web research', icon: Globe },
  { key: 'compile', label: 'Compile', keys: 'c', title: 'Build and transpile', hint: 'Compile / transpile across languages', icon: Hammer },
  { key: 'esign', label: 'E-signature', keys: 's', title: 'Get it signed', hint: 'Multi-party signing with audit trail', icon: FileSignature },
  { key: 'repos', label: 'Developer tooling', keys: 'd', title: 'Tooling worth knowing', hint: 'Developer tooling on GitHub', icon: GitBranch },
];

export default function ToolsLensPage() {
  useLensNav('tools');
  const { user } = useAuth();
  const who = titleCaseDisplayName(user?.username);
  const [activeTab, setActiveTab] = useState<TabKey>('web');

  const research = useCallback(() => {
    setActiveTab('web');
    requestAnimationFrame(() => {
      const el = document.querySelector<HTMLElement>('[data-lens-theme="tools"] input:not([type="file"]), [data-lens-theme="tools"] textarea');
      el?.focus();
    });
  }, []);

  useLensCommand(
    [
      ...TABS.map((t) => ({
        id: `goto-${t.key}`,
        keys: t.keys,
        description: t.label,
        category: 'navigation' as const,
        action: () => setActiveTab(t.key),
      })),
      { id: 'tools-research', keys: 'n', description: 'New research query', category: 'actions' as const, action: research },
    ],
    { lensId: 'tools' },
  );

  const current = TABS.find((t) => t.key === activeTab)!;

  return (
    <LensShell lensId="tools" asMain={false}>
      <FirstRunTour lensId="tools" />
      <DepthBadge lensId="tools" size="sm" className="ml-2" />
      <NorthStarFrame
        lensId="tools"
        crumb="Tools"
        title={`${current.title}${activeTab === 'web' && who ? `, ${who}` : ''}`}
        subtitle="Web research, compile / build, e-signature and developer tooling."
        tabs={TABS.map((t) => ({ id: t.key, label: t.label, keys: t.keys, hint: t.hint, icon: t.icon }))}
        activeTab={activeTab}
        onTab={(id) => setActiveTab(id as TabKey)}
        tabsLabel="Tools sections"
        cta={{ label: 'New research', icon: Search, onClick: research, title: 'New research query (N)' }}
      >
        {activeTab === 'web' && <WebResearchTool />}
        {activeTab === 'compile' && <CompileTool />}
        {activeTab === 'esign' && <ESignatureTool />}
        {activeTab === 'repos' && (
          <section className="rounded-2xl border border-white/10 bg-[#111] p-4">
            <ToolsRepos />
          </section>
        )}
      </NorthStarFrame>
    </LensShell>
  );
}
