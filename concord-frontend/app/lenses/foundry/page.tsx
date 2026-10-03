'use client';

/**
 * Foundry lens: north-star chrome over the no-code game builder. Compose
 * Concord's systems into a persistent, cross-world game. The front-door
 * create/list/open/delete loop is wired to foundry.* macros via
 * FoundryWorldsPanel; the configure/validate/save/publish loop lives in
 * FoundryCanvas; BuilderStudio covers scripting, playtest, assets,
 * multiplayer, marketplace and analytics. Distinct from /lenses/forge.
 */

import dynamic from 'next/dynamic';
import { useState } from 'react';
import { Boxes, Loader2, Hammer, GitBranch, Plus } from 'lucide-react';
import { useLensData } from '@/lib/hooks/use-lens-data';
import { useLensCommand } from '@/hooks/useLensCommand';
import { useAuth } from '@/hooks/useAuth';
import { titleCaseDisplayName } from '@/components/chat/claudeCleanGreeting';
import { FoundryWorldsPanel } from '@/components/foundry/FoundryWorldsPanel';
import { LensShell } from '@/components/lens/LensShell';
import { SessionRail } from '@/components/lens/SessionRail';
import { FirstRunTour } from '@/components/lens/FirstRunTour';
import { DepthBadge } from '@/components/lens/DepthBadge';
import { NorthStarFrame } from '@/components/lens/NorthStarFrame';
import { WorldBuilderRepos } from '@/components/foundry/WorldBuilderRepos';
import { BuilderStudio } from '@/components/foundry/BuilderStudio';

const FoundryCanvas = dynamic(() => import('@/components/foundry/FoundryCanvas'), {
  ssr: false,
  loading: () => (
    <div className="flex items-center justify-center gap-2 py-24 text-sm text-slate-400">
      <Loader2 className="h-4 w-4 animate-spin" /> Loading Foundry…
    </div>
  ),
});

type View = 'worlds' | 'studio' | 'tooling';

const VIEWS: { id: View; label: string; keys: string; title: string; hint: string; icon: typeof Boxes }[] = [
  { id: 'worlds', label: 'Worlds', keys: '1', title: 'Build a game', hint: 'Your worlds and the block canvas', icon: Boxes },
  { id: 'studio', label: 'Builder studio', keys: '2', title: 'Script, test and ship', hint: 'Visual scripting, playtest, assets, multiplayer, marketplace, analytics', icon: Hammer },
  { id: 'tooling', label: 'Tooling', keys: '3', title: 'World-building tooling', hint: 'Open-source world-building tools on GitHub', icon: GitBranch },
];

export default function FoundryLensPage() {
  const { total: worldArtifacts } = useLensData('foundry', 'foundry_world', { noSeed: true });
  const { user } = useAuth();
  const who = titleCaseDisplayName(user?.username);
  const [view, setView] = useState<View>('worlds');

  useLensCommand(
    [
      ...VIEWS.map((v) => ({
        id: `view-${v.id}`,
        keys: v.keys,
        description: `${v.label} — ${v.hint}`,
        category: 'navigation' as const,
        action: () => setView(v.id),
      })),
      { id: 'foundry-new-world', keys: 'n', description: 'Create a world', category: 'actions' as const, action: () => setView('worlds') },
    ],
    { lensId: 'foundry' },
  );

  const current = VIEWS.find((v) => v.id === view)!;

  return (
    <LensShell lensId="foundry" asMain={false}>
      <FirstRunTour lensId="foundry" />
      <DepthBadge lensId="foundry" size="sm" className="ml-2" />
      <NorthStarFrame
        lensId="foundry"
        crumb="Foundry"
        title={`${current.title}${view === 'worlds' && who ? `, ${who}` : ''}`}
        subtitle="Compose terrain, living NPCs, combat, economies and more into a persistent, cross-world game. No code, no infrastructure."
        actions={
          <span
            className="rounded-full border border-sky-500/30 bg-sky-500/10 px-2.5 py-1 text-[11px] font-medium text-sky-300"
            title={`${worldArtifacts} persisted foundry artifact(s)`}
          >
            Beta
          </span>
        }
        tabs={VIEWS.map((v) => ({ id: v.id, label: v.label, keys: v.keys, hint: v.hint, icon: v.icon }))}
        activeTab={view}
        onTab={(id) => setView(id as View)}
        cta={{ label: 'Create a world', icon: Plus, onClick: () => setView('worlds'), title: 'Create a world (N)' }}
      >
        {view === 'worlds' && (
          <div className="space-y-5">
            <section className="rounded-2xl border border-white/10 bg-[#111] p-4">
              <FoundryWorldsPanel />
            </section>
            <FoundryCanvas />
          </div>
        )}
        {view === 'studio' && <BuilderStudio />}
        {view === 'tooling' && (
          <section className="rounded-2xl border border-white/10 bg-[#111] p-4">
            <WorldBuilderRepos />
          </section>
        )}
        <SessionRail lensId="foundry" hideWhenEmpty className="mt-4" />
      </NorthStarFrame>
    </LensShell>
  );
}
