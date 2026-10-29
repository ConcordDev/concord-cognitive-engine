'use client';

/**
 * Code lens app — thin chrome around CodeEditorWorkspacePanel.
 * One extras view-SM (advanced / trending / actions) replaces accordion soup.
 */

import { useEffect, useState } from 'react';
import dynamic from 'next/dynamic';
import { lensRun } from '@/lib/api/client';
import { parseExecStatus, publishExecStatus } from '@/components/code/codeExecGate';
import { Blocks, Flame, Sparkles } from 'lucide-react';
import { LensShell } from '@/components/lens/LensShell';
import { DepthBadge } from '@/components/lens/DepthBadge';
import { ShellPreview } from '@/components/lens/ShellPreview';
import { SessionRail } from '@/components/lens/SessionRail';
import { CrossLensRecentsPanel } from '@/components/lens/CrossLensRecentsPanel';
import { CodeProjectProvider } from '@/components/code/CodeProjectContext';
import { ErrorBoundary } from '@/components/common/ErrorBoundary';
import { CodeEditorWorkspacePanel } from '@/components/code/CodeEditorWorkspacePanel';
import { PipingProvider } from '@/components/panel-polish';
import { useLensNav } from '@/hooks/useLensNav';
import { useLensCommand } from '@/hooks/useLensCommand';

import { cn } from '@/lib/utils';

// These three views are closed until the user opens them. Loading them
// with the editor pulls yjs and the review workbench into the code-lens
// chunk even though the default screen never mounts them.
const CodeAdvancedPanel = dynamic(() => import('@/components/code/CodeAdvancedPanel').then((m) => m.CodeAdvancedPanel));
const GithubTrending = dynamic(() => import('@/components/code/GithubTrending').then((m) => m.GithubTrending));
const CodeActionPanel = dynamic(() => import('@/components/code/CodeActionPanel').then((m) => m.CodeActionPanel));

type CodeExtras = 'none' | 'advanced' | 'trending' | 'actions';

const EXTRA_TABS: { id: Exclude<CodeExtras, 'none'>; label: string; keys: string; hint: string; icon: typeof Blocks }[] = [
  { id: 'advanced', label: 'Advanced IDE', keys: '⌘2', hint: 'Deep analysis, debugger and profiler panels', icon: Blocks },
  { id: 'trending', label: 'GitHub trending', keys: '⌘3', hint: 'What the community is building right now', icon: Flame },
  { id: 'actions', label: 'Review workbench', keys: '⌘4', hint: 'Complexity, dependency, coverage and change-risk analysis', icon: Sparkles },
];

export default function CodeApp() {
  useLensNav('code');
  const [extras, setExtras] = useState<CodeExtras>('none');
  // S9 (F9): the trending tab renders behind its own error boundary;
  // bumping this key remounts it so "Try again" recovers in place
  // without a page reload, and a failure there can never take the
  // editor or the other tabs down with it.
  const [trendingKey, setTrendingKey] = useState(0);

  // The editor's Run button is the only one. This publishes the server
  // gate (code.exec-status) so that button can say execution is disabled.
  useEffect(() => {
    let live = true;
    void lensRun('code', 'exec-status', {}).then((r) => {
      if (!live) return;
      publishExecStatus(parseExecStatus(r.data));
    });
    return () => { live = false; };
  }, []);

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

        <DepthBadge lensId="code" size="sm" className="ml-2" />
        <ShellPreview lensId="code" defaultOpen={true} />

        <div data-lens-theme="code" className="px-6 pb-6 pt-6">
          <h1 className="mb-5 mt-1 font-vault text-[2.25rem] leading-tight text-zinc-100 sm:text-5xl">Code</h1>

          <nav className="mb-5 inline-flex max-w-full items-center gap-1 overflow-x-auto rounded-full border border-white/10 bg-white/[0.03] p-1" aria-label="Code extras" role="tablist">
            <button
              type="button"
              role="tab"
              aria-selected={extras === 'none'}
              onClick={() => setExtras('none')}
              title="Editor only"
              className={cn(
                'inline-flex items-center gap-2 whitespace-nowrap rounded-full px-4 py-1.5 text-[14px] transition-colors',
                extras === 'none' ? 'bg-white/10 text-zinc-50' : 'text-zinc-500 hover:text-zinc-200',
              )}
            >
              Editor
            </button>
            {EXTRA_TABS.map((t) => {
              const Icon = t.icon;
              const on = extras === t.id;
              return (
                <button
                  key={t.id}
                  type="button"
                  role="tab"
                  aria-selected={on}
                  onClick={() => setExtras((e) => (e === t.id ? 'none' : t.id))}
                  title={`${t.hint} (${t.keys})`}
                  className={cn(
                    'inline-flex items-center gap-2 whitespace-nowrap rounded-full px-4 py-1.5 text-[14px] transition-colors',
                    on ? 'bg-white/10 text-zinc-50' : 'text-zinc-500 hover:text-zinc-200',
                  )}
                >
                  <Icon className="h-3.5 w-3.5" />
                  {t.label}
                  <kbd aria-hidden="true" className="hidden rounded border border-white/10 bg-white/5 px-1 py-0.5 font-mono text-[10px] text-white/30 sm:inline-block">{t.keys}</kbd>
                </button>
              );
            })}
          </nav>

          <div className="min-h-[70vh] overflow-hidden rounded-2xl border border-white/10 bg-[#0c0c0e]">
            <CodeEditorWorkspacePanel onOpenExtras={() => setExtras('advanced')} />
          </div>

          <div className="mt-5">
            {extras === 'advanced' && <CodeAdvancedPanel />}
            {extras === 'trending' && (
              <ErrorBoundary
                key={trendingKey}
                fallback={(
                  <div role="alert" className="rounded-2xl border border-amber-500/25 bg-amber-500/5 px-4 py-3 text-sm text-amber-200">
                    <p className="font-semibold text-white">Trending repositories couldn't load.</p>
                    <p className="mt-0.5 text-xs text-amber-200/80">Something went wrong in this tab only — your editor, project, and other tabs are untouched.</p>
                    <button type="button" onClick={() => setTrendingKey(k => k + 1)} className="mt-2 rounded bg-amber-500/20 px-2.5 py-1 text-xs font-semibold text-amber-100 hover:bg-amber-500/30">Try again</button>
                  </div>
                )}
              >
                <GithubTrending />
              </ErrorBoundary>
            )}
            {extras === 'actions' && (
              <PipingProvider>
                <CodeActionPanel />
              </PipingProvider>
            )}
          </div>
        </div>

        <SessionRail lensId="code" hideWhenEmpty className="mt-4 mx-4" />
        <CrossLensRecentsPanel lensId="code" sinceDays={7} limit={6} hideWhenEmpty className="mt-3 mx-4" />
      </CodeProjectProvider>
    </LensShell>
  );
}
