'use client';

/**
 * Code lens — north star (docs/lens-northstar/28): one buffer and Run.
 * Advanced IDE, GitHub trending, and the review workbench stay under More.
 */

import { useState } from 'react';
import { ArrowLeft } from 'lucide-react';
import { LensShell } from '@/components/lens/LensShell';
import { CrossLensRecentsPanel } from '@/components/lens/CrossLensRecentsPanel';
import { CodeProjectProvider } from '@/components/code/CodeProjectContext';
import { CodeEditorWorkspacePanel } from '@/components/code/CodeEditorWorkspacePanel';
import { CodeAdvancedPanel } from '@/components/code/CodeAdvancedPanel';
import { GithubTrending } from '@/components/code/GithubTrending';
import { CodeActionPanel } from '@/components/code/CodeActionPanel';
import { PipingProvider } from '@/components/panel-polish';
import { CodeFamilyPill, NorthGreeting, QuietMore } from '@/components/code/CodeFamilyChrome';
import { useLensNav } from '@/hooks/useLensNav';
import { useLensCommand } from '@/hooks/useLensCommand';
import { useAuth } from '@/hooks/useAuth';
import { titleCaseDisplayName } from '@/components/chat/claudeCleanGreeting';

type CodeExtras = 'none' | 'advanced' | 'trending' | 'actions';

const MORE = [
  { id: 'advanced', label: 'Advanced IDE', key: '2' },
  { id: 'trending', label: 'GitHub trending', key: '3' },
  { id: 'actions', label: 'Review workbench', key: '4' },
];

export default function CodeApp() {
  useLensNav('code');
  const { user } = useAuth();
  const who = titleCaseDisplayName(user?.username);
  const [extras, setExtras] = useState<CodeExtras>('none');

  useLensCommand(
    [
      { id: 'extras-advanced', keys: 'mod+2', description: 'Advanced IDE', category: 'navigation', action: () => setExtras((e) => (e === 'advanced' ? 'none' : 'advanced')) },
      { id: 'extras-trending', keys: 'mod+3', description: 'GitHub trending', category: 'navigation', action: () => setExtras((e) => (e === 'trending' ? 'none' : 'trending')) },
      { id: 'extras-actions', keys: 'mod+4', description: 'Code review workbench', category: 'navigation', action: () => setExtras((e) => (e === 'actions' ? 'none' : 'actions')) },
    ],
    { lensId: 'code' },
  );

  const extra = MORE.find((m) => m.id === extras);

  return (
    <LensShell lensId="code" asMain={false} disableAgentFab>
      <CodeProjectProvider>
        <div data-lens-theme="code" className="flex min-h-[calc(100vh-4rem)] flex-col px-8 pb-28 pt-4">
          {extras === 'none' ? (
            <>
              <div className="flex items-start justify-between gap-4">
                <div>
                  <NorthGreeting
                    kicker="Code"
                    title={who ? `What are we building, ${who}` : 'What are we building'}
                  />
                  <CodeFamilyPill active="code" />
                </div>
                <QuietMore items={MORE} onPick={(id) => setExtras(id as CodeExtras)} />
              </div>
              <div className="mt-6 min-h-[62vh] flex-1 overflow-hidden rounded-2xl border border-white/10">
                <CodeEditorWorkspacePanel chrome="buffer" onOpenExtras={() => setExtras('advanced')} />
              </div>
            </>
          ) : (
            <div>
              <button
                type="button"
                onClick={() => setExtras('none')}
                className="inline-flex items-center gap-1.5 text-[14px] text-zinc-500 transition-colors hover:text-zinc-200"
              >
                <ArrowLeft className="h-4 w-4" />
                Code
              </button>
              <h1 className="mb-4 mt-2 font-vault text-[2.25rem] leading-tight text-zinc-100">{extra?.label}</h1>
              {extras === 'advanced' && <CodeAdvancedPanel />}
              {extras === 'trending' && <GithubTrending />}
              {extras === 'actions' && (
                <PipingProvider>
                  <CodeActionPanel />
                </PipingProvider>
              )}
            </div>
          )}
          <CrossLensRecentsPanel lensId="code" sinceDays={7} limit={6} hideWhenEmpty className="mt-3" />
        </div>
      </CodeProjectProvider>
    </LensShell>
  );
}
