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
import { useAuth } from '@/hooks/useAuth';
import { titleCaseDisplayName } from '@/components/chat/claudeCleanGreeting';
import { useRealtimeLens } from '@/hooks/useRealtimeLens';
import { LiveIndicator } from '@/components/lens/LiveIndicator';
import { ds } from '@/lib/design-system';
import { cn } from '@/lib/utils';

type PodcastView = 'episodes' | 'create' | 'analytics' | 'listen' | 'itunes' | 'actions';

const VIEWS: { id: PodcastView; title: string; label: string; keys: string; hint: string; icon: typeof Mic2 }[] = [
  { id: 'episodes', title: 'Your show', label: 'Episodes', keys: 'g e', hint: 'Your show episodes', icon: Mic2 },
  { id: 'create', title: 'Make a new episode', label: 'New Episode', keys: 'g c', hint: 'Record / upload', icon: Plus },
  { id: 'analytics', title: 'Who is listening', label: 'Analytics', keys: 'g a', hint: 'Plays · DTUs', icon: BarChart3 },
  { id: 'listen', title: 'What you are listening to', label: 'Listening Hub', keys: 'g l', hint: 'RSS · sync · rules', icon: Headphones },
  { id: 'itunes', title: 'Find a show', label: 'iTunes Search', keys: 'g i', hint: 'Apple directory', icon: Search },
  { id: 'actions', title: 'The studio workbench', label: 'Studio', keys: 'g x', hint: 'Workbench macros', icon: CircleDot },
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
  const { user } = useAuth();
  const who = titleCaseDisplayName(user?.username);
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

  const current = VIEWS.find((v) => v.id === active)!;

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
      <div data-lens-theme="podcast" className="relative min-h-full px-8 pb-28 pt-6">
        <div className="flex items-start justify-between gap-4">
          <div className="min-w-0">
            <p className="text-[14px] text-zinc-500">Podcast</p>
            <h1 className="mb-5 mt-1 font-vault text-[2.25rem] leading-tight text-zinc-100 sm:text-5xl">
              {current.title}{active === 'episodes' && who ? `, ${who}` : ''}
            </h1>
          </div>
          <div className="flex shrink-0 items-center gap-3 pt-2">
            {isLive && <LiveIndicator isLive={isLive} lastUpdated={lastUpdated} compact />}
            <button
              type="button"
              onClick={handleCopyRss}
              className="inline-flex items-center gap-2 rounded-full border border-white/10 bg-white/[0.03] px-4 py-1.5 text-[14px] text-zinc-300 transition-colors hover:text-white"
            >
              {rssCopied ? <Check className="h-4 w-4 text-teal-300" /> : <Rss className="h-4 w-4" />}
              {rssCopied ? 'Copied' : 'Copy RSS feed'}
            </button>
          </div>
        </div>

        <nav
          className="mb-6 inline-flex max-w-full items-center gap-1 overflow-x-auto rounded-full border border-white/10 bg-white/[0.03] p-1"
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
                aria-current={on ? 'page' : undefined}
                title={`${v.hint} (${v.keys})`}
                className={cn(
                  'inline-flex items-center gap-2 whitespace-nowrap rounded-full px-4 py-1.5 text-[14px] transition-colors',
                  on ? 'bg-white/10 text-zinc-50' : 'text-zinc-500 hover:text-zinc-200',
                )}
              >
                <Icon className="h-3.5 w-3.5" />
                {v.label}
                <kbd className="hidden rounded border border-white/10 bg-white/5 px-1 py-0.5 font-mono text-[10px] text-white/30 sm:inline-block">
                  {v.keys}
                </kbd>
              </button>
            );
          })}
        </nav>

        <div className="mb-6">
          <PodcastPlayerSection />
        </div>

        <main>
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

        <CrossLensRecentsPanel lensId="podcast" sinceDays={7} limit={6} hideWhenEmpty className="mt-8" />

        <button
          type="button"
          onClick={() => go('create')}
          title="New episode (N)"
          className="fixed bottom-8 right-8 z-30 inline-flex items-center gap-2 rounded-full bg-teal-400 px-6 py-3.5 text-[15px] font-medium text-black shadow-[0_8px_32px_rgba(45,212,191,0.25)] transition-colors hover:bg-teal-300"
        >
          <Plus className="h-4 w-4" />
          New episode
        </button>
      </div>
    </LensShell>
  );
}
