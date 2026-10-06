'use client';

import { useLensNav } from '@/hooks/useLensNav';
import { LensShell } from '@/components/lens/LensShell';
import { SessionRail } from '@/components/lens/SessionRail';
import { NorthStarFrame } from '@/components/lens/NorthStarFrame';
import { FirstRunTour } from '@/components/lens/FirstRunTour';
import { DepthBadge } from '@/components/lens/DepthBadge';
import { VoteFeed } from '@/components/vote/VoteFeed';
import { GovernanceWorkbench } from '@/components/vote/GovernanceWorkbench';
import { BallotAnalysisLab } from '@/components/vote/BallotAnalysisLab';
import { useLensCommand } from '@/hooks/useLensCommand';
import { lensRun } from '@/lib/api/client';

import { useQuery } from '@tanstack/react-query';
import { useMemo, useState } from 'react';
import {
  Users, Scale, TrendingUp, Percent, Plus,
} from 'lucide-react';
import { motion } from 'framer-motion';
import { useRealtimeLens } from '@/hooks/useRealtimeLens';
import { LiveIndicator } from '@/components/lens/LiveIndicator';
import { DTUExportButton } from '@/components/lens/DTUExportButton';
import { RealtimeDataPanel } from '@/components/lens/RealtimeDataPanel';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface PollSummary {
  id: string;
  status: 'open' | 'closed' | 'pending';
  method: string;
  ballotCount: number;
}

// ---------------------------------------------------------------------------
// Main Page
// ---------------------------------------------------------------------------

export default function VoteLensPage() {
  useLensNav('vote');
  const { latestData: realtimeData, insights: realtimeInsights } = useRealtimeLens('vote');

  const [activeTab, setActiveTab] = useState<'governance' | 'analysis'>('governance');

  useLensCommand(
    [
      { id: 'tab-governance', keys: 'g', description: 'Governance Workbench', category: 'navigation', action: () => setActiveTab('governance') },
      { id: 'tab-analysis', keys: 'a', description: 'Ballot Analysis Lab', category: 'navigation', action: () => setActiveTab('analysis') },
    ],
    { lensId: 'vote' }
  );

  // Real poll stats for the header row — same `poll-list` macro GovernanceWorkbench
  // uses internally, sourced independently here so the header doesn't depend on
  // the workbench's mount lifecycle.
  const pollsQuery = useQuery({
    queryKey: ['vote-lens', 'poll-list-summary'],
    queryFn: async () => {
      const { data } = await lensRun<{ polls: PollSummary[] }>('vote', 'poll-list', {});
      return data.ok && data.result ? data.result.polls : [];
    },
    staleTime: 15000,
  });

  const stats = useMemo(() => {
    const polls = pollsQuery.data || [];
    const total = polls.length;
    const active = polls.filter((p) => p.status === 'open').length;
    const closed = polls.filter((p) => p.status === 'closed').length;
    const totalBallots = polls.reduce((s, p) => s + (p.ballotCount || 0), 0);
    const avgBallots = total > 0 ? Math.round(totalBallots / total) : 0;
    return { total, active, closed, totalBallots, avgBallots };
  }, [pollsQuery.data]);

  return (
    <LensShell lensId="vote" asMain={false}>
      <FirstRunTour lensId="vote" />
      <DepthBadge lensId="vote" size="sm" className="ml-2" />
      <NorthStarFrame
        lensId="vote"
        crumb="Governance"
        title="Decide together"
        subtitle="Plurality, ranked-choice, approval, score and quadratic voting, with liquid democracy, verifiable receipts and Polis-style opinion clustering."
        actions={
          <>
            <LiveIndicator isLive={false} lastUpdated={null} compact />
            <DTUExportButton domain="vote" data={realtimeData || {}} compact />
          </>
        }
        tabs={[
          { id: 'governance', label: 'Governance Workbench', keys: 'g' },
          { id: 'analysis', label: 'Ballot Analysis Lab', keys: 'a' },
        ]}
        activeTab={activeTab}
        onTab={(id) => setActiveTab(id as 'governance' | 'analysis')}
        tabsLabel="Governance views"
        cta={{ label: 'Start a poll', icon: Plus, onClick: () => setActiveTab('governance') }}
      >
      {/* Quick Stats Row — real poll-list data, not fabricated */}
      <div className="mb-5 grid grid-cols-2 gap-3 md:grid-cols-4">
        <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0 * 0.05 }} className="flex items-center gap-3 rounded-2xl border border-white/10 bg-[#111] p-3">
          <Scale className="w-5 h-5 text-neon-purple" />
          <div>
            <p className="text-lg font-bold">{stats.active}</p>
            <p className="text-xs text-gray-400">Active Polls</p>
          </div>
        </motion.div>
        <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 1 * 0.05 }} className="flex items-center gap-3 rounded-2xl border border-white/10 bg-[#111] p-3">
          <TrendingUp className="w-5 h-5 text-neon-cyan" />
          <div>
            <p className="text-lg font-bold">{stats.totalBallots}</p>
            <p className="text-xs text-gray-400">Ballots Cast</p>
          </div>
        </motion.div>
        <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 2 * 0.05 }} className="flex items-center gap-3 rounded-2xl border border-white/10 bg-[#111] p-3">
          <Percent className="w-5 h-5 text-neon-green" />
          <div>
            <p className="text-lg font-bold">{stats.closed}</p>
            <p className="text-xs text-gray-400">Resolved Polls</p>
          </div>
        </motion.div>
        <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 3 * 0.05 }} className="flex items-center gap-3 rounded-2xl border border-white/10 bg-[#111] p-3">
          <Users className="w-5 h-5 text-neon-blue" />
          <div>
            <p className="text-lg font-bold">{stats.avgBallots}</p>
            <p className="text-xs text-gray-400">Avg Ballots / Poll</p>
          </div>
        </motion.div>
      </div>

      {/* ============ GOVERNANCE WORKBENCH TAB ============ */}
      {activeTab === 'governance' && (
        <section className="rounded-2xl border border-white/10 bg-[#111] p-4">
          <GovernanceWorkbench />
        </section>
      )}

      {/* ============ BALLOT ANALYSIS LAB TAB ============ */}
      {activeTab === 'analysis' && (
        <section className="rounded-2xl border border-white/10 bg-[#111] p-4">
          <BallotAnalysisLab />
        </section>
      )}

      <RealtimeDataPanel data={realtimeInsights} />

      <section className="mt-6 rounded-2xl border border-white/10 bg-[#111] p-4">
        <VoteFeed />
      </section>
      <SessionRail lensId="vote" hideWhenEmpty className="mt-4" />
      </NorthStarFrame>
    </LensShell>
  );
}
