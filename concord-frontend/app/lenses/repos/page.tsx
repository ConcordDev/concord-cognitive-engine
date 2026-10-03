'use client';

import { useCallback, useState } from 'react';
import { Compass, GitBranch, Plus } from 'lucide-react';
import { LensShell } from '@/components/lens/LensShell';
import { CrossLensRecentsPanel } from '@/components/lens/CrossLensRecentsPanel';
import { FirstRunTour } from '@/components/lens/FirstRunTour';
import { DepthBadge } from '@/components/lens/DepthBadge';
import { TrendingRepos } from '@/components/repos/TrendingRepos';
import { useLensNav } from '@/hooks/useLensNav';
import { useLensCommand } from '@/hooks/useLensCommand';
import { useLensIdentity } from '@/hooks/useLensIdentity';
import { useRealtimeLens } from '@/hooks/useRealtimeLens';
import { useAuth } from '@/hooks/useAuth';
import { titleCaseDisplayName } from '@/components/chat/claudeCleanGreeting';
import { LiveIndicator } from '@/components/lens/LiveIndicator';
import { DTUExportButton } from '@/components/lens/DTUExportButton';
import { RealtimeDataPanel } from '@/components/lens/RealtimeDataPanel';
import { RepoBrowser } from '@/components/repos-explorer/RepoBrowser';
import { ConcordRepoWorkspace } from '@/components/repos/ConcordRepoWorkspace';
import { cn } from '@/lib/utils';

type View = 'workspace' | 'explore';

const VIEWS: { id: View; label: string; keys: string; hint: string; icon: typeof GitBranch }[] = [
  { id: 'workspace', label: 'Your repos', keys: 'w', hint: 'Repositories, files, branches, issues and pull requests', icon: GitBranch },
  { id: 'explore', label: 'Explore GitHub', keys: 'e', hint: 'Browse and search public repositories', icon: Compass },
];

export default function ReposLensPage() {
  useLensNav('repos');
  useLensIdentity('repos');
  const { latestData: realtimeData, alerts: realtimeAlerts, insights: realtimeInsights, isLive, lastUpdated } = useRealtimeLens('repos');
  const { user } = useAuth();
  const who = titleCaseDisplayName(user?.username);
  const [view, setView] = useState<View>('workspace');

  const newRepo = useCallback(() => {
    setView('workspace');
    requestAnimationFrame(() => document.getElementById('repo-new-name')?.focus());
  }, []);

  useLensCommand(
    [
      ...VIEWS.map((v) => ({
        id: `view-${v.id}`,
        keys: v.keys,
        description: v.hint,
        category: 'navigation' as const,
        action: () => setView(v.id),
      })),
      { id: 'repos-new', keys: 'n', description: 'New repository', category: 'actions' as const, action: newRepo },
    ],
    { lensId: 'repos' },
  );

  return (
    <LensShell lensId="repos" asMain={false}>
      <FirstRunTour lensId="repos" />
      <DepthBadge lensId="repos" size="sm" className="ml-2" />
      <div data-lens-theme="repos" className="relative min-h-full px-8 pb-28 pt-6">
        <div className="flex items-start justify-between gap-4">
          <div className="min-w-0">
            <p className="text-[14px] text-zinc-500">Repos</p>
            <h1 className="mb-5 mt-1 font-vault text-[2.25rem] leading-tight text-zinc-100 sm:text-5xl">
              {view === 'workspace' ? `What are we shipping${who ? `, ${who}` : ''}` : 'What is the world building'}
            </h1>
          </div>
          <div className="flex shrink-0 flex-wrap items-center justify-end gap-3 pt-2">
            <LiveIndicator isLive={isLive} lastUpdated={lastUpdated} compact />
            <DTUExportButton domain="repos" data={realtimeData || {}} compact />
            {realtimeAlerts.length > 0 && (
              <span className="rounded bg-yellow-500/10 px-2 py-0.5 text-xs text-yellow-400">
                {realtimeAlerts.length} alert{realtimeAlerts.length !== 1 ? 's' : ''}
              </span>
            )}
          </div>
        </div>

        <nav className="mb-6 inline-flex max-w-full items-center gap-1 overflow-x-auto rounded-full border border-white/10 bg-white/[0.03] p-1" aria-label="Repos views">
          {VIEWS.map((v) => {
            const Icon = v.icon;
            const on = view === v.id;
            return (
              <button
                key={v.id}
                type="button"
                onClick={() => setView(v.id)}
                aria-current={on ? 'page' : undefined}
                title={`${v.hint} (${v.keys})`}
                className={cn(
                  'inline-flex items-center gap-2 whitespace-nowrap rounded-full px-4 py-1.5 text-[14px] transition-colors',
                  on ? 'bg-white/10 text-zinc-50' : 'text-zinc-500 hover:text-zinc-200',
                )}
              >
                <Icon className="h-3.5 w-3.5" />
                {v.label}
                <kbd className="hidden rounded border border-white/10 bg-white/5 px-1 py-0.5 font-mono text-[10px] text-white/30 sm:inline-block">{v.keys}</kbd>
              </button>
            );
          })}
        </nav>

        {view === 'workspace' && (
          <section className="rounded-2xl border border-white/10 bg-[#111] p-4">
            <ConcordRepoWorkspace />
          </section>
        )}

        {view === 'explore' && (
          <div className="space-y-5">
            <section className="rounded-2xl border border-white/10 bg-[#111] p-4">
              <RepoBrowser />
            </section>
            <section className="rounded-2xl border border-white/10 bg-[#111] p-4">
              <TrendingRepos />
            </section>
          </div>
        )}

        {realtimeData && (
          <div className="mt-5">
            <RealtimeDataPanel
              domain="repos"
              data={realtimeData}
              isLive={isLive}
              lastUpdated={lastUpdated}
              insights={realtimeInsights}
              compact
            />
          </div>
        )}

        <CrossLensRecentsPanel lensId="repos" sinceDays={7} limit={6} hideWhenEmpty className="mt-8" />

        <button
          type="button"
          onClick={newRepo}
          title="New repository (N)"
          className="fixed bottom-8 right-8 z-30 inline-flex items-center gap-2 rounded-full bg-teal-400 px-6 py-3.5 text-[15px] font-medium text-black shadow-[0_8px_32px_rgba(45,212,191,0.25)] transition-colors hover:bg-teal-300"
        >
          <Plus className="h-4 w-4" />
          New repo
        </button>
      </div>
    </LensShell>
  );
}
