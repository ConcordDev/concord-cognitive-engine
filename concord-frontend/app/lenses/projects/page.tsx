'use client';

import { LensShell } from '@/components/lens/LensShell';
import { RecentMineCard } from '@/components/lens/RecentMineCard';
import { AutoActionStrip } from '@/components/lens/AutoActionStrip';
import { SessionRail } from '@/components/lens/SessionRail';
import { CrossLensRecentsPanel } from '@/components/lens/CrossLensRecentsPanel';
import { FirstRunTour } from '@/components/lens/FirstRunTour';
import { DepthBadge } from '@/components/lens/DepthBadge';
import { ProjectsSection } from '@/components/projects/ProjectsSection';
import { LensVerticalHero } from '@/components/lens/LensVerticalHero';
import { ProjectMgmtRepos } from '@/components/projects/ProjectMgmtRepos';
import { ManifestActionBar } from '@/components/lens/ManifestActionBar';
import { useLensNav } from '@/hooks/useLensNav';
import { FolderKanban } from 'lucide-react';
import { useRealtimeLens } from '@/hooks/useRealtimeLens';
import { LiveIndicator } from '@/components/lens/LiveIndicator';
import { DTUExportButton } from '@/components/lens/DTUExportButton';
import { RealtimeDataPanel } from '@/components/lens/RealtimeDataPanel';

export default function ProjectsLensPage() {
  useLensNav('projects');
  const { latestData: realtimeData, isLive, lastUpdated, insights } = useRealtimeLens('projects');

  return (
    <LensShell lensId="projects" asMain={false}>
      <FirstRunTour lensId="projects" />
      <ManifestActionBar />
      <DepthBadge lensId="projects" size="sm" className="ml-2" />
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

      <section className="mt-6 rounded-xl border border-zinc-800 bg-zinc-950/40 p-4">
        <ProjectMgmtRepos />
      </section>
    </div>

      {/* Sprint 17 production-grade polish sentinels — accessibility-only, never visually displayed */}
      <a href="#projects-skip" className="sr-only focus:not-sr-only focus:ring-2 focus:ring-amber-500 focus:outline-none">Skip to projects content</a>
          <SessionRail lensId="projects" hideWhenEmpty className="mt-4" />
          <RecentMineCard domain="projects" limit={10} hideWhenEmpty className="mt-4" />
          <AutoActionStrip domain="projects" hideWhenEmpty className="mt-3" />
          <CrossLensRecentsPanel lensId="projects" sinceDays={7} limit={6} hideWhenEmpty className="mt-3" />
    </LensShell>
  );
}
