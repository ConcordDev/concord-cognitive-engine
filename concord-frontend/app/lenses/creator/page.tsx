'use client';

// Creator lens — one YouTube-Studio / Patreon-shaped app.
// Left rail is the only view-state machine. Every former inline tab and
// the hidden "Creator Studio" accordion now live as panels under
// components/creator/. Data is react-query via CreatorProvider.

import { useState } from 'react';
import { RefreshCw } from 'lucide-react';
import { LensShell } from '@/components/lens/LensShell';
import { FirstRunTour } from '@/components/lens/FirstRunTour';
import { DepthBadge } from '@/components/lens/DepthBadge';
import { CrossLensRecentsPanel } from '@/components/lens/CrossLensRecentsPanel';
import LensAgentFab from '@/components/lens/LensAgentFab';
import { useLensCommand } from '@/hooks/useLensCommand';
import { useLensIdentity } from '@/hooks/useLensIdentity';
import KnowledgeEntrepreneurBadge from '@/components/creator/KnowledgeEntrepreneurBadge';
import { CreatorNav, CREATOR_COMMANDS, CREATOR_VIEW_LABELS } from '@/components/creator/CreatorNav';
import { CreatorProvider, useCreator } from '@/components/creator/CreatorProvider';
import { CreatorWorkPane } from '@/components/creator/CreatorWorkPane';
import type { CreatorView } from '@/components/creator/types';
import { useAuth } from '@/hooks/useAuth';
import { titleCaseDisplayName } from '@/components/chat/claudeCleanGreeting';

function CreatorChrome() {
  const { view, setView, me, refreshAll } = useCreator();
  useLensIdentity('creator');
  const { user } = useAuth();
  const who = titleCaseDisplayName(user?.username);
  const activeLabel = CREATOR_VIEW_LABELS[view] ?? 'Creator Studio';
  useLensCommand(
    CREATOR_COMMANDS.map((c) => ({
      id: c.id,
      keys: c.keys,
      description: c.description,
      category: 'navigation' as const,
      action: () => setView(c.view),
    })),
    { lensId: 'creator' },
  );

  return (
    <>
      <FirstRunTour lensId="creator" />
      <div data-lens-theme="creator" className="relative min-h-full px-8 pb-28 pt-6">
        <header className="mb-5 flex items-start justify-between gap-4">
          <div className="min-w-0">
            <p className="text-[14px] text-zinc-500">Creator Studio · {activeLabel}</p>
            <h1 className="mt-1 font-vault text-[2.25rem] leading-tight text-zinc-100 sm:text-5xl">
              {view === 'home' ? `Your studio today${who ? `, ${who}` : ''}` : activeLabel}
            </h1>
            <p className="mt-2 text-[13px] text-zinc-500">Pipeline, listings, audience, and the royalty cascade, in one desk.</p>
            {me?.userId && <KnowledgeEntrepreneurBadge userId={me.userId} />}
          </div>
          <div className="flex shrink-0 items-center gap-3 pt-2">
            <DepthBadge lensId="creator" size="sm" />
          </div>
        </header>
        <div className="flex flex-col gap-5 lg:flex-row">
          <CreatorNav view={view} onSelect={setView} />
          <CreatorWorkPane />
        </div>
        <CrossLensRecentsPanel lensId="creator" sinceDays={7} limit={6} hideWhenEmpty className="mt-8" />
        <button
          type="button"
          onClick={refreshAll}
          title="Refresh every creator feed"
          className="fixed bottom-8 right-8 z-30 inline-flex items-center gap-2 rounded-full bg-teal-400 px-6 py-3.5 text-[15px] font-medium text-black shadow-[0_8px_32px_rgba(45,212,191,0.25)] transition-colors hover:bg-teal-300"
        >
          <RefreshCw className="h-4 w-4" />
          Refresh
        </button>
      </div>
      <LensAgentFab
        lensId="creator"
        lensPrompt="You're inside Concord's Creator Studio — royalty cascade, listings, pipeline, audience. Prefer expert_mode for growth research, run_lens_action for listing/profile updates, create_dtu to save analysis."
      />
    </>
  );
}

export default function CreatorDashboardPage() {
  const [view, setView] = useState<CreatorView>('home');
  return (
    <LensShell lensId="creator" asMain={false} disableAgentFab={true}>
      <CreatorProvider view={view} setView={setView}>
        <CreatorChrome />
      </CreatorProvider>
    </LensShell>
  );
}
