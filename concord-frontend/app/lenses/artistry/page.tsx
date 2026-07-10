'use client';

import { useEffect, useState } from 'react';
import dynamic from 'next/dynamic';
import { LensShell } from '@/components/lens/LensShell';
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
import { cn } from '@/lib/utils';
import {
  Palette, FolderPlus, User, Rss, Bookmark, Search, Briefcase, Star,
  Wand2, PenTool, RefreshCw,
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

const TABS: { id: ArtistryTab; label: string; icon: typeof Palette; hotkey: string }[] = [
  { id: 'network', label: 'Feed', icon: Rss, hotkey: '1' },
  { id: 'projects', label: 'Projects', icon: FolderPlus, hotkey: '2' },
  { id: 'profile', label: 'Profile', icon: User, hotkey: '3' },
  { id: 'collections', label: 'Collections', icon: Bookmark, hotkey: '4' },
  { id: 'discover', label: 'Discover', icon: Search, hotkey: '5' },
  { id: 'jobs', label: 'Jobs', icon: Briefcase, hotkey: '6' },
  { id: 'galleries', label: 'Galleries', icon: Star, hotkey: '7' },
  { id: 'tools', label: 'Creative Tools', icon: Wand2, hotkey: '8' },
  { id: 'sketchpad', label: 'Sketchpad', icon: PenTool, hotkey: '9' },
];

export default function ArtistryLensPage() {
  useLensNav('artistry');
  const [tab, setTab] = useState<ArtistryTab>('network');

  // Header KPI strip — real profileGet stats (projectCount/views/
  // appreciations/followers/following), dispatched honestly via
  // useMacroDispatchFeedback (loading/running/done/error, never a guess).
  const kpi = useMacroDispatchFeedback<ProfileHeaderResult>();

  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => { kpi.dispatch('artistry', 'profileGet', {}); }, []);

  useLensCommand(
    [
      ...TABS.map((t) => ({
        id: `tab-${t.id}`,
        keys: t.hotkey,
        description: t.label,
        category: 'navigation' as const,
        action: () => setTab(t.id),
      })),
      { id: 'refresh-kpi', keys: 'r', description: 'Refresh stats', category: 'actions', action: () => kpi.dispatch('artistry', 'profileGet', {}) },
    ],
    { lensId: 'artistry' },
  );

  return (
    <LensShell lensId="artistry" asMain={false}>
      <FirstRunTour lensId="artistry" />
      <DepthBadge lensId="artistry" size="sm" className="ml-2" />
      <div data-lens-theme="artistry" className="min-h-screen">
        <div className="max-w-7xl mx-auto px-6 py-6 space-y-6">
          {/* Header */}
          <div className="flex items-center justify-between flex-wrap gap-3">
            <div className="flex items-center gap-3">
              <Palette className="w-6 h-6 text-neon-pink" />
              <h1 className="text-2xl font-bold">Artistry</h1>
              {kpi.result?.profile?.displayName && (
                <span className="text-xs text-gray-400">portfolio: {kpi.result.profile.displayName}</span>
              )}
            </div>
            <div className="flex items-center gap-2">
              <DensityToggle variant="dropdown" />
              <DTUExportButton domain="artistry" data={{}} compact />
              <button
                onClick={() => kpi.dispatch('artistry', 'profileGet', {})}
                aria-label="Refresh stats"
                className="p-1.5 bg-white/5 border border-white/10 rounded-lg hover:bg-white/10 text-gray-400 hover:text-white"
              >
                <RefreshCw className={cn('w-3.5 h-3.5', (kpi.status === 'dispatched' || kpi.status === 'running') && 'animate-spin')} />
              </button>
            </div>
          </div>

          {/* KPI strip — real profileGet stats, honest 4-state */}
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

          {/* Tabs */}
          <div className="flex gap-1 bg-white/5 p-1 rounded-lg border border-white/10 overflow-x-auto">
            {TABS.map((t) => (
              <button
                key={t.id}
                onClick={() => setTab(t.id)}
                className={cn(
                  'flex items-center gap-1.5 px-3 py-1.5 rounded-md text-xs transition-colors whitespace-nowrap',
                  tab === t.id ? 'bg-neon-pink/20 text-neon-pink' : 'text-gray-400 hover:text-white hover:bg-white/5',
                )}
              >
                <t.icon className="w-3.5 h-3.5" /> {t.label}
              </button>
            ))}
          </div>

          {/* Feed + follow graph (Behance-parity home feed) */}
          {tab === 'network' && <CommunityNetwork />}

          {/* Projects — multi-image case studies */}
          {tab === 'projects' && <ProjectStudio />}

          {/* Portfolio profile page */}
          {tab === 'profile' && <PortfolioProfile />}

          {/* Collections — save-to-board */}
          {tab === 'collections' && <Collections />}

          {/* Tag / discipline search */}
          {tab === 'discover' && <DisciplineSearch />}

          {/* Job board / commission requests */}
          {tab === 'jobs' && <JobBoard />}

          {/* Behance-style curated galleries */}
          {tab === 'galleries' && <CuratedGalleries />}

          {/* Standalone compute utilities — not part of the portfolio substrate */}
          {tab === 'tools' && <CreativeTools />}

          {/* Local sketch canvas */}
          {tab === 'sketchpad' && (
            <div className="space-y-3">
              <div className="flex items-center gap-2">
                <PenTool className="w-5 h-5 text-neon-pink" />
                <h2 className="text-lg font-semibold">Sketchpad</h2>
              </div>
              <p className="text-xs text-gray-400">
                This canvas is local to your current session — nothing here is saved
                automatically or attached to your portfolio. Export as an image from the
                canvas toolbar, then add its URL to a project&apos;s cover or gallery images
                in Projects to keep it.
              </p>
              <div className="w-full rounded-lg border border-white/10 overflow-hidden" style={{ height: '65vh' }}>
                <Excalidraw
                  theme="dark"
                  UIOptions={{ canvasActions: { saveToActiveFile: false, loadScene: false } }}
                />
              </div>
            </div>
          )}
        </div>

        <section className="max-w-7xl mx-auto px-6 pb-6">
          <div className="rounded-xl border border-zinc-800 bg-zinc-950/40 p-4">
            <WikimediaArt />
          </div>
        </section>
      </div>
    </LensShell>
  );
}
