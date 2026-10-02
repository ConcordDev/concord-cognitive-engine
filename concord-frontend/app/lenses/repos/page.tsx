'use client';

/**
 * Repos — north star (docs/lens-northstar/34): the repo list.
 * GitHub explore stays under More. Counts come from repos.repo-list.
 */

import { useState } from 'react';
import { ArrowLeft } from 'lucide-react';
import { LensShell } from '@/components/lens/LensShell';
import { CrossLensRecentsPanel } from '@/components/lens/CrossLensRecentsPanel';
import { TrendingRepos } from '@/components/repos/TrendingRepos';
import { RepoBrowser } from '@/components/repos-explorer/RepoBrowser';
import { ConcordRepoWorkspace } from '@/components/repos/ConcordRepoWorkspace';
import { useLensNav } from '@/hooks/useLensNav';
import { useLensCommand } from '@/hooks/useLensCommand';
import { useAuth } from '@/hooks/useAuth';
import { titleCaseDisplayName } from '@/components/chat/claudeCleanGreeting';
import { CodeFamilyPill, NorthGreeting, QuietMore } from '@/components/code/CodeFamilyChrome';

type View = 'workspace' | 'explore';

export default function ReposLensPage() {
  useLensNav('repos');
  const { user } = useAuth();
  const who = titleCaseDisplayName(user?.username);
  const [view, setView] = useState<View>('workspace');

  useLensCommand(
    [
      { id: 'view-workspace', keys: 'w', description: 'Your repos', category: 'navigation', action: () => setView('workspace') },
      { id: 'view-explore', keys: 'e', description: 'Explore GitHub', category: 'navigation', action: () => setView('explore') },
    ],
    { lensId: 'repos' },
  );

  return (
    <LensShell lensId="repos" asMain={false} disableAgentFab>
      <div data-lens-theme="repos" className="min-h-[calc(100vh-4rem)] px-8 pb-28 pt-4">
        {view === 'workspace' ? (
          <>
            <div className="flex items-start justify-between gap-4">
              <div>
                <NorthGreeting kicker="Repos" title={who ? `Your repos, ${who}` : 'Your repos'} />
                <CodeFamilyPill active="repos" />
              </div>
              <QuietMore
                items={[{ id: 'explore', label: 'Explore GitHub', key: 'e' }]}
                onPick={() => setView('explore')}
              />
            </div>
            <div className="mt-6">
              <ConcordRepoWorkspace listOnly />
            </div>
          </>
        ) : (
          <div className="space-y-6">
            <button
              type="button"
              onClick={() => setView('workspace')}
              className="inline-flex items-center gap-1.5 text-[14px] text-zinc-500 transition-colors hover:text-zinc-200"
            >
              <ArrowLeft className="h-4 w-4" />
              Repos
            </button>
            <h1 className="font-vault text-[2.25rem] leading-tight text-zinc-100">Explore GitHub</h1>
            <RepoBrowser />
            <TrendingRepos />
          </div>
        )}
        <CrossLensRecentsPanel lensId="repos" sinceDays={7} limit={6} hideWhenEmpty className="mt-6" />
      </div>
    </LensShell>
  );
}
