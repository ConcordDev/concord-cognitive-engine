'use client';

import { useState } from 'react';
import { LensShell } from '@/components/lens/LensShell';
import { CrossLensRecentsPanel } from '@/components/lens/CrossLensRecentsPanel';
import { FirstRunTour } from '@/components/lens/FirstRunTour';
import { DepthBadge } from '@/components/lens/DepthBadge';
import { TrendingRepos } from '@/components/repos/TrendingRepos';
import { useLensNav } from '@/hooks/useLensNav';
import { useLensCommand } from '@/hooks/useLensCommand';
import { GitBranch, Code2 as Github } from 'lucide-react';
import { useRealtimeLens } from '@/hooks/useRealtimeLens';
import { LiveIndicator } from '@/components/lens/LiveIndicator';
import { DTUExportButton } from '@/components/lens/DTUExportButton';
import { RealtimeDataPanel } from '@/components/lens/RealtimeDataPanel';
import { RepoBrowser } from '@/components/repos-explorer/RepoBrowser';
import { ConcordRepoWorkspace } from '@/components/repos/ConcordRepoWorkspace';

type View = 'workspace' | 'explore';

export default function ReposLensPage() {
  useLensNav('repos');
  const { latestData: realtimeData, alerts: realtimeAlerts, insights: realtimeInsights, isLive, lastUpdated } = useRealtimeLens('repos');
  const [view, setView] = useState<View>('workspace');

  // Lens-scoped keyboard commands — discoverable via the visible kbd chips
  // on each tab below and the ⌘K palette (useLensCommand registration).
  useLensCommand(
    [
      { id: 'view-workspace', keys: 'w', description: 'Your repos', category: 'navigation', action: () => setView('workspace') },
      { id: 'view-explore', keys: 'e', description: 'Explore GitHub', category: 'navigation', action: () => setView('explore') },
    ],
    { lensId: 'repos' },
  );

  return (
    <LensShell lensId="repos" asMain={false}>
      <FirstRunTour lensId="repos" />      <DepthBadge lensId="repos" size="sm" className="ml-2" />
      <div data-lens-theme="repos" className="min-h-full bg-[#0d1117]">
        {/* Header */}
        <header className="bg-[#161b22] border-b border-gray-700">
          <div className="max-w-7xl mx-auto px-4">
            <div className="flex items-center justify-between py-4">
              <div className="flex items-center gap-3">
                <span className="text-3xl">📦</span>
                <div>
                  <h1 className="text-lg font-bold text-white leading-tight">Repos</h1>
                  <p className="text-[11px] text-gray-500">A GitHub-shape workspace over the Concord repo substrate</p>
                </div>
              </div>
              <nav className="flex items-center gap-1 rounded-md border border-gray-700 bg-[#0d1117] p-1">
                <button
                  onClick={() => setView('workspace')}
                  className={`flex items-center gap-1.5 rounded px-3 py-1.5 text-xs font-medium transition-colors ${
                    view === 'workspace' ? 'bg-gray-700 text-white' : 'text-gray-400 hover:text-white'
                  }`}
                >
                  <GitBranch className="w-3.5 h-3.5" /> Your repos
                  <kbd className="ml-1 rounded border border-gray-600 bg-black/30 px-1 text-[9px] text-gray-500">w</kbd>
                </button>
                <button
                  onClick={() => setView('explore')}
                  className={`flex items-center gap-1.5 rounded px-3 py-1.5 text-xs font-medium transition-colors ${
                    view === 'explore' ? 'bg-gray-700 text-white' : 'text-gray-400 hover:text-white'
                  }`}
                >
                  <Github className="w-3.5 h-3.5" /> Explore GitHub
                  <kbd className="ml-1 rounded border border-gray-600 bg-black/30 px-1 text-[9px] text-gray-500">e</kbd>
                </button>
              </nav>
            </div>
          </div>
        </header>

        <div className="max-w-7xl mx-auto px-4 py-6 space-y-4">
          {/* Real-time Enhancement Toolbar */}
          <div className="flex items-center gap-2 flex-wrap">
            <LiveIndicator isLive={isLive} lastUpdated={lastUpdated} compact />
            <DTUExportButton domain="repos" data={realtimeData || {}} compact />
            {realtimeAlerts.length > 0 && (
              <span className="text-xs px-2 py-0.5 rounded bg-yellow-500/10 text-yellow-400">
                {realtimeAlerts.length} alert{realtimeAlerts.length !== 1 ? 's' : ''}
              </span>
            )}
          </div>

          {view === 'workspace' && (
            <section className="rounded-xl border border-zinc-800 bg-zinc-950/40 p-4">
              <ConcordRepoWorkspace />
            </section>
          )}

          {view === 'explore' && (
            <div className="space-y-6">
              <section className="rounded-xl border border-zinc-800 bg-zinc-950/40 p-4">
                <RepoBrowser />
              </section>
              <section className="rounded-xl border border-zinc-800 bg-zinc-950/40 p-4">
                <TrendingRepos />
              </section>
            </div>
          )}

          {/* Real-time Data Panel */}
          {realtimeData && (
            <RealtimeDataPanel
              domain="repos"
              data={realtimeData}
              isLive={isLive}
              lastUpdated={lastUpdated}
              insights={realtimeInsights}
              compact
            />
          )}
        </div>
      </div>      <CrossLensRecentsPanel lensId="repos" sinceDays={7} limit={6} hideWhenEmpty className="mt-3" />
    </LensShell>
  );
}
