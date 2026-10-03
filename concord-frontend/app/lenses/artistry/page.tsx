'use client';

import { useCallback, useEffect, useState } from 'react';
import dynamic from 'next/dynamic';
import { LensShell } from '@/components/lens/LensShell';
import { CrossLensRecentsPanel } from '@/components/lens/CrossLensRecentsPanel';
import { FirstRunTour } from '@/components/lens/FirstRunTour';
import { DepthBadge } from '@/components/lens/DepthBadge';
import { DTUExportButton } from '@/components/lens/DTUExportButton';
import { DensityToggle } from '@/components/ui/DensityToggle';
import { StatTile, StatTileGrid } from '@/components/ui/StatTile';
import { Skeleton } from '@/components/ui/Skeleton';
import { ErrorState } from '@/components/ui/ErrorState';
import { useLensNav } from '@/hooks/useLensNav';
import { useLensCommand } from '@/hooks/useLensCommand';
import { useMacroDispatchFeedback } from '@/hooks/useMacroDispatchFeedback';
import { useAuth } from '@/hooks/useAuth';
import { titleCaseDisplayName } from '@/components/chat/claudeCleanGreeting';
import { cn } from '@/lib/utils';
import {
  FolderPlus, User, Rss, Bookmark, Search, Briefcase, Star,
  Wand2, PenTool, RefreshCw, Plus,
} from 'lucide-react';
import { ProjectStudio } from '@/components/artistry/ProjectStudio';
import { PortfolioProfile } from '@/components/artistry/PortfolioProfile';
import { CommunityNetwork } from '@/components/artistry/CommunityNetwork';
import { Collections } from '@/components/artistry/Collections';
import { DisciplineSearch } from '@/components/artistry/DisciplineSearch';
import { JobBoard } from '@/components/artistry/JobBoard';
import { CuratedGalleries } from '@/components/artistry/CuratedGalleries';
import { WikimediaArt } from '@/components/artistry/WikimediaArt';
import { CreativeTools } from '@/components/artistry/CreativeTools';

const Excalidraw = dynamic(
  () => import('@excalidraw/excalidraw').then((mod) => ({ default: mod.Excalidraw })),
  { ssr: false },
);

type ArtistryTab =
  | 'network' | 'projects' | 'profile' | 'collections'
  | 'discover' | 'jobs' | 'galleries' | 'tools' | 'sketchpad';

interface ProfileHeaderResult {
  profile: { displayName: string };
  stats: {
    projectCount: number;
    totalViews: number;
    totalAppreciations: number;
    followerCount: number;
    followingCount: number;
  };
}

const TABS: { id: ArtistryTab; label: string; title: string; icon: typeof Rss; hotkey: string }[] = [
  { id: 'network', title: 'The feed', label: 'Feed', icon: Rss, hotkey: '1' },
  { id: 'projects', title: 'The study', label: 'Projects', icon: FolderPlus, hotkey: '2' },
  { id: 'profile', title: 'The portfolio', label: 'Profile', icon: User, hotkey: '3' },
  { id: 'collections', title: 'The collections', label: 'Collections', icon: Bookmark, hotkey: '4' },
  { id: 'discover', title: 'The search', label: 'Discover', icon: Search, hotkey: '5' },
  { id: 'jobs', title: 'The commissions', label: 'Jobs', icon: Briefcase, hotkey: '6' },
  { id: 'galleries', title: 'The galleries', label: 'Galleries', icon: Star, hotkey: '7' },
  { id: 'tools', title: 'The toolbench', label: 'Creative Tools', icon: Wand2, hotkey: '8' },
  { id: 'sketchpad', title: 'The sketchpad', label: 'Sketchpad', icon: PenTool, hotkey: '9' },
];

export default function ArtistryLensPage() {
  useLensNav('artistry');
  const { user } = useAuth();
  const who = titleCaseDisplayName(user?.username);
  const [tab, setTab] = useState<ArtistryTab>('projects');

  // Header KPI strip — real profileGet stats (projectCount/views/
  // appreciations/followers/following), dispatched honestly via
  // useMacroDispatchFeedback (loading/running/done/error, never a guess).
  const kpi = useMacroDispatchFeedback<ProfileHeaderResult>();

  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => { kpi.dispatch('artistry', 'profileGet', {}); }, []);

  const newStudy = useCallback(() => {
    setTab('projects');
    let tries = 0;
    const open = () => {
      const el = document.querySelector<HTMLButtonElement>('[data-lens-theme="artistry"] [data-artistry-new-project]');
      if (el) { el.click(); return; }
      if (++tries < 20) requestAnimationFrame(open);
    };
    requestAnimationFrame(open);
  }, []);

  useLensCommand(
    [
      ...TABS.map((t) => ({
        id: `tab-${t.id}`,
        keys: t.hotkey,
        description: t.label,
        category: 'navigation' as const,
        action: () => setTab(t.id),
      })),
      { id: 'new-study', keys: 'n', description: 'New study', category: 'actions', action: newStudy },
      { id: 'refresh-kpi', keys: 'r', description: 'Refresh stats', category: 'actions', action: () => kpi.dispatch('artistry', 'profileGet', {}) },
    ],
    { lensId: 'artistry' },
  );

  const current = TABS.find((t) => t.id === tab)!;

  return (
    <LensShell lensId="artistry" asMain={false}>
      <FirstRunTour lensId="artistry" />
      <DepthBadge lensId="artistry" size="sm" className="ml-2" />
      <div data-lens-theme="artistry" className="relative min-h-full px-8 pb-28 pt-6">
        <div className="flex items-start justify-between gap-4">
          <div className="min-w-0">
            <p className="text-[14px] text-zinc-500">
              Artistry{kpi.result?.profile?.displayName ? ` · ${kpi.result.profile.displayName}` : ''}
            </p>
            <h1 className="mb-5 mt-1 font-vault text-[2.25rem] leading-tight text-zinc-100 sm:text-5xl">
              {current.title}{tab === 'projects' && who ? `, ${who}` : ''}
            </h1>
          </div>
          <div className="flex shrink-0 items-center gap-2 pt-2">
            <DensityToggle variant="dropdown" />
            <DTUExportButton domain="artistry" data={{}} compact />
            <button
              type="button"
              onClick={() => kpi.dispatch('artistry', 'profileGet', {})}
              aria-label="Refresh stats"
              title="Refresh stats (R)"
              className="rounded-full border border-white/10 p-2 text-zinc-400 transition-colors hover:text-zinc-100"
            >
              <RefreshCw className={cn('h-4 w-4', (kpi.status === 'dispatched' || kpi.status === 'running') && 'animate-spin')} />
            </button>
          </div>
        </div>

        <nav className="mb-6 inline-flex max-w-full items-center gap-1 overflow-x-auto rounded-full border border-white/10 bg-white/[0.03] p-1" aria-label="Artistry views">
          {TABS.map((t) => {
            const on = tab === t.id;
            return (
              <button
                key={t.id}
                type="button"
                onClick={() => setTab(t.id)}
                aria-current={on ? 'page' : undefined}
                className={cn(
                  'inline-flex items-center gap-2 whitespace-nowrap rounded-full px-4 py-1.5 text-[14px] transition-colors',
                  on ? 'bg-white/10 text-zinc-50' : 'text-zinc-500 hover:text-zinc-200',
                )}
              >
                <t.icon className="h-3.5 w-3.5" />
                {t.label}
                <kbd className="hidden rounded border border-white/10 bg-white/5 px-1 py-0.5 font-mono text-[10px] text-white/30 sm:inline-block">{t.hotkey}</kbd>
              </button>
            );
          })}
        </nav>

        <div className="mb-6">
          {kpi.status === 'dispatched' || kpi.status === 'running' ? (
            <StatTileGrid columns={5}>
              {Array.from({ length: 5 }).map((_, i) => <Skeleton key={i} variant="block" height={64} />)}
            </StatTileGrid>
          ) : kpi.status === 'error' ? (
            <ErrorState variant="inline" message={kpi.error || 'Could not load your portfolio stats.'} onRetry={() => kpi.dispatch('artistry', 'profileGet', {})} />
          ) : kpi.result ? (
            <StatTileGrid columns={5}>
              <StatTile label="Projects" value={kpi.result.stats.projectCount} onClick={() => setTab('projects')} />
              <StatTile label="Views" value={kpi.result.stats.totalViews} />
              <StatTile label="Appreciations" value={kpi.result.stats.totalAppreciations} />
              <StatTile label="Followers" value={kpi.result.stats.followerCount} onClick={() => setTab('network')} />
              <StatTile label="Following" value={kpi.result.stats.followingCount} onClick={() => setTab('network')} />
            </StatTileGrid>
          ) : null}
        </div>

        {tab === 'network' && <CommunityNetwork />}
        {tab === 'projects' && <ProjectStudio />}
        {tab === 'profile' && <PortfolioProfile />}
        {tab === 'collections' && <Collections />}
        {tab === 'discover' && <DisciplineSearch />}
        {tab === 'jobs' && <JobBoard />}
        {tab === 'galleries' && <CuratedGalleries />}
        {tab === 'tools' && <CreativeTools />}

        {tab === 'sketchpad' && (
          <div className="space-y-3">
            <p className="max-w-2xl text-[13px] leading-relaxed text-zinc-500">
              This canvas is local to your current session — nothing here is saved
              automatically or attached to your portfolio. Export as an image from the
              canvas toolbar, then add its URL to a project&apos;s cover or gallery images
              in Projects to keep it.
            </p>
            <div className="w-full overflow-hidden rounded-2xl border border-white/10" style={{ height: '65vh' }}>
              <Excalidraw
                theme="dark"
                UIOptions={{ canvasActions: { saveToActiveFile: false, loadScene: false } }}
              />
            </div>
          </div>
        )}

        <section className="mt-8 rounded-2xl border border-white/10 bg-[#111] p-4">
          <WikimediaArt />
        </section>

        <CrossLensRecentsPanel lensId="artistry" sinceDays={7} limit={6} hideWhenEmpty className="mt-8" />

        <button
          type="button"
          onClick={newStudy}
          title="New study (N)"
          className="fixed bottom-8 right-8 z-30 inline-flex items-center gap-2 rounded-full bg-teal-400 px-6 py-3.5 text-[15px] font-medium text-black shadow-[0_8px_32px_rgba(45,212,191,0.25)] transition-colors hover:bg-teal-300"
        >
          <Plus className="h-4 w-4" />
          New study
        </button>
      </div>
    </LensShell>
  );
}
