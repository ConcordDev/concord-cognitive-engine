'use client';

import { LensShell } from '@/components/lens/LensShell';
import { SessionRail } from '@/components/lens/SessionRail';
import { CrossLensRecentsPanel } from '@/components/lens/CrossLensRecentsPanel';
import { FirstRunTour } from '@/components/lens/FirstRunTour';
import { DepthBadge } from '@/components/lens/DepthBadge';
import { ProjectsSection } from '@/components/projects/ProjectsSection';
import { ProjectMgmtRepos } from '@/components/projects/ProjectMgmtRepos';
import { useLensNav } from '@/hooks/useLensNav';
import { ChevronDown, ChevronRight, Plus } from 'lucide-react';
import { useAuth } from '@/hooks/useAuth';
import { titleCaseDisplayName } from '@/components/chat/claudeCleanGreeting';
import { useState } from 'react';
import { useRealtimeLens } from '@/hooks/useRealtimeLens';
import { LiveIndicator } from '@/components/lens/LiveIndicator';
import { DTUExportButton } from '@/components/lens/DTUExportButton';
import { RealtimeDataPanel } from '@/components/lens/RealtimeDataPanel';

export default function ProjectsLensPage() {
  useLensNav('projects');
  const { latestData: realtimeData, isLive, lastUpdated, insights } = useRealtimeLens('projects');
  const { user } = useAuth();
  const who = titleCaseDisplayName(user?.username);
  const [showRepos, setShowRepos] = useState(false);

  return (
    <LensShell lensId="projects" asMain={false}>
      <FirstRunTour lensId="projects" />      <DepthBadge lensId="projects" size="sm" className="ml-2" />
    <div data-lens-theme="projects" className="relative min-h-full space-y-5 px-8 pb-28 pt-6">
      <div className="flex items-start justify-between gap-4">
        <div className="min-w-0">
          <p className="text-[14px] text-zinc-500">Projects</p>
          <h1 className="mt-1 font-vault text-[2.25rem] leading-tight text-zinc-100 sm:text-5xl">What is moving{who ? `, ${who}` : ''}</h1>
          <p className="mt-2 max-w-2xl text-[13px] text-zinc-500">Backlog, sprints, timeline, planning, team, reports and portfolio for every project.</p>
        </div>
        <div className="flex shrink-0 items-center gap-3 pt-2">
          <LiveIndicator isLive={isLive} lastUpdated={lastUpdated} />
          <DTUExportButton domain="projects" data={{}} compact />
        </div>
      </div>
      <RealtimeDataPanel domain="projects" data={realtimeData} isLive={isLive} lastUpdated={lastUpdated} insights={insights} compact />

      <div className="px-0">
        <ProjectsSection />
      </div>

      <section className="rounded-2xl border border-white/10 bg-[#111] p-4">
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

      <button
        type="button"
        onClick={() => window.dispatchEvent(new CustomEvent('projects:new'))}
        title="Start a new project"
        className="fixed bottom-8 right-8 z-30 inline-flex items-center gap-2 rounded-full bg-teal-400 px-6 py-3.5 text-[15px] font-medium text-black shadow-[0_8px_32px_rgba(45,212,191,0.25)] transition-colors hover:bg-teal-300"
      >
        <Plus className="h-4 w-4" />
        New project
      </button>
    </div>

      <a href="#projects-skip" className="sr-only focus:not-sr-only focus:ring-2 focus:ring-amber-500 focus:outline-none">Skip to projects content</a>
          <SessionRail lensId="projects" hideWhenEmpty className="mt-4" />          <CrossLensRecentsPanel lensId="projects" sinceDays={7} limit={6} hideWhenEmpty className="mt-3" />
    </LensShell>
  );
}
