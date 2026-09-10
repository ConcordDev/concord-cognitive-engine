'use client';

import { LensShell } from '@/components/lens/LensShell';
import { SessionRail } from '@/components/lens/SessionRail';
import { CrossLensRecentsPanel } from '@/components/lens/CrossLensRecentsPanel';
import { FirstRunTour } from '@/components/lens/FirstRunTour';
import { DepthBadge } from '@/components/lens/DepthBadge';
import { ProjectsSection } from '@/components/projects/ProjectsSection';
import { LensVerticalHero } from '@/components/lens/LensVerticalHero';
import { ProjectMgmtRepos } from '@/components/projects/ProjectMgmtRepos';
import { useLensNav } from '@/hooks/useLensNav';
import { FolderKanban, ChevronDown, ChevronRight } from 'lucide-react';
import { useState } from 'react';
import { useRealtimeLens } from '@/hooks/useRealtimeLens';
import { LiveIndicator } from '@/components/lens/LiveIndicator';
import { DTUExportButton } from '@/components/lens/DTUExportButton';
import { RealtimeDataPanel } from '@/components/lens/RealtimeDataPanel';

export default function ProjectsLensPage() {
  useLensNav('projects');
  const { latestData: realtimeData, isLive, lastUpdated, insights } = useRealtimeLens('projects');
  const [showRepos, setShowRepos] = useState(false);

  return (
    <LensShell lensId="projects" asMain={false}>
      <FirstRunTour lensId="projects" />      <DepthBadge lensId="projects" size="sm" className="ml-2" />
      <LensVerticalHero lensId="projects" className="mx-6 mt-4" />
    <div data-lens-theme="projects" className="space-y-6 p-6">
      <header className="flex items-center justify-between">
        <div className="flex items-center gap-4">
          <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-violet-500 to-purple-600 flex items-center justify-center"><FolderKanban className="w-5 h-5 text-white" /></div>
          <div><div className="flex items-center gap-2"><h1 className="text-xl font-bold">Projects</h1><LiveIndicator isLive={isLive} lastUpdated={lastUpdated} /></div><p className="text-sm text-gray-400">Linear + Asana + Jira parity — projects, backlog, sprints, planning, team, reports, portfolio.</p></div>
        </div>
        <div className="flex items-center gap-2"><DTUExportButton domain="projects" data={{}} compact /></div>
      </header>
      <RealtimeDataPanel domain="projects" data={realtimeData} isLive={isLive} lastUpdated={lastUpdated} insights={insights} compact />

      <div className="px-0">
        <ProjectsSection />
      </div>

      <section className="mt-6 rounded-xl border border-lattice-border bg-lattice-void/40 p-4">
        <button
          type="button"
          onClick={() => setShowRepos(v => !v)}
          className="flex w-full items-center justify-between text-left text-sm font-semibold text-white"
        >
          <span>Project management tooling (GitHub)</span>
          {showRepos ? <ChevronDown className="h-4 w-4" /> : <ChevronRight className="h-4 w-4" />}
        </button>
        {showRepos && (
          <div className="mt-3">
            <ProjectMgmtRepos />
          </div>
        )}
      </section>
    </div>

      <a href="#projects-skip" className="sr-only focus:not-sr-only focus:ring-2 focus:ring-amber-500 focus:outline-none">Skip to projects content</a>
          <SessionRail lensId="projects" hideWhenEmpty className="mt-4" />          <CrossLensRecentsPanel lensId="projects" sinceDays={7} limit={6} hideWhenEmpty className="mt-3" />
    </LensShell>
  );
}
