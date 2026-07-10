'use client';

/**
 * Mentorship Lens — ADPList-shape mentor marketplace + MentorcliQ-shape
 * program admin, rebuilt as a real app (Frontend Rebuild Program, Wave 2).
 *
 * Capability map: docs/lens-specs/mentorship-capability-map.md. Every panel
 * below calls a real `mentorship` domain macro (server/domains/mentorship.js)
 * — no seeded/mock data, no client-computed "match score" heuristics. The
 * previous page kept a legacy DTU-artifact CRUD tab that faked a "Match: X%"
 * badge from an arbitrary local point score (status/sessions/rating/goals
 * weights invented in the frontend); that surface is retired here because
 * the platform has a REAL `mentorship.matchScore` macro (Jaccard-style skill
 * overlap + availability + experience) surfaced honestly in the Coaching
 * Tools tab instead of faked in a list card.
 *
 * Generic scaffold retired: `ManifestActionBar`, `AutoActionStrip`,
 * `RecentMineCard`, `CrossLensRecentsPanel`, `UniversalActions`,
 * `LensFeaturePanel` — replaced with a designed, keyboard-navigable
 * workspace (mirrors the Finance/News flagship pattern).
 */

import { useCallback, useEffect, useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import {
  BadgeCheck, Users, Inbox, Calendar, Target, MessageSquare, Wrench,
  BarChart3, MessagesSquare, RefreshCw, Keyboard,
} from 'lucide-react';
import { LensShell } from '@/components/lens/LensShell';
import { FirstRunTour } from '@/components/lens/FirstRunTour';
import { DepthBadge } from '@/components/lens/DepthBadge';
import { LiveIndicator } from '@/components/lens/LiveIndicator';
import { DTUExportButton } from '@/components/lens/DTUExportButton';
import { RealtimeDataPanel } from '@/components/lens/RealtimeDataPanel';
import { MentorDirectoryPanel } from '@/components/mentorship/MentorDirectoryPanel';
import { MentorshipRequestsPanel } from '@/components/mentorship/MentorshipRequestsPanel';
import { MentorshipSessionsPanel } from '@/components/mentorship/MentorshipSessionsPanel';
import { MentorshipGoalsPanel } from '@/components/mentorship/MentorshipGoalsPanel';
import { MentorshipMessagesPanel } from '@/components/mentorship/MentorshipMessagesPanel';
import { MentorshipProgramPanel } from '@/components/mentorship/MentorshipProgramPanel';
import { MentorshipActionPanel } from '@/components/mentorship/MentorshipActionPanel';
import { MentorshipFeed } from '@/components/mentorship/MentorshipFeed';
import { PipingProvider } from '@/components/panel-polish';
import { StatTile, StatTileGrid, Skeleton, ErrorState, DensityToggle } from '@/components/ui';
import { useLensNav } from '@/hooks/useLensNav';
import { useLensCommand } from '@/hooks/useLensCommand';
import { useRealtimeLens } from '@/hooks/useRealtimeLens';
import { useMacroDispatchFeedback } from '@/hooks/useMacroDispatchFeedback';
import { cn } from '@/lib/utils';

interface ProgramReport {
  mentors: number;
  activeMatches: number;
  matchAcceptanceRate: number;
  sessions: { total: number; completed: number };
  sessionCompletionRate: number;
  goals: { total: number; done: number };
  goalCompletionRate: number;
  avgSessionRating: number;
  avgMentorRating: number;
}

type TabId = 'directory' | 'requests' | 'sessions' | 'goals' | 'messages' | 'tools' | 'program' | 'community';

const TABS: { id: TabId; label: string; icon: typeof Users; hotkey: string }[] = [
  { id: 'directory', label: 'Directory', icon: Users, hotkey: '1' },
  { id: 'requests', label: 'Requests', icon: Inbox, hotkey: '2' },
  { id: 'sessions', label: 'Sessions', icon: Calendar, hotkey: '3' },
  { id: 'goals', label: 'Goals', icon: Target, hotkey: '4' },
  { id: 'messages', label: 'Messages', icon: MessageSquare, hotkey: '5' },
  { id: 'tools', label: 'Coaching Tools', icon: Wrench, hotkey: '6' },
  { id: 'program', label: 'Program', icon: BarChart3, hotkey: '7' },
  { id: 'community', label: 'Community', icon: MessagesSquare, hotkey: '8' },
];

export default function MentorshipLensPage() {
  useLensNav('mentorship');
  const { isLive, lastUpdated, latestData, insights } = useRealtimeLens('mentorship');
  const [tab, setTab] = useState<TabId>('directory');

  const stats = useMacroDispatchFeedback<ProgramReport>();
  const loadStats = useCallback(() => { void stats.dispatch('mentorship', 'program-report', {}); }, [stats]);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => { loadStats(); }, []);

  useLensCommand(
    [
      ...TABS.map((t) => ({
        id: `tab-${t.id}`, keys: t.hotkey, description: t.label, category: 'navigation' as const,
        action: () => setTab(t.id),
      })),
      { id: 'refresh-stats', keys: 'r', description: 'Refresh program stats', category: 'actions', action: loadStats },
    ],
    { lensId: 'mentorship' }
  );

  const report = stats.status === 'done' ? stats.result : null;
  const statsLoading = stats.status === 'dispatched' || stats.status === 'running';

  return (
    <LensShell lensId="mentorship" asMain={false}>
      <FirstRunTour lensId="mentorship" />
      <div data-lens-theme="mentorship" className="p-6 space-y-5">
        {/* Command bar */}
        <header className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex items-center gap-3">
            <div className="w-9 h-9 rounded-lg bg-neon-blue/15 border border-neon-blue/30 flex items-center justify-center">
              <BadgeCheck className="w-5 h-5 text-neon-blue" />
            </div>
            <div>
              <h1 className="text-lg font-bold text-white">Mentorship</h1>
              <div className="flex items-center gap-2 text-xs text-gray-400">
                <span>Mentor marketplace, matching &amp; program tracking</span>
                <DepthBadge lensId="mentorship" size="sm" />
              </div>
            </div>
            <LiveIndicator isLive={isLive} lastUpdated={lastUpdated} compact />
          </div>
          <div className="flex items-center gap-2">
            <span className="hidden md:flex items-center gap-1 text-[10px] text-gray-500" title="1-8 switch tab · r refresh stats">
              <Keyboard className="w-3.5 h-3.5" /> 1-8 · r
            </span>
            <DensityToggle variant="dropdown" />
            <button
              type="button"
              onClick={loadStats}
              disabled={statsLoading}
              className="p-1.5 rounded border border-lattice-border text-gray-400 hover:text-white hover:bg-lattice-elevated transition-colors disabled:opacity-50"
              aria-label="Refresh program stats"
            >
              <RefreshCw className={cn('w-4 h-4', statsLoading && 'animate-spin')} />
            </button>
            <DTUExportButton domain="mentorship" data={report || {}} compact />
          </div>
        </header>

        {/* KPI strip — real program-report macro, via honest macro-dispatch feedback */}
        {statsLoading && !report ? (
          <StatTileGrid columns={5}>
            {Array.from({ length: 5 }).map((_, i) => (
              <div key={i} className="rounded-md border border-white/10 bg-black/40 p-3">
                <Skeleton variant="line" lines={2} />
              </div>
            ))}
          </StatTileGrid>
        ) : stats.status === 'error' ? (
          <ErrorState message={stats.error || 'Failed to load program stats.'} onRetry={loadStats} retrying={statsLoading} variant="inline" />
        ) : report ? (
          <StatTileGrid columns={5}>
            <StatTile label="Mentors listed" value={report.mentors} icon={<Users className="w-3.5 h-3.5" />} />
            <StatTile label="Active matches" value={report.activeMatches} caption={`${report.matchAcceptanceRate}% acceptance`} />
            <StatTile label="Sessions completed" value={report.sessions.completed} caption={`of ${report.sessions.total} · ${report.sessionCompletionRate}%`} />
            <StatTile label="Goals achieved" value={report.goals.done} caption={`of ${report.goals.total} · ${report.goalCompletionRate}%`} />
            <StatTile
              label="Avg mentor rating"
              value={report.avgMentorRating > 0 ? report.avgMentorRating : '--'}
              unit={report.avgMentorRating > 0 ? '★' : undefined}
              caption={report.avgSessionRating > 0 ? `${report.avgSessionRating}/5 session avg` : 'no ratings yet'}
            />
          </StatTileGrid>
        ) : null}

        {/* Tab bar */}
        <nav className="flex items-center gap-1 overflow-x-auto border-b border-lattice-border pb-2" aria-label="Mentorship views">
          {TABS.map((t) => {
            const active = tab === t.id;
            return (
              <button
                key={t.id}
                type="button"
                onClick={() => setTab(t.id)}
                aria-current={active ? 'page' : undefined}
                className={cn(
                  'flex items-center gap-1.5 px-3 py-1.5 rounded text-xs whitespace-nowrap border transition-colors',
                  active
                    ? 'bg-neon-blue/15 text-neon-blue border-neon-blue/30'
                    : 'text-gray-400 hover:text-white hover:bg-white/5 border-transparent'
                )}
              >
                <span className="text-[10px] text-gray-600 tabular-nums">{t.hotkey}</span>
                <t.icon className="w-3.5 h-3.5" />
                {t.label}
              </button>
            );
          })}
        </nav>

        {/* Tab content */}
        <AnimatePresence mode="wait">
          <motion.div
            key={tab}
            initial={{ opacity: 0, y: 6 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -6 }}
            transition={{ duration: 0.15 }}
          >
            {tab === 'directory' && <MentorDirectoryPanel />}
            {tab === 'requests' && <MentorshipRequestsPanel />}
            {tab === 'sessions' && <MentorshipSessionsPanel />}
            {tab === 'goals' && <MentorshipGoalsPanel />}
            {tab === 'messages' && <MentorshipMessagesPanel />}
            {tab === 'tools' && (
              <div className="space-y-3">
                <p className="text-xs text-gray-400">
                  Structured, JSON-input calculators wired directly to the mentorship engine — match scoring,
                  progress tracking, feedback synthesis, and a career development plan. Useful for one-off pair
                  analysis outside a tracked request/session; every result below is a real macro call
                  (<code className="text-gray-300">mentorship.matchScore</code>,{' '}
                  <code className="text-gray-300">progressTrack</code>, <code className="text-gray-300">feedbackSummary</code>,{' '}
                  <code className="text-gray-300">developmentPlan</code>), never a client-side estimate.
                </p>
                <PipingProvider>
                  <MentorshipActionPanel />
                </PipingProvider>
              </div>
            )}
            {tab === 'program' && <MentorshipProgramPanel />}
            {tab === 'community' && (
              <div className="rounded-xl border border-zinc-800 bg-zinc-950/40 p-4">
                <MentorshipFeed />
              </div>
            )}
          </motion.div>
        </AnimatePresence>

        {latestData && (
          <RealtimeDataPanel domain="mentorship" data={latestData} isLive={isLive} lastUpdated={lastUpdated} insights={insights} compact />
        )}
      </div>
    </LensShell>
  );
}
