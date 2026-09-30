'use client';

import { useState } from 'react';
import { motion, AnimatePresence, useReducedMotion } from 'framer-motion';
import {
  Home,
  Search,
  User,
  Newspaper,
  Wrench,
  Rss,
  PlusCircle,
} from 'lucide-react';
import { LensShell } from '@/components/lens/LensShell';
import { CrossLensRecentsPanel } from '@/components/lens/CrossLensRecentsPanel';
import { FirstRunTour } from '@/components/lens/FirstRunTour';
import { DepthBadge } from '@/components/lens/DepthBadge';
import { HnFrontPage } from '@/components/feed/HnFrontPage';
import { FeedTimelinePanel } from '@/components/feed/FeedTimelinePanel';
import { FeedProfilePanel } from '@/components/feed/FeedProfilePanel';
import { FeedToolsView } from '@/components/feed/FeedToolsView';
import { useLensNav } from '@/hooks/useLensNav';
import { useLensCommand } from '@/hooks/useLensCommand';
import { useLensIdentity } from '@/hooks/useLensIdentity';
import { cn } from '@/lib/utils';
import type { FeedTab } from '@/components/feed/useFeedPosts';

type FeedView = FeedTab | 'profile' | 'tools' | 'hn';

const TIMELINE: FeedTab[] = ['for-you', 'following', 'releases', 'trending'];
const isTimeline = (v: FeedView): v is FeedTab => (TIMELINE as string[]).includes(v);

const RAIL: { id: FeedView; label: string; icon: typeof Home; keys?: string }[] = [
  { id: 'for-you', label: 'For You', icon: Home, keys: 'f' },
  { id: 'following', label: 'Following', icon: Rss, keys: 'l' },
  { id: 'trending', label: 'Explore', icon: Search, keys: 't' },
  { id: 'releases', label: 'Releases', icon: Newspaper, keys: 'r' },
  { id: 'profile', label: 'Profile', icon: User, keys: 'p' },
  { id: 'tools', label: 'Tools', icon: Wrench, keys: 'g' },
  { id: 'hn', label: 'HN', icon: Newspaper, keys: 'h' },
];

export default function FeedLensPage() {
  useLensNav('feed');
  useLensIdentity('feed');
  const reduceMotion = useReducedMotion();
  const [view, setView] = useState<FeedView>('for-you');

  useLensCommand(
    [
      ...RAIL.filter((r) => r.keys).map((r) => ({
        id: `goto-${r.id}`,
        keys: r.keys as string,
        description: r.label,
        category: 'navigation' as const,
        action: () => setView(r.id),
      })),
      {
        id: 'compose',
        keys: 'c',
        description: 'Compose post',
        category: 'actions' as const,
        action: () => setView('for-you'),
      },
    ],
    { lensId: 'feed' },
  );

  return (
    <LensShell lensId="feed" asMain={false}>
      <FirstRunTour lensId="feed" />
      <div className="lens-feed min-h-full bg-lattice-bg flex" data-lens-theme="feed">
        <aside className="w-16 xl:w-56 border-r border-lattice-border/50 p-2 xl:p-3 flex flex-col items-center xl:items-stretch sticky top-0 h-screen overflow-y-auto bg-gradient-to-b from-lattice-surface to-lattice-bg">
          <div className="flex items-center gap-2 mb-6 px-2 py-2">
            <Newspaper className="w-7 h-7 text-[color:var(--lens-accent)]" />
            <span className="hidden xl:inline text-base font-bold text-white tracking-tight">
              Feed
            </span>
            <DepthBadge lensId="feed" size="sm" className="hidden xl:inline ml-auto" />
          </div>
          <nav aria-label="Feed" className="flex flex-col gap-0.5 w-full">
            {RAIL.map((item) => {
              const Icon = item.icon;
              const active = view === item.id;
              return (
                <button
                  key={item.id}
                  type="button"
                  onClick={() => setView(item.id)}
                  className={cn(
                    'flex items-center gap-3 px-3 py-2.5 rounded-xl transition-colors w-full text-left',
                    active
                      ? 'font-semibold text-white bg-white/10'
                      : 'text-gray-400 hover:bg-lattice-surface/50 hover:text-white',
                  )}
                >
                  <Icon className="w-5 h-5 flex-shrink-0" />
                  <span className="hidden xl:inline text-sm">{item.label}</span>
                  {item.keys && (
                    <kbd className="hidden xl:inline ml-auto text-[10px] font-mono text-white/30">
                      {item.keys}
                    </kbd>
                  )}
                </button>
              );
            })}
          </nav>
          <button
            type="button"
            onClick={() => setView('for-you')}
            className="mt-4 w-11 h-11 xl:w-full xl:h-auto xl:py-2.5 bg-[color:var(--lens-accent)] text-black font-bold rounded-full hover:opacity-90 transition-opacity flex items-center justify-center gap-2"
          >
            <PlusCircle className="w-5 h-5 xl:hidden" />
            <span className="hidden xl:inline">Post</span>
            <kbd className="hidden xl:inline text-[10px] font-mono opacity-70">C</kbd>
          </button>
        </aside>

        <AnimatePresence mode="wait">
          <motion.div
            key={view}
            className="flex-1 min-w-0 flex"
            initial={reduceMotion ? false : { opacity: 0, y: 8 }}
            animate={{ opacity: 1, y: 0 }}
            exit={reduceMotion ? undefined : { opacity: 0, y: -6 }}
            transition={{ duration: 0.18 }}
          >
            {isTimeline(view) && (
              <FeedTimelinePanel tab={view} onDiscover={() => setView('trending')} />
            )}
            {view === 'profile' && (
              <FeedProfilePanel onNavigateToUser={() => setView('trending')} />
            )}
            {view === 'tools' && <FeedToolsView />}
            {view === 'hn' && (
              <div className="flex-1 min-w-0 max-w-3xl p-4">
                <HnFrontPage />
              </div>
            )}
          </motion.div>
        </AnimatePresence>
      </div>
      <div className="px-4 pb-6">
        <CrossLensRecentsPanel lensId="feed" sinceDays={7} limit={6} hideWhenEmpty className="mt-3" />
      </div>
    </LensShell>
  );
}
