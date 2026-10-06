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
 * The generic action-strip scaffold was retired in favor of a designed,
 * keyboard-navigable workspace (mirrors the Finance/News flagship pattern).
 */

import { useCallback, useEffect, useState } from 'react';
import {
  Users, Inbox, Calendar, Target, MessageSquare, Wrench,
  BarChart3, MessagesSquare, RefreshCw, Search,
} from 'lucide-react';
import { LensShell } from '@/components/lens/LensShell';
import { NorthStarFrame } from '@/components/lens/NorthStarFrame';
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
import { useAuth } from '@/hooks/useAuth';
import { titleCaseDisplayName } from '@/components/chat/claudeCleanGreeting';

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

const TABS: { id: TabId; label: string; icon: typeof Users; hotkey: string; title: string; hint: string }[] = [
  { id: 'directory', label: 'Directory', icon: Users, hotkey: '1', title: 'Find someone to learn from', hint: 'Mentor directory and matching' },
  { id: 'requests', label: 'Requests', icon: Inbox, hotkey: '2', title: 'Who is asking for you', hint: 'Mentorship requests in and out' },
  { id: 'sessions', label: 'Sessions', icon: Calendar, hotkey: '3', title: 'Time on the calendar', hint: 'Scheduled and completed sessions' },
  { id: 'goals', label: 'Goals', icon: Target, hotkey: '4', title: 'What you are working toward', hint: 'Mentorship goals and progress' },
  { id: 'messages', label: 'Messages', icon: MessageSquare, hotkey: '5', title: 'Keep the conversation going', hint: 'Mentor / mentee messages' },
  { id: 'tools', label: 'Coaching Tools', icon: Wrench, hotkey: '6', title: 'Run the numbers on a pairing', hint: 'Match scoring, progress, feedback and development plans' },
  { id: 'program', label: 'Program', icon: BarChart3, hotkey: '7', title: 'How the program is doing', hint: 'Program-level reporting' },
  { id: 'community', label: 'Community', icon: MessagesSquare, hotkey: '8', title: 'Mentors talking shop', hint: 'Mentorship community feed' },
];

export default function MentorshipLensPage() {
  useLensNav('mentorship');
  const { isLive, lastUpdated, latestData, insights } = useRealtimeLens('mentorship');
  const { user } = useAuth();
  const who = titleCaseDisplayName(user?.username);
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

  const current = TABS.find((t) => t.id === tab)!;

  return (
    <LensShell lensId="mentorship" asMain={false}>
      <FirstRunTour lensId="mentorship" />
      <DepthBadge lensId="mentorship" size="sm" className="ml-2" />
      <NorthStarFrame
        lensId="mentorship"
        crumb="Mentorship"
        title={`${current.title}${tab === 'directory' && who ? `, ${who}` : ''}`}
        subtitle="Mentor marketplace, matching and program tracking. Every number and score comes from the mentorship engine."
        actions={
          <div className="flex items-center gap-2">
            <LiveIndicator isLive={isLive} lastUpdated={lastUpdated} compact />
            <DensityToggle variant="dropdown" />
            <button
              type="button"
              onClick={loadStats}
              disabled={statsLoading}
              className="rounded-full border border-white/10 p-2 text-zinc-400 transition-colors hover:text-white disabled:opacity-50"
              aria-label="Refresh program stats"
              title="Refresh program stats (R)"
            >
              <RefreshCw className={cn('h-4 w-4', statsLoading && 'animate-spin')} />
            </button>
            <DTUExportButton domain="mentorship" data={report || {}} compact />
          </div>
        }
        tabs={TABS.map((t) => ({ id: t.id, label: t.label, icon: t.icon, keys: t.hotkey, hint: t.hint }))}
        activeTab={tab}
        onTab={(id) => setTab(id as TabId)}
        tabsLabel="Mentorship views"
        cta={{ label: 'Find a mentor', icon: Search, onClick: () => setTab('directory'), title: 'Open the mentor directory' }}
      >
      <div className="space-y-5">
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

        {/* Tab content */}
        <div>
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
              <div className="rounded-2xl border border-white/10 bg-[#111] p-4">
                <MentorshipFeed />
              </div>
            )}
        </div>

        {latestData && (
          <RealtimeDataPanel domain="mentorship" data={latestData} isLive={isLive} lastUpdated={lastUpdated} insights={insights} compact />
        )}
      </div>
      </NorthStarFrame>
    </LensShell>
  );
}
