'use client';

/**
 * Film Studios — one StudioBinder + Letterboxd desk.
 *
 * Single view union. FilmStudioSection (always-on stack) and FilmStackFeed
 * accordion folded into active. Desk tabs extracted to FilmDeskPanel.
 */

import { useCallback, useState, type ReactNode } from 'react';
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
import { useAuth } from '@/hooks/useAuth';
import { titleCaseDisplayName } from '@/components/chat/claudeCleanGreeting';
import { LiveIndicator } from '@/components/lens/LiveIndicator';
import { DTUExportButton } from '@/components/lens/DTUExportButton';
import { RealtimeDataPanel } from '@/components/lens/RealtimeDataPanel';
import { cn } from '@/lib/utils';
import { FilmStudioSection } from '@/components/film-studios/FilmStudioSection';
import { FilmStackFeed } from '@/components/film-studios/FilmStackFeed';
import { FilmDeskPanel, type FilmDeskMode } from '@/components/film-studios/FilmDeskPanel';

type FilmView = 'production' | FilmDeskMode | 'qa';

const VIEWS: { id: FilmView; label: string; keys: string; title: string; hint: string; icon: typeof Film }[] = [
  { id: 'production', title: 'The production', label: 'Production', keys: 'p', hint: 'StudioBinder suite', icon: Clapperboard },
  { id: 'discover', title: 'The screening room', label: 'Discover', keys: 'd', hint: 'Browse films', icon: Globe },
  { id: 'my-films', title: 'Your films', label: 'My Films', keys: 'f', hint: 'Your projects', icon: Film },
  { id: 'create', title: 'The pitch', label: 'Create', keys: 'c', hint: 'New film', icon: Plus },
  { id: 'watch-parties', title: 'The watch party', label: 'Watch Parties', keys: 'w', hint: 'Sync watch', icon: Monitor },
  { id: 'analytics', title: 'The numbers', label: 'Analytics', keys: 'a', hint: 'Pipeline stats', icon: BarChart3 },
  { id: 'qa', title: 'The craft', label: 'Q&A', keys: 'q', hint: 'Filmmaking reference', icon: MessageSquare },
];

const DESK = new Set<FilmView>(['discover', 'my-films', 'create', 'watch-parties', 'analytics']);

export default function FilmStudiosPage() {
  useLensNav('film-studios');
  const { latestData: realtimeData, alerts: realtimeAlerts, insights: realtimeInsights, isLive, lastUpdated } = useRealtimeLens('film-studios');
  const { user } = useAuth();
  const who = titleCaseDisplayName(user?.username);
  const [active, setActive] = useState<FilmView>('production');

  const newProduction = useCallback(() => {
    setActive('production');
    let tries = 0;
    const focus = () => {
      const el = document.querySelector<HTMLInputElement>('[data-lens-theme="film-studios"] input[placeholder="New project title"]');
      if (el) { el.scrollIntoView({ behavior: 'smooth', block: 'center' }); el.focus(); return; }
      if (++tries < 20) requestAnimationFrame(focus);
    };
    requestAnimationFrame(focus);
  }, []);

  useLensCommand(
    [
      ...VIEWS.map((v) => ({
        id: `view-${v.id}`,
        keys: v.keys,
        description: `${v.label} — ${v.hint}`,
        category: 'navigation' as const,
        action: () => setActive(v.id),
      })),
      { id: 'new-production', keys: 'n', description: 'New production', category: 'actions' as const, action: newProduction },
    ],
    { lensId: 'film-studios' },
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

  const current = VIEWS.find((v) => v.id === active)!;

  return (
    <LensShell lensId="film-studios" asMain={false}>
      <FirstRunTour lensId="film-studios" />
      <DepthBadge lensId="film-studios" size="sm" className="ml-2" />
      <div data-lens-theme="film-studios" className="relative min-h-full px-8 pb-28 pt-6">
        <div className="flex items-start justify-between gap-4">
          <div className="min-w-0">
            <p className="text-[14px] text-zinc-500">Film Studios</p>
            <h1 className="mb-5 mt-1 font-vault text-[2.25rem] leading-tight text-zinc-100 sm:text-5xl">
              {current.title}{active === 'production' && who ? `, ${who}` : ''}
            </h1>
          </div>
          <div className="flex shrink-0 items-center gap-3 pt-2">
            {realtimeAlerts.length > 0 && (
              <span className="rounded-full bg-yellow-500/10 px-2.5 py-0.5 text-xs text-yellow-400">
                {realtimeAlerts.length} alert{realtimeAlerts.length !== 1 ? 's' : ''}
              </span>
            )}
            <LiveIndicator isLive={isLive} lastUpdated={lastUpdated} compact />
            <DTUExportButton domain="film-studios" data={realtimeData || {}} compact />
          </div>
        </div>

        <nav className="mb-6 inline-flex max-w-full items-center gap-1 overflow-x-auto rounded-full border border-white/10 bg-white/[0.03] p-1" aria-label="Film Studios views">
          {VIEWS.map((v) => {
            const Icon = v.icon;
            const on = active === v.id;
            return (
              <button
                key={v.id}
                type="button"
                onClick={() => setActive(v.id)}
                aria-current={on ? 'page' : undefined}
                title={`${v.hint} (${v.keys})`}
                className={cn(
                  'inline-flex items-center gap-2 whitespace-nowrap rounded-full px-4 py-1.5 text-[14px] transition-colors',
                  on ? 'bg-white/10 text-zinc-50' : 'text-zinc-500 hover:text-zinc-200',
                )}
              >
                <Icon className="h-3.5 w-3.5" />
                {v.label}
                <kbd className="hidden rounded border border-white/10 bg-white/5 px-1 py-0.5 font-mono text-[10px] text-white/30 sm:inline-block">{v.keys}</kbd>
              </button>
            );
          })}
        </nav>

        <div className="mb-5">
          <RealtimeDataPanel data={realtimeData} insights={realtimeInsights} compact />
        </div>

        {body}

        <CrossLensRecentsPanel lensId="film-studios" sinceDays={7} limit={6} hideWhenEmpty className="mt-8" />

        <button
          type="button"
          onClick={newProduction}
          title="New production (N)"
          className="fixed bottom-8 right-8 z-30 inline-flex items-center gap-2 rounded-full bg-teal-400 px-6 py-3.5 text-[15px] font-medium text-black shadow-[0_8px_32px_rgba(45,212,191,0.25)] transition-colors hover:bg-teal-300"
        >
          <Plus className="h-4 w-4" />
          New production
        </button>
      </div>
    </LensShell>
  );
}
