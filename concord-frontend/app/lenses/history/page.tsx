'use client';

/**
 * ─────────────────────────────────────────────────────────────────────────
 * CONCORD // HISTORY RESEARCH WORKSPACE — Wave 2 rebuild (Frontend Rebuild
 * Program, docs/FRONTEND_REBUILD_PROGRAM.md)
 * ─────────────────────────────────────────────────────────────────────────
 * Research-tool identity (TimelineJS / Wikipedia parity target — see
 * docs/lens-specs/history-capability-map.md step-1.5 checklist): dense
 * information display, every fact carries real source attribution, and the
 * one-click pull → cite/save flow is a primary interaction, not a side
 * feature.
 *
 * Honest-by-construction — every surface traces to a real macro:
 *   • dashboard stat strip → history.history-dashboard (real; was
 *     completely UNSURFACED before this rebuild)
 *   • Timelines             → the real STATE-backed timeline substrate
 *     (timeline-create/list/detail/delete, event-*, era-*, map-points,
 *     timeline-render/compare/publish, timeline-from-wikipedia)
 *   • Wikipedia Research     → wiki-search / wiki-lookup / on-this-day
 *     (real Wikipedia REST + On-This-Day feeds, source-attributed, with a
 *     real cite/DM/study-guide/publish/connect action panel)
 *   • Analysis Tools         → timelineBuild + sourceEvaluate (existing)
 *     and comparePeriods + causeEffect (newly wired here — were
 *     UNSURFACED, zero frontend callers, confirmed by grep)
 *   • Notebook               → an honestly-scoped personal Figures list
 *     (the history domain has no figure-analysis macro; explicitly
 *     labeled as private notes, not a designed backend feature)
 *
 * RESOLVED the Group A / Group B conflict described in the rebuild brief:
 * the old page's Events/Periods/Figures/Sources tabs were a GENERIC,
 * domain-agnostic artifact notebook with zero connection to any of the 25
 * real history macros, presented as the page's primary identity, while the
 * real TimelineJS-shape substrate was bolted on at the bottom. Timelines is
 * now the flagship surface; Events/Periods/Sources were retired because
 * each has a strictly better real home (Timeline events, the new
 * comparePeriods tool, the existing sourceEvaluate tool); Figures survives
 * as an honestly-labeled notebook because no macro exists for it. Full
 * writeup + per-macro disposition table: docs/lens-specs/history-capability-map.md
 *
 * RETIRED the entire generated-scaffold surface: the generic action-bar +
 * auto-action-strip + recent-mine-card trio, the cross-lens recents panel,
 * the universal-actions strip, and the generic lens-feature panel body.
 * Also dropped the dead `useRealtimeLens('history')` panel/DTU-export/live
 * indicator — history has no registered realtime socket channel
 * (`DOMAIN_EVENTS` in useRealtimeLens.ts has no `history` entry and the
 * server never emits `history:update`), so `isLive` was permanently false
 * and `realtimeData` permanently null: a dead panel reading from a source
 * that can never populate, the same anti-pattern this program's rubric
 * calls out explicitly.
 * ─────────────────────────────────────────────────────────────────────────
 */

import { useState, useCallback } from 'react';
import { Clock, Layers, BookOpen, Wand2, Users } from 'lucide-react';
import { LensShell } from '@/components/lens/LensShell';
import { FirstRunTour } from '@/components/lens/FirstRunTour';
import { DepthBadge } from '@/components/lens/DepthBadge';
import { DensityToggle } from '@/components/ui';
import { useLensNav } from '@/hooks/useLensNav';
import { useLensCommand } from '@/hooks/useLensCommand';
import { cn } from '@/lib/utils';

import { HistoryDashboardStrip } from '@/components/history/HistoryDashboardStrip';
import { TimelineBuilder } from '@/components/history/TimelineBuilder';
import { WikipediaExplorer } from '@/components/history/WikipediaExplorer';
import { TimelineSourceTools } from '@/components/history/TimelineSourceTools';
import { PeriodCauseEffectTools } from '@/components/history/PeriodCauseEffectTools';
import { FiguresNotebook } from '@/components/history/FiguresNotebook';
import { LensFeedButton } from '@/components/lens/LensFeedButton';

type GroupId = 'timelines' | 'wikipedia' | 'tools' | 'notebook';

const GROUPS: { id: GroupId; label: string; hotkey: string; icon: typeof Layers; description: string }[] = [
  { id: 'timelines', label: 'Timelines', hotkey: '1', icon: Layers, description: 'Build, visualize, map, compare and publish dated timelines' },
  { id: 'wikipedia', label: 'Wikipedia Research', hotkey: '2', icon: BookOpen, description: 'Search articles, browse On This Day, cite sources' },
  { id: 'tools', label: 'Analysis Tools', hotkey: '3', icon: Wand2, description: 'Ad-hoc timeline/source/period/causation analyzers' },
  { id: 'notebook', label: 'Figures Notebook', hotkey: '4', icon: Users, description: 'Personal notes on historical figures' },
];

export default function HistoryLensPage() {
  useLensNav('history');

  const [group, setGroup] = useState<GroupId>('timelines');
  const [dashboardRefreshToken, setDashboardRefreshToken] = useState(0);

  const switchGroup = useCallback((next: GroupId) => {
    setGroup((prev) => {
      // Real refresh signal, not a timer: whenever the user leaves the
      // Timelines workspace (the only surface that mutates the counts the
      // dashboard strip shows), refetch the real history-dashboard macro.
      if (prev === 'timelines' && next !== 'timelines') {
        setDashboardRefreshToken((t) => t + 1);
      }
      return next;
    });
  }, []);

  useLensCommand(
    GROUPS.map((g) => ({
      id: `group-${g.id}`,
      keys: g.hotkey,
      description: g.label,
      category: 'navigation' as const,
      action: () => switchGroup(g.id),
    })),
    { lensId: 'history' },
  );

  return (
    <LensShell lensId="history" asMain={false}>
      <FirstRunTour lensId="history" />
      <div data-lens-theme="history" className="p-6 space-y-5">
        {/* Header */}
        <header className="space-y-3">
          <div className="flex items-center gap-3 flex-wrap">
            <Clock className="w-6 h-6 text-neon-cyan" />
            <div className="min-w-0">
              <h1 className="text-xl font-bold text-white flex items-center gap-2">
                History
                <DepthBadge lensId="history" size="sm" />
              </h1>
              <p className="text-sm text-gray-400">
                A Wikipedia-grounded, user-authored timeline research tool — TimelineJS-shape substrate,
                real On This Day + article search, source-reliability scoring.
              </p>
            </div>
            <div className="ml-auto flex items-center gap-2">
              <DensityToggle variant="dropdown" />
            </div>
          </div>
          <HistoryDashboardStrip refreshToken={dashboardRefreshToken} />
        </header>

        {/* Workspace nav */}
        <nav className="flex gap-1 flex-wrap border-b border-lattice-border pb-0" aria-label="History workspace sections">
          {GROUPS.map((g) => {
            const active = group === g.id;
            return (
              <button
                key={g.id}
                type="button"
                onClick={() => switchGroup(g.id)}
                title={g.description}
                className={cn(
                  'flex items-center gap-1.5 px-3 py-2 text-sm rounded-t-lg border-b-2 -mb-px transition-colors',
                  active
                    ? 'border-neon-cyan text-neon-cyan bg-neon-cyan/5'
                    : 'border-transparent text-gray-400 hover:text-white hover:bg-lattice-surface/50',
                )}
              >
                <g.icon className="w-4 h-4" />
                {g.label}
                <kbd className="ml-1 hidden sm:inline text-[9px] px-1 py-0.5 rounded bg-black/30 text-gray-500 font-mono">{g.hotkey}</kbd>
              </button>
            );
          })}
        </nav>

        {/* Workspace body */}
        <div role="tabpanel" aria-label={GROUPS.find((g) => g.id === group)?.label}>
          {group === 'timelines' && (
            <div className="space-y-4">
              <p className="text-xs text-gray-400">{GROUPS[0].description}. Auto-build a full timeline from any Wikipedia article via the Import tab, or start from scratch.</p>
              <TimelineBuilder />
            </div>
          )}

          {group === 'wikipedia' && (
            <div className="space-y-4">
              <div className="rounded-xl border border-zinc-800 bg-zinc-950/40 p-4">
                <WikipediaExplorer />
              </div>
              <LensFeedButton domain="history" label="Ingest today's On This Day events as DTUs" />
            </div>
          )}

          {group === 'tools' && (
            <div className="space-y-6">
              <section className="rounded-xl border border-zinc-800 bg-zinc-950/40 p-4">
                <TimelineSourceTools />
              </section>
              <section className="rounded-xl border border-zinc-800 bg-zinc-950/40 p-4">
                <PeriodCauseEffectTools />
              </section>
            </div>
          )}

          {group === 'notebook' && <FiguresNotebook />}
        </div>
      </div>
    </LensShell>
  );
}
