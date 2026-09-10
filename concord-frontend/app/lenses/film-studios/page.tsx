'use client';

/**
 * Film Studios — one StudioBinder + Letterboxd desk.
 *
 * Single view union. FilmStudioSection (always-on stack) and FilmStackFeed
 * accordion folded into active. Desk tabs extracted to FilmDeskPanel.
 */

import { useMemo, useState, type ReactNode } from 'react';
import { AnimatePresence, motion, useReducedMotion } from 'framer-motion';
import {
  Film, Plus, Globe, Monitor, BarChart3, Clapperboard, MessageSquare,
} from 'lucide-react';
import { LensShell } from '@/components/lens/LensShell';
import { CrossLensRecentsPanel } from '@/components/lens/CrossLensRecentsPanel';
import { FirstRunTour } from '@/components/lens/FirstRunTour';
import { DepthBadge } from '@/components/lens/DepthBadge';
import { useLensNav } from '@/hooks/useLensNav';
import { useLensCommand } from '@/hooks/useLensCommand';
import { useRealtimeLens } from '@/hooks/useRealtimeLens';
import { LiveIndicator } from '@/components/lens/LiveIndicator';
import { DTUExportButton } from '@/components/lens/DTUExportButton';
import { RealtimeDataPanel } from '@/components/lens/RealtimeDataPanel';
import { ds } from '@/lib/design-system';
import { cn } from '@/lib/utils';
import { FilmStudioSection } from '@/components/film-studios/FilmStudioSection';
import { FilmStackFeed } from '@/components/film-studios/FilmStackFeed';
import { FilmDeskPanel, type FilmDeskMode } from '@/components/film-studios/FilmDeskPanel';

type FilmView = 'production' | FilmDeskMode | 'qa';

const VIEWS: { id: FilmView; label: string; keys: string; hint: string; icon: typeof Film }[] = [
  { id: 'production', label: 'Production', keys: 'p', hint: 'StudioBinder suite', icon: Clapperboard },
  { id: 'discover', label: 'Discover', keys: 'd', hint: 'Browse films', icon: Globe },
  { id: 'my-films', label: 'My Films', keys: 'f', hint: 'Your projects', icon: Film },
  { id: 'create', label: 'Create', keys: 'c', hint: 'New film', icon: Plus },
  { id: 'watch-parties', label: 'Watch Parties', keys: 'w', hint: 'Sync watch', icon: Monitor },
  { id: 'analytics', label: 'Analytics', keys: 'a', hint: 'Pipeline stats', icon: BarChart3 },
  { id: 'qa', label: 'Q&A', keys: 'q', hint: 'Filmmaking reference', icon: MessageSquare },
];

const DESK = new Set<FilmView>(['discover', 'my-films', 'create', 'watch-parties', 'analytics']);

export default function FilmStudiosPage() {
  useLensNav('film-studios');
  const { latestData: realtimeData, alerts: realtimeAlerts, insights: realtimeInsights, isLive, lastUpdated } = useRealtimeLens('film-studios');
  const reduceMotion = useReducedMotion();
  const [active, setActive] = useState<FilmView>('production');

  useLensCommand(
    VIEWS.map((v) => ({
      id: `view-${v.id}`,
      keys: v.keys,
      description: `${v.label} — ${v.hint}`,
      category: 'navigation' as const,
      action: () => setActive(v.id),
    })),
    { lensId: 'film-studios' },
  );

  const motionProps = useMemo(
    () => (reduceMotion
      ? { initial: false as const, animate: { opacity: 1 }, exit: { opacity: 1 }, transition: { duration: 0 } }
      : {
          initial: { opacity: 0, y: 8 },
          animate: { opacity: 1, y: 0 },
          exit: { opacity: 0, y: -6 },
          transition: { duration: 0.16 },
        }),
    [reduceMotion],
  );

  let body: ReactNode = null;
  if (active === 'production') body = <FilmStudioSection />;
  else if (active === 'qa') body = <FilmStackFeed />;
  else if (DESK.has(active)) {
    body = (
      <FilmDeskPanel
        mode={active as FilmDeskMode}
        onRequestCreate={() => setActive('create')}
      />
    );
  }

  return (
    <LensShell lensId="film-studios" asMain={false}>
      <FirstRunTour lensId="film-studios" />
      <DepthBadge lensId="film-studios" size="sm" className="ml-2" />
      <div data-lens-theme="film-studios" className={ds.pageContainer}>
        <header className={ds.sectionHeader}>
          <div className="flex items-center gap-3 min-w-0">
            <div className="p-2 rounded-lg border border-purple-500/40 bg-gradient-to-br from-purple-500/30 to-pink-500/30">
              <Film className="w-6 h-6 text-neon-purple" />
            </div>
            <div className="min-w-0">
              <div className="flex items-center gap-2 flex-wrap">
                <h1 className={ds.heading1}>Film Studios</h1>
                <LiveIndicator isLive={isLive} lastUpdated={lastUpdated} compact />
                <DTUExportButton domain="film-studios" data={realtimeData || {}} compact />
                {realtimeAlerts.length > 0 && (
                  <span className="text-xs px-2 py-0.5 rounded bg-yellow-500/10 text-yellow-400">
                    {realtimeAlerts.length} alert{realtimeAlerts.length !== 1 ? 's' : ''}
                  </span>
                )}
              </div>
              <p className={ds.textMuted}>
                StudioBinder production + Letterboxd desk — one film studio.
              </p>
            </div>
          </div>
        </header>

        <RealtimeDataPanel data={realtimeData} insights={realtimeInsights} />

        <nav
          className="flex items-center gap-1 border-b border-lattice-border overflow-x-auto"
          aria-label="Film Studios views"
        >
          {VIEWS.map((v) => {
            const Icon = v.icon;
            const on = active === v.id;
            return (
              <button
                key={v.id}
                type="button"
                onClick={() => setActive(v.id)}
                className={cn(
                  'flex items-center gap-2 px-3 py-2.5 text-sm font-medium border-b-2 whitespace-nowrap transition-colors',
                  on
                    ? 'border-neon-purple text-neon-purple'
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

        <AnimatePresence mode="wait">
          <motion.div key={active} {...motionProps} className="pt-4">
            {body}
          </motion.div>
        </AnimatePresence>

        <CrossLensRecentsPanel lensId="film-studios" sinceDays={7} limit={6} hideWhenEmpty className="mt-3" />
      </div>
    </LensShell>
  );
}
