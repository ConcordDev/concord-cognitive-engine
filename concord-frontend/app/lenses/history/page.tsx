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
import { Layers, BookOpen, Wand2, Users, Search } from 'lucide-react';
import { LensShell } from '@/components/lens/LensShell';
import { FirstRunTour } from '@/components/lens/FirstRunTour';
import { DepthBadge } from '@/components/lens/DepthBadge';
import { DensityToggle } from '@/components/ui';
import { useAuth } from '@/hooks/useAuth';
import { titleCaseDisplayName } from '@/components/chat/claudeCleanGreeting';
import { CrossLensRecentsPanel } from '@/components/lens/CrossLensRecentsPanel';
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

const GROUPS: { id: GroupId; label: string; hotkey: string; title: string; icon: typeof Layers; description: string }[] = [
  { id: 'timelines', title: 'The record', label: 'Timelines', hotkey: '1', icon: Layers, description: 'Build, visualize, map, compare and publish dated timelines' },
  { id: 'wikipedia', title: 'What the sources say', label: 'Wikipedia Research', hotkey: '2', icon: BookOpen, description: 'Search articles, browse On This Day, cite sources' },
  { id: 'tools', title: 'How to read it', label: 'Analysis Tools', hotkey: '3', icon: Wand2, description: 'Ad-hoc timeline/source/period/causation analyzers' },
  { id: 'notebook', title: 'The people in it', label: 'Figures Notebook', hotkey: '4', icon: Users, description: 'Personal notes on historical figures' },
];

export default function HistoryLensPage() {
  useLensNav('history');

  const { user } = useAuth();
  const who = titleCaseDisplayName(user?.username);
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

  const openRecord = useCallback(() => {
    switchGroup('wikipedia');
    let tries = 0;
    const focus = () => {
      const el = document.querySelector<HTMLInputElement>('[data-lens-theme="history"] [role="tabpanel"] input');
      if (el) el.focus();
      else if (tries++ < 20) requestAnimationFrame(focus);
    };
    requestAnimationFrame(focus);
  }, [switchGroup]);

  useLensCommand(
    [
      ...GROUPS.map((g) => ({
        id: `group-${g.id}`,
        keys: g.hotkey,
        description: g.label,
        category: 'navigation' as const,
        action: () => switchGroup(g.id),
      })),
      { id: 'open-record', keys: 'o', description: 'Open a record (search Wikipedia)', category: 'actions' as const, action: openRecord },
    ],
    { lensId: 'history' },
  );

  const current = GROUPS.find((g) => g.id === group)!;

  return (
    <LensShell lensId="history" asMain={false}>
      <FirstRunTour lensId="history" />
      <DepthBadge lensId="history" size="sm" className="ml-2" />
      <div data-lens-theme="history" className="relative min-h-full px-8 pb-28 pt-6">
        <div className="flex items-start justify-between gap-4">
          <div className="min-w-0">
            <p className="text-[14px] text-zinc-500">History</p>
            <h1 className="mb-5 mt-1 font-vault text-[2.25rem] leading-tight text-zinc-100 sm:text-5xl">
              {current.title}{group === 'timelines' && who ? `, ${who}` : ''}
            </h1>
          </div>
          <div className="flex shrink-0 items-center gap-3 pt-2">
            <DensityToggle variant="dropdown" />
          </div>
        </div>

        <div className="mb-5">
          <HistoryDashboardStrip refreshToken={dashboardRefreshToken} />
        </div>

        <nav className="mb-6 inline-flex max-w-full items-center gap-1 overflow-x-auto rounded-full border border-white/10 bg-white/[0.03] p-1" aria-label="History workspace sections">
          {GROUPS.map((g) => {
            const on = group === g.id;
            return (
              <button
                key={g.id}
                type="button"
                onClick={() => switchGroup(g.id)}
                aria-current={on ? 'page' : undefined}
                title={g.description}
                className={cn(
                  'inline-flex items-center gap-2 whitespace-nowrap rounded-full px-4 py-1.5 text-[14px] transition-colors',
                  on ? 'bg-white/10 text-zinc-50' : 'text-zinc-500 hover:text-zinc-200',
                )}
              >
                <g.icon className="h-3.5 w-3.5" />
                {g.label}
                <kbd className="hidden rounded border border-white/10 bg-white/5 px-1 py-0.5 font-mono text-[10px] text-white/30 sm:inline-block">{g.hotkey}</kbd>
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
              <div className="rounded-2xl border border-white/10 bg-[#111] p-4">
                <WikipediaExplorer />
              </div>
              <LensFeedButton domain="history" label="Ingest today's On This Day events as DTUs" />
            </div>
          )}

          {group === 'tools' && (
            <div className="space-y-6">
              <section className="rounded-2xl border border-white/10 bg-[#111] p-4">
                <TimelineSourceTools />
              </section>
              <section className="rounded-2xl border border-white/10 bg-[#111] p-4">
                <PeriodCauseEffectTools />
              </section>
            </div>
          )}

          {group === 'notebook' && <FiguresNotebook />}
        </div>

        <CrossLensRecentsPanel lensId="history" sinceDays={7} limit={6} hideWhenEmpty className="mt-8" />

        <button
          type="button"
          onClick={openRecord}
          title="Open a record (O)"
          className="fixed bottom-8 right-8 z-30 inline-flex items-center gap-2 rounded-full bg-teal-400 px-6 py-3.5 text-[15px] font-medium text-black shadow-[0_8px_32px_rgba(45,212,191,0.25)] transition-colors hover:bg-teal-300"
        >
          <Search className="h-4 w-4" />
          Open a record
        </button>
      </div>
    </LensShell>
  );
}
