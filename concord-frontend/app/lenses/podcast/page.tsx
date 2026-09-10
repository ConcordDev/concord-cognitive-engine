'use client';

/**
 * Podcast — one Apple-Podcasts / Buzzsprout studio app.
 *
 * Single `active` union drives the tab bar. Former inline Episodes/Create/
 * Analytics tabs + competing Listening-Hub / iTunes / Studio accordion
 * booleans are folded into panels under components/podcast/.
 */

import { useCallback, useState, type ComponentType } from 'react';
import { AnimatePresence, motion, useReducedMotion } from 'framer-motion';
import {
  Mic2, Plus, BarChart3, Headphones, Search, CircleDot, Rss, Check,
} from 'lucide-react';
import { LensShell } from '@/components/lens/LensShell';
import { CrossLensRecentsPanel } from '@/components/lens/CrossLensRecentsPanel';
import { FirstRunTour } from '@/components/lens/FirstRunTour';
import { DepthBadge } from '@/components/lens/DepthBadge';
import { PodcastPlayerSection } from '@/components/podcast/PodcastPlayerSection';
import { ItunesSearch } from '@/components/podcast/ItunesSearch';
import { PodcastActionPanel } from '@/components/podcast/PodcastActionPanel';
import { PodcastListeningHub } from '@/components/podcast/PodcastListeningHub';
import { EpisodesPanel } from '@/components/podcast/EpisodesPanel';
import { CreateEpisodePanel } from '@/components/podcast/CreateEpisodePanel';
import { AnalyticsPanel } from '@/components/podcast/AnalyticsPanel';
import { PipingProvider } from '@/components/panel-polish';
import { useLensNav } from '@/hooks/useLensNav';
import { useLensCommand } from '@/hooks/useLensCommand';
import { useLensIdentity } from '@/hooks/useLensIdentity';
import { useRealtimeLens } from '@/hooks/useRealtimeLens';
import { LiveIndicator } from '@/components/lens/LiveIndicator';
import { ds } from '@/lib/design-system';
import { cn } from '@/lib/utils';

type PodcastView = 'episodes' | 'create' | 'analytics' | 'listen' | 'itunes' | 'actions';

const VIEWS: { id: PodcastView; label: string; keys: string; hint: string; icon: typeof Mic2 }[] = [
  { id: 'episodes', label: 'Episodes', keys: 'g e', hint: 'Your show episodes', icon: Mic2 },
  { id: 'create', label: 'New Episode', keys: 'g c', hint: 'Record / upload', icon: Plus },
  { id: 'analytics', label: 'Analytics', keys: 'g a', hint: 'Plays · DTUs', icon: BarChart3 },
  { id: 'listen', label: 'Listening Hub', keys: 'g l', hint: 'RSS · sync · rules', icon: Headphones },
  { id: 'itunes', label: 'iTunes Search', keys: 'g i', hint: 'Apple directory', icon: Search },
  { id: 'actions', label: 'Studio', keys: 'g x', hint: 'Workbench macros', icon: CircleDot },
];

function ListenPanel() {
  return <PodcastListeningHub />;
}

function ItunesPanel() {
  return (
    <section className="rounded-xl border border-zinc-800 bg-zinc-950/40 p-4">
      <ItunesSearch />
    </section>
  );
}

function StudioPanel() {
  return (
    <PipingProvider>
      <PodcastActionPanel />
    </PipingProvider>
  );
}

export default function PodcastLensPage() {
  useLensNav('podcast');
  useLensIdentity('podcast');
  const { isLive, lastUpdated } = useRealtimeLens('podcast');
  const reduceMotion = useReducedMotion();
  const [active, setActive] = useState<PodcastView>('episodes');
  const [rssCopied, setRssCopied] = useState(false);

  const go = useCallback((id: PodcastView) => setActive(id), []);

  useLensCommand(
    [
      ...VIEWS.map((v) => ({
        id: `goto-${v.id}`,
        keys: v.keys,
        description: `${v.label} — ${v.hint}`,
        category: 'navigation' as const,
        action: () => go(v.id),
      })),
      { id: 'new-episode', keys: 'n', description: 'New episode', category: 'actions' as const, action: () => go('create') },
    ],
    { lensId: 'podcast' },
  );

  const handleCopyRss = useCallback(async () => {
    const feedUrl = `${window.location.origin}/api/podcast/default/feed.xml`;
    try {
      await navigator.clipboard.writeText(feedUrl);
      setRssCopied(true);
      setTimeout(() => setRssCopied(false), 2000);
    } catch {
      // clipboard API may not be available
    }
  }, []);

  const Panel: ComponentType<{ onCreated?: () => void }> =
    active === 'episodes' ? EpisodesPanel :
    active === 'create' ? CreateEpisodePanel :
    active === 'analytics' ? AnalyticsPanel :
    active === 'listen' ? ListenPanel :
    active === 'itunes' ? ItunesPanel :
    StudioPanel;

  return (
    <LensShell lensId="podcast" asMain={false}>
      <FirstRunTour lensId="podcast" />
      <DepthBadge lensId="podcast" size="sm" className="ml-2" />
      <div className="px-4 mt-3">
        <PodcastPlayerSection />
      </div>
      <div data-lens-theme="podcast" className={cn(ds.pageContainer, 'max-w-6xl mx-auto')}>
        <header className={cn(ds.sectionHeader, 'gap-3 flex-wrap')}>
          <div className="flex items-center gap-3 min-w-0">
            <div className="w-10 h-10 rounded-xl bg-purple-400/20 flex items-center justify-center shrink-0">
              <Mic2 className="w-5 h-5 text-purple-400" />
            </div>
            <div className="min-w-0">
              <div className="flex items-center gap-2 flex-wrap">
                <h1 className={ds.heading1}>Podcast Studio</h1>
                {isLive && <LiveIndicator isLive={isLive} lastUpdated={lastUpdated} />}
              </div>
              <p className={ds.textMuted}>Create, publish, and distribute — one Apple-Podcasts desk.</p>
            </div>
          </div>
          <button
            type="button"
            onClick={handleCopyRss}
            className="flex items-center gap-2 px-3 py-1.5 rounded-lg bg-orange-500/20 text-orange-400 hover:bg-orange-500/30 transition-colors text-sm"
          >
            {rssCopied ? <Check className="w-4 h-4" /> : <Rss className="w-4 h-4" />}
            {rssCopied ? 'Copied!' : 'Copy RSS Feed'}
          </button>
        </header>

        <nav
          className="flex items-center gap-1 border-b border-lattice-border overflow-x-auto"
          aria-label="Podcast views"
        >
          {VIEWS.map((v) => {
            const Icon = v.icon;
            const on = active === v.id;
            return (
              <button
                key={v.id}
                type="button"
                onClick={() => go(v.id)}
                className={cn(
                  'flex items-center gap-2 px-3 py-2.5 text-sm font-medium border-b-2 whitespace-nowrap transition-colors',
                  on
                    ? 'border-purple-400 text-white'
                    : 'border-transparent text-gray-400 hover:text-white hover:border-gray-600',
                )}
                aria-current={on ? 'page' : undefined}
              >
                <Icon className="w-4 h-4" />
                {v.label}
                <kbd className="hidden sm:inline-block text-[10px] text-white/30 bg-white/5 border border-white/10 rounded px-1 py-0.5 font-mono">
                  {v.keys}
                </kbd>
              </button>
            );
          })}
        </nav>

        <main className="py-6">
          <AnimatePresence mode="wait">
            <motion.div
              key={active}
              initial={reduceMotion ? false : { opacity: 0, y: 8 }}
              animate={{ opacity: 1, y: 0 }}
              exit={reduceMotion ? undefined : { opacity: 0, y: -4 }}
              transition={{ duration: reduceMotion ? 0 : 0.16 }}
            >
              {active === 'create'
                ? <CreateEpisodePanel onCreated={() => go('episodes')} />
                : <Panel />}
            </motion.div>
          </AnimatePresence>
        </main>

        <CrossLensRecentsPanel lensId="podcast" sinceDays={7} limit={6} hideWhenEmpty className="mt-3" />
      </div>
    </LensShell>
  );
}
