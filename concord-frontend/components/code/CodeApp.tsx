'use client';

/**
 * Code lens app — thin chrome around CodeEditorWorkspacePanel.
 * One extras view-SM (advanced / trending / actions) replaces accordion soup.
 */

import { useEffect, useState } from 'react';
import { lensRun } from '@/lib/api/client';
import { parseExecStatus, publishExecStatus, readExecStatus } from '@/components/code/codeExecGate';
import { Blocks, Flame, Loader2, Play, Sparkles } from 'lucide-react';
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
import { useAuth } from '@/hooks/useAuth';
import { titleCaseDisplayName } from '@/components/chat/claudeCleanGreeting';
import { cn } from '@/lib/utils';

type CodeExtras = 'none' | 'advanced' | 'trending' | 'actions';

const EXTRA_TABS: { id: Exclude<CodeExtras, 'none'>; label: string; keys: string; hint: string; icon: typeof Blocks }[] = [
  { id: 'advanced', label: 'Advanced IDE', keys: '⌘2', hint: 'Deep analysis, debugger and profiler panels', icon: Blocks },
  { id: 'trending', label: 'GitHub trending', keys: '⌘3', hint: 'What the community is building right now', icon: Flame },
  { id: 'actions', label: 'Review workbench', keys: '⌘4', hint: 'Complexity, dependency, coverage and change-risk analysis', icon: Sparkles },
];

export default function CodeApp() {
  useLensNav('code');
  const { user } = useAuth();
  const who = titleCaseDisplayName(user?.username);
  const [extras, setExtras] = useState<CodeExtras>('none');
  const [running, setRunning] = useState(false);
  const [exec, setExec] = useState(() => readExecStatus());

  useEffect(() => {
    const onState = (e: Event) => setRunning(Boolean((e as CustomEvent<{ running?: boolean }>).detail?.running));
    window.addEventListener('concord:code-run-state', onState);
    return () => window.removeEventListener('concord:code-run-state', onState);
  }, []);

  useEffect(() => {
    let live = true;
    void lensRun('code', 'exec-status', {}).then((r) => {
      if (!live) return;
      const status = parseExecStatus(r.data);
      publishExecStatus(status);
      setExec(status);
    });
    return () => { live = false; };
  }, []);

  const execOff = exec?.enabled === false;
  const runTitle = execOff
    ? exec?.reason || 'Live code execution is disabled in this environment.'
    : 'Run the active file (⌘ Enter)';

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

        <div data-lens-theme="code" className="px-6 pb-6 pt-6">
          <p className="text-[14px] text-zinc-500">Code</p>
          <h1 className="mb-5 mt-1 font-vault text-[2.25rem] leading-tight text-zinc-100 sm:text-5xl">
            What are we building{who ? `, ${who}` : ''}
          </h1>

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

          <button
            type="button"
            onClick={() => { if (!execOff) window.dispatchEvent(new CustomEvent('concord:code-run')); }}
            disabled={running || execOff || exec === null}
            title={runTitle}
            className="fixed bottom-8 right-8 z-30 inline-flex items-center gap-2 rounded-full bg-teal-400 px-6 py-3.5 text-[15px] font-medium text-black shadow-[0_8px_32px_rgba(45,212,191,0.25)] transition-colors hover:bg-teal-300 disabled:opacity-60"
          >
            {running ? <Loader2 className="h-4 w-4 animate-spin" /> : <Play className="h-4 w-4" />}
            {running ? 'Running…' : execOff ? 'Run off' : 'Run'}
          </button>

          <div className="mt-5">
            {extras === 'advanced' && <CodeAdvancedPanel />}
            {extras === 'trending' && <GithubTrending />}
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
