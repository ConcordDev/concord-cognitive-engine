'use client';

/**
 * Code lens app — thin chrome around CodeEditorWorkspacePanel.
 * One extras view-SM (advanced / trending / actions) replaces accordion soup.
 */

import { useState } from 'react';
import { LensShell } from '@/components/lens/LensShell';
import { FirstRunTour } from '@/components/lens/FirstRunTour';
import { DepthBadge } from '@/components/lens/DepthBadge';
import { ShellPreview } from '@/components/lens/ShellPreview';
import { SessionRail } from '@/components/lens/SessionRail';
import { CrossLensRecentsPanel } from '@/components/lens/CrossLensRecentsPanel';
import { CodeProjectProvider } from '@/components/code/CodeProjectContext';
import { CodeEditorWorkspacePanel } from '@/components/code/CodeEditorWorkspacePanel';
import { CodeAdvancedPanel } from '@/components/code/CodeAdvancedPanel';
import { GithubTrending } from '@/components/code/GithubTrending';
import { CodeActionPanel } from '@/components/code/CodeActionPanel';
import { PipingProvider } from '@/components/panel-polish';
import { useLensNav } from '@/hooks/useLensNav';
import { useLensCommand } from '@/hooks/useLensCommand';
import { cn } from '@/lib/utils';

type CodeExtras = 'none' | 'advanced' | 'trending' | 'actions';

const EXTRA_TABS: { id: Exclude<CodeExtras, 'none'>; label: string }[] = [
  { id: 'advanced', label: 'Advanced IDE' },
  { id: 'trending', label: 'GitHub trending' },
  { id: 'actions', label: 'Review workbench' },
];

export default function CodeApp() {
  useLensNav('code');
  const [extras, setExtras] = useState<CodeExtras>('none');

  useLensCommand(
    [
      {
        id: 'extras-advanced',
        keys: 'mod+2',
        description: 'Advanced IDE',
        category: 'navigation',
        action: () => setExtras((e) => (e === 'advanced' ? 'none' : 'advanced')),
      },
      {
        id: 'extras-trending',
        keys: 'mod+3',
        description: 'GitHub trending',
        category: 'navigation',
        action: () => setExtras((e) => (e === 'trending' ? 'none' : 'trending')),
      },
      {
        id: 'extras-actions',
        keys: 'mod+4',
        description: 'Code review workbench',
        category: 'navigation',
        action: () => setExtras((e) => (e === 'actions' ? 'none' : 'actions')),
      },
    ],
    { lensId: 'code' },
  );

  return (
    <LensShell lensId="code" asMain={false} disableAgentFab={true}>
      <CodeProjectProvider>
        <FirstRunTour lensId="code" />
        <DepthBadge lensId="code" size="sm" className="ml-2" />
        <ShellPreview lensId="code" defaultOpen={true} />

        <div className="flex-1 min-h-[70vh]">
          <CodeEditorWorkspacePanel onOpenExtras={() => setExtras('advanced')} />
        </div>

        <nav className="flex gap-1 px-4 mt-4 overflow-x-auto" aria-label="Code extras" role="tablist">
          {EXTRA_TABS.map((t) => (
            <button
              key={t.id}
              type="button"
              role="tab"
              aria-selected={extras === t.id}
              onClick={() => setExtras((e) => (e === t.id ? 'none' : t.id))}
              className={cn(
                'px-3 py-1.5 rounded-md text-xs font-mono whitespace-nowrap border transition-colors',
                extras === t.id
                  ? 'bg-green-500/15 text-green-300 border-green-500/30'
                  : 'text-gray-400 border-transparent hover:text-white hover:bg-white/5',
              )}
            >
              {t.label}
            </button>
          ))}
        </nav>

        <div className="px-4 mt-3 mb-6">
          {extras === 'advanced' && <CodeAdvancedPanel />}
          {extras === 'trending' && <GithubTrending />}
          {extras === 'actions' && (
            <PipingProvider>
              <CodeActionPanel />
            </PipingProvider>
          )}
        </div>

        <SessionRail lensId="code" hideWhenEmpty className="mt-4 mx-4" />
        <CrossLensRecentsPanel lensId="code" sinceDays={7} limit={6} hideWhenEmpty className="mt-3 mx-4" />
      </CodeProjectProvider>
    </LensShell>
  );
}
