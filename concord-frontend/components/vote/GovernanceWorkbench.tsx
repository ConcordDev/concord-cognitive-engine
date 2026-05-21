'use client';

/* eslint-disable @typescript-eslint/no-explicit-any */

/**
 * GovernanceWorkbench — Polis / Decidim / Snapshot parity surface for the
 * vote lens. Every value rendered here comes from a real `vote` domain macro:
 *   poll-create / poll-list / poll-close / cast-ballot / poll-results
 *   delegate-vote / revoke-delegation / delegation-list
 *   opinion-cluster / audit-trail / verify-receipt
 *
 * No mock or seed data — an empty substrate renders empty states.
 */

import { useCallback, useEffect, useMemo, useState } from 'react';
import { lensRun } from '@/lib/api/client';
import { ChartKit } from '@/components/viz';
import {
  Plus, X, Vote, ListChecks, Users, ShieldCheck, Network, Layers,
  Clock, CheckCircle2, XCircle, AlertCircle, Lock, RefreshCw, Trash2,
  Hash, BarChart3, GitBranch,
} from 'lucide-react';

// ---------------------------------------------------------------------------
// Types — mirror the macro result shapes
// ---------------------------------------------------------------------------

type VoteMethod = 'plurality' | 'ranked' | 'approval' | 'score' | 'quadratic';

interface Poll {
  id: string;
  title: string;
  description: string | null;
  method: VoteMethod;
  options: string[];
  owner: string;
  ownerLabel: string;
  createdAt: string;
  deadline: string | null;
  closedAt: string | null;
  quorum: number;
  passThreshold: number | null;
  eligibility: 'all' | 'list';
  eligibleVoters: string[];
  weighting: 'equal' | 'custom';
  scoreMax: number;
  creditBudget: number;
  status: 'open' | 'closed' | 'pending';
  ballotCount: number;
}

interface TallyRow {
  option: string;
  votes?: number;
  share?: number;
  total?: number;
  avg?: number;
  effectiveVotes?: number;
}

interface PollResults {
  pollId: string;
  title: string;
  method: VoteMethod;
  status: string;
  tally: {
    method: string;
    ranking: TallyRow[];
    winner: string | null;
    rounds: Array<{ round: number; tally: TallyRow[]; exhausted: number }> | null;
  };
  resolution: {
    outcome: string;
    detail: string;
    quorumMet: boolean;
    quorum: number;
    totalBallots: number;
  };
  delegatedBallots: number;
  delegators: Array<{ from: string; to: string; weight: number }>;
  consensusSeries: Array<{ ballot: number; at: string; leadShare: number; leader: string | null }>;
  chartData: Array<{ option: string; votes: number }>;
}

interface Delegation { id: string; from: string; to: string; pollId: string; createdAt: string }
interface Receipt { id: string; pollId: string; ballotId: string; voter: string; castAt: string; hash: string; verified: boolean }
interface AuditResult { pollId: string; title: string; receiptCount: number; ballotCount: number; integrity: string; receipts: Receipt[] }

interface ClusterGroup {
  groupId: string;
  size: number;
  members: string[];
  signatureComments: Array<{ comment: string; stance: string; agree: number; disagree: number; pass: number }>;
}
interface ClusterResult {
  numVoters: number;
  numComments: number;
  numGroups: number;
  groups: ClusterGroup[];
  consensusComments: string[];
  divisiveComments: string[];
  polarization: number;
}

const METHOD_LABEL: Record<VoteMethod, string> = {
  plurality: 'Plurality (single choice)',
  ranked: 'Ranked-choice (IRV)',
  approval: 'Approval voting',
  score: 'Score voting',
  quadratic: 'Quadratic voting',
};

const STATUS_TONE: Record<string, string> = {
  open: 'bg-emerald-500/15 text-emerald-300 border-emerald-500/30',
  closed: 'bg-zinc-500/15 text-zinc-300 border-zinc-500/30',
  pending: 'bg-amber-500/15 text-amber-300 border-amber-500/30',
};

function fmtDate(d?: string | null): string {
  if (!d) return '—';
  const t = Date.parse(d);
  if (!Number.isFinite(t)) return '—';
  return new Date(t).toLocaleString(undefined, { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' });
}

// ---------------------------------------------------------------------------
// Main component
// ---------------------------------------------------------------------------

export function GovernanceWorkbench() {
  const [polls, setPolls] = useState<Poll[]>([]);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState<string | null>(null);
  const [showCreate, setShowCreate] = useState(false);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [view, setView] = useState<'polls' | 'cluster'>('polls');

  const loadPolls = useCallback(async () => {
    setErr(null);
    const { data } = await lensRun<{ polls: Poll[] }>('vote', 'poll-list', {});
    if (data.ok && data.result) {
      setPolls(data.result.polls);
      setSelectedId((cur) => cur && data.result!.polls.some((p) => p.id === cur) ? cur : data.result!.polls[0]?.id ?? null);
    } else {
      setErr(data.error || 'Failed to load polls.');
    }
    setLoading(false);
  }, []);

  useEffect(() => {
    loadPolls();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const selected = useMemo(() => polls.find((p) => p.id === selectedId) ?? null, [polls, selectedId]);

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-neon-purple/20 pb-3">
        <div className="flex items-center gap-2">
          <Vote className="h-5 w-5 text-neon-purple" />
          <h2 className="text-sm font-semibold text-white">Governance Workbench</h2>
          <span className="rounded bg-zinc-800 px-1.5 py-0.5 font-mono text-[10px] uppercase tracking-wider text-zinc-400">
            Polis · Decidim · Snapshot parity
          </span>
        </div>
        <div className="flex items-center gap-2">
          <div className="flex rounded-lg border border-zinc-800 bg-zinc-950 p-0.5">
            {(['polls', 'cluster'] as const).map((v) => (
              <button
                key={v}
                onClick={() => setView(v)}
                className={`px-3 py-1 text-xs rounded-md transition-colors ${
                  view === v ? 'bg-neon-purple/20 text-neon-purple' : 'text-zinc-400 hover:text-white'
                }`}
              >
                {v === 'polls' ? 'Polls' : 'Opinion Clusters'}
              </button>
            ))}
          </div>
          <button onClick={loadPolls} className="rounded-lg border border-zinc-800 p-1.5 text-zinc-400 hover:text-white" aria-label="Refresh">
            <RefreshCw className="h-3.5 w-3.5" />
          </button>
          <button
            onClick={() => setShowCreate(true)}
            className="flex items-center gap-1.5 rounded-lg bg-neon-purple/20 px-3 py-1.5 text-xs font-medium text-neon-purple border border-neon-purple/30 hover:bg-neon-purple/30"
          >
            <Plus className="h-3.5 w-3.5" /> New Poll
          </button>
        </div>
      </div>

      {err && (
        <div className="flex items-center gap-2 rounded-lg border border-rose-500/30 bg-rose-500/5 px-3 py-2 text-xs text-rose-300">
          <AlertCircle className="h-4 w-4" /> {err}
        </div>
      )}

      {view === 'cluster' ? (
        <OpinionClusterPanel />
      ) : loading ? (
        <div className="py-12 text-center text-sm text-zinc-500">Loading governance polls…</div>
      ) : polls.length === 0 ? (
        <div className="rounded-xl border border-dashed border-zinc-800 py-12 text-center">
          <ListChecks className="mx-auto h-8 w-8 text-zinc-600" />
          <p className="mt-2 text-sm text-zinc-400">No governance polls yet.</p>
          <p className="text-xs text-zinc-600">Create one to start collective decision-making.</p>
        </div>
      ) : (
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
          {/* Poll list */}
          <div className="space-y-2 lg:col-span-1">
            {polls.map((p) => (
              <button
                key={p.id}
                onClick={() => setSelectedId(p.id)}
                className={`w-full rounded-lg border p-3 text-left transition-colors ${
                  selectedId === p.id
                    ? 'border-neon-purple/50 bg-neon-purple/10'
                    : 'border-zinc-800 bg-zinc-950/40 hover:border-zinc-700'
                }`}
              >
                <div className="flex items-start justify-between gap-2">
                  <span className="text-sm font-medium text-white line-clamp-2">{p.title}</span>
                  <span className={`shrink-0 rounded border px-1.5 py-0.5 text-[10px] uppercase ${STATUS_TONE[p.status]}`}>
                    {p.status}
                  </span>
                </div>
                <div className="mt-1.5 flex flex-wrap items-center gap-x-3 gap-y-1 text-[10px] text-zinc-500">
                  <span className="flex items-center gap-1"><Layers className="h-3 w-3" />{p.method}</span>
                  <span className="flex items-center gap-1"><Users className="h-3 w-3" />{p.ballotCount} ballots</span>
                  {p.quorum > 0 && <span className="flex items-center gap-1"><Hash className="h-3 w-3" />quorum {p.quorum}</span>}
                  {p.deadline && <span className="flex items-center gap-1"><Clock className="h-3 w-3" />{fmtDate(p.deadline)}</span>}
                </div>
              </button>
            ))}
          </div>

          {/* Detail */}
          <div className="lg:col-span-2">
            {selected ? (
              <PollDetail poll={selected} onChanged={loadPolls} />
            ) : (
              <div className="rounded-lg border border-dashed border-zinc-800 py-12 text-center text-sm text-zinc-500">
                Select a poll.
              </div>
            )}
          </div>
        </div>
      )}

      {showCreate && (
        <CreatePollModal
          onClose={() => setShowCreate(false)}
          onCreated={() => { setShowCreate(false); loadPolls(); }}
        />
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Poll detail — ballot casting + results + delegation + audit
// ---------------------------------------------------------------------------

function PollDetail({ poll, onChanged }: { poll: Poll; onChanged: () => void }) {
  const [tab, setTab] = useState<'vote' | 'results' | 'delegate' | 'audit'>('vote');

  return (
    <div className="rounded-xl border border-zinc-800 bg-zinc-950/40 p-4">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <h3 className="text-base font-semibold text-white">{poll.title}</h3>
          {poll.description && <p className="mt-1 text-xs text-zinc-400">{poll.description}</p>}
          <div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1 text-[11px] text-zinc-500">
            <span>{METHOD_LABEL[poll.method]}</span>
            <span>·</span>
            <span>by {poll.ownerLabel}</span>
            {poll.passThreshold != null && <><span>·</span><span>threshold {Math.round(poll.passThreshold * 100)}%</span></>}
            {poll.eligibility === 'list' && <><span>·</span><span className="text-amber-400">restricted ({poll.eligibleVoters.length} eligible)</span></>}
            {poll.weighting === 'custom' && <><span>·</span><span className="text-cyan-400">weighted voting</span></>}
          </div>
        </div>
        <span className={`shrink-0 rounded border px-2 py-0.5 text-[11px] uppercase ${STATUS_TONE[poll.status]}`}>{poll.status}</span>
      </div>

      <div className="mt-4 flex gap-1 border-b border-zinc-800">
        {([
          ['vote', 'Cast Ballot', Vote],
          ['results', 'Results', BarChart3],
          ['delegate', 'Delegation', Network],
          ['audit', 'Audit Trail', ShieldCheck],
        ] as const).map(([id, label, Icon]) => (
          <button
            key={id}
            onClick={() => setTab(id)}
            className={`flex items-center gap-1.5 px-3 py-2 text-xs font-medium border-b-2 transition-colors ${
              tab === id ? 'border-neon-purple text-neon-purple' : 'border-transparent text-zinc-400 hover:text-white'
            }`}
          >
            <Icon className="h-3.5 w-3.5" /> {label}
          </button>
        ))}
      </div>

      <div className="mt-4">
        {tab === 'vote' && <BallotPanel poll={poll} onCast={onChanged} />}
        {tab === 'results' && <ResultsPanel poll={poll} onClosed={onChanged} />}
        {tab === 'delegate' && <DelegationPanel poll={poll} />}
        {tab === 'audit' && <AuditPanel poll={poll} />}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Ballot panel — method-specific input → cast-ballot macro
// ---------------------------------------------------------------------------

function BallotPanel({ poll, onCast }: { poll: Poll; onCast: () => void }) {
  const [choice, setChoice] = useState('');
  const [ranking, setRanking] = useState<string[]>([]);
  const [approved, setApproved] = useState<Set<string>>(new Set());
  const [scores, setScores] = useState<Record<string, number>>({});
  const [credits, setCredits] = useState<Record<string, number>>({});
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);

  const creditsSpent = useMemo(
    () => Object.values(credits).reduce((s, c) => s + Math.abs(c || 0), 0),
    [credits],
  );

  if (poll.status !== 'open') {
    return (
      <div className="flex items-center gap-2 rounded-lg border border-zinc-800 bg-zinc-900/40 px-3 py-3 text-xs text-zinc-400">
        <Lock className="h-4 w-4" /> This poll is {poll.status}. Ballots are not being accepted.
      </div>
    );
  }

  const toggleRank = (opt: string) => {
    setRanking((cur) => cur.includes(opt) ? cur.filter((o) => o !== opt) : [...cur, opt]);
  };

  const submit = async () => {
    setBusy(true);
    setMsg(null);
    const input: Record<string, unknown> = { pollId: poll.id };
    if (poll.method === 'plurality') input.choice = choice;
    else if (poll.method === 'ranked') input.rankings = ranking;
    else if (poll.method === 'approval') input.approved = [...approved];
    else if (poll.method === 'score') input.scores = scores;
    else if (poll.method === 'quadratic') input.credits = credits;

    const { data } = await lensRun('vote', 'cast-ballot', input);
    if (data.ok) {
      const replaced = (data.result as any)?.replaced;
      setMsg({ ok: true, text: replaced ? 'Ballot updated.' : 'Ballot cast. Receipt issued.' });
      onCast();
    } else {
      setMsg({ ok: false, text: data.error || 'Failed to cast ballot.' });
    }
    setBusy(false);
  };

  return (
    <div className="space-y-3">
      {poll.method === 'plurality' && (
        <div className="space-y-1.5">
          {poll.options.map((o) => (
            <label key={o} className={`flex items-center gap-2 rounded-lg border px-3 py-2 text-sm cursor-pointer transition-colors ${
              choice === o ? 'border-neon-purple/50 bg-neon-purple/10 text-white' : 'border-zinc-800 text-zinc-300 hover:border-zinc-700'
            }`}>
              <input type="radio" name="plurality" checked={choice === o} onChange={() => setChoice(o)} className="accent-neon-purple" />
              {o}
            </label>
          ))}
        </div>
      )}

      {poll.method === 'ranked' && (
        <div className="space-y-2">
          <p className="text-xs text-zinc-500">Click options in your order of preference (first click = top choice).</p>
          <div className="space-y-1.5">
            {poll.options.map((o) => {
              const rank = ranking.indexOf(o);
              return (
                <button
                  key={o}
                  onClick={() => toggleRank(o)}
                  className={`flex w-full items-center gap-2 rounded-lg border px-3 py-2 text-sm text-left transition-colors ${
                    rank >= 0 ? 'border-neon-purple/50 bg-neon-purple/10 text-white' : 'border-zinc-800 text-zinc-300 hover:border-zinc-700'
                  }`}
                >
                  <span className={`flex h-5 w-5 items-center justify-center rounded-full text-[11px] font-bold ${
                    rank >= 0 ? 'bg-neon-purple/30 text-neon-purple' : 'bg-zinc-800 text-zinc-500'
                  }`}>
                    {rank >= 0 ? rank + 1 : '–'}
                  </span>
                  {o}
                </button>
              );
            })}
          </div>
        </div>
      )}

      {poll.method === 'approval' && (
        <div className="space-y-1.5">
          <p className="text-xs text-zinc-500">Approve as many options as you support.</p>
          {poll.options.map((o) => (
            <label key={o} className={`flex items-center gap-2 rounded-lg border px-3 py-2 text-sm cursor-pointer transition-colors ${
              approved.has(o) ? 'border-emerald-500/50 bg-emerald-500/10 text-white' : 'border-zinc-800 text-zinc-300 hover:border-zinc-700'
            }`}>
              <input
                type="checkbox"
                checked={approved.has(o)}
                onChange={() => setApproved((s) => { const n = new Set(s); if (n.has(o)) n.delete(o); else n.add(o); return n; })}
                className="accent-emerald-500"
              />
              {o}
            </label>
          ))}
        </div>
      )}

      {poll.method === 'score' && (
        <div className="space-y-2">
          <p className="text-xs text-zinc-500">Score each option from 0 to {poll.scoreMax}.</p>
          {poll.options.map((o) => (
            <div key={o} className="flex items-center gap-3">
              <span className="w-32 truncate text-sm text-zinc-300">{o}</span>
              <input
                type="range" min={0} max={poll.scoreMax} step={1}
                value={scores[o] ?? 0}
                onChange={(e) => setScores((s) => ({ ...s, [o]: Number(e.target.value) }))}
                className="flex-1 accent-neon-purple"
              />
              <span className="w-8 text-right font-mono text-sm text-neon-purple">{scores[o] ?? 0}</span>
            </div>
          ))}
        </div>
      )}

      {poll.method === 'quadratic' && (
        <div className="space-y-2">
          <p className="text-xs text-zinc-500">
            Allocate vote-credits — cost grows quadratically. Budget: {poll.creditBudget} ·
            <span className={creditsSpent > poll.creditBudget ? ' text-rose-400' : ' text-zinc-400'}> spent {creditsSpent}</span>
          </p>
          {poll.options.map((o) => (
            <div key={o} className="flex items-center gap-3">
              <span className="w-32 truncate text-sm text-zinc-300">{o}</span>
              <input
                type="number"
                value={credits[o] ?? 0}
                onChange={(e) => setCredits((s) => ({ ...s, [o]: Number(e.target.value) }))}
                className="w-20 rounded border border-zinc-800 bg-zinc-950 px-2 py-1 text-sm text-white"
              />
              <span className="text-xs text-zinc-500">
                ≈ {(((credits[o] ?? 0) >= 0 ? 1 : -1) * Math.sqrt(Math.abs(credits[o] ?? 0))).toFixed(1)} effective votes
              </span>
            </div>
          ))}
        </div>
      )}

      {msg && (
        <div className={`flex items-center gap-2 rounded-lg border px-3 py-2 text-xs ${
          msg.ok ? 'border-emerald-500/30 bg-emerald-500/5 text-emerald-300' : 'border-rose-500/30 bg-rose-500/5 text-rose-300'
        }`}>
          {msg.ok ? <CheckCircle2 className="h-4 w-4" /> : <XCircle className="h-4 w-4" />} {msg.text}
        </div>
      )}

      <button
        onClick={submit}
        disabled={busy || (poll.method === 'quadratic' && creditsSpent > poll.creditBudget)}
        className="w-full rounded-lg bg-neon-purple/20 py-2 text-sm font-medium text-neon-purple border border-neon-purple/30 hover:bg-neon-purple/30 disabled:opacity-40"
      >
        {busy ? 'Casting…' : 'Cast Ballot'}
      </button>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Results panel — poll-results macro + charts
// ---------------------------------------------------------------------------

function ResultsPanel({ poll, onClosed }: { poll: Poll; onClosed: () => void }) {
  const [res, setRes] = useState<PollResults | null>(null);
  const [loading, setLoading] = useState(true);
  const [closing, setClosing] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    const { data } = await lensRun<PollResults>('vote', 'poll-results', { pollId: poll.id });
    setRes(data.ok ? data.result : null);
    setLoading(false);
  }, [poll.id]);

  useEffect(() => { load(); }, [load]);

  const closePoll = async () => {
    setClosing(true);
    await lensRun('vote', 'poll-close', { pollId: poll.id });
    setClosing(false);
    onClosed();
    load();
  };

  if (loading) return <div className="py-8 text-center text-xs text-zinc-500">Tallying…</div>;
  if (!res) return <div className="py-8 text-center text-xs text-zinc-500">No results available.</div>;

  const outcomeTone = res.resolution.outcome === 'passed'
    ? 'text-emerald-300 bg-emerald-500/10 border-emerald-500/30'
    : res.resolution.outcome === 'failed'
    ? 'text-rose-300 bg-rose-500/10 border-rose-500/30'
    : 'text-amber-300 bg-amber-500/10 border-amber-500/30';

  return (
    <div className="space-y-4">
      <div className={`rounded-lg border px-3 py-2.5 ${outcomeTone}`}>
        <div className="flex items-center gap-2 text-sm font-semibold uppercase">
          {res.resolution.outcome === 'passed' ? <CheckCircle2 className="h-4 w-4" /> : <XCircle className="h-4 w-4" />}
          {res.resolution.outcome}
        </div>
        <p className="mt-0.5 text-xs opacity-90">{res.resolution.detail}</p>
        <p className="mt-1 text-[11px] opacity-70">
          Quorum {res.resolution.totalBallots}/{res.resolution.quorum} · {res.resolution.quorumMet ? 'met' : 'not met'}
          {res.delegatedBallots > 0 && ` · ${res.delegatedBallots} delegated ballot(s) folded in`}
        </p>
      </div>

      {/* Tally chart */}
      {res.chartData.length > 0 && (
        <div>
          <p className="mb-1.5 text-xs font-medium text-zinc-400">Tally — {res.tally.method}</p>
          <ChartKit
            kind="bar"
            data={res.chartData as unknown as Array<Record<string, unknown>>}
            xKey="option"
            series={[{ key: 'votes', label: 'Votes', color: '#a855f7' }]}
            height={200}
            showLegend={false}
          />
        </div>
      )}

      {/* Ranking table */}
      <div>
        <p className="mb-1.5 text-xs font-medium text-zinc-400">Ranking</p>
        <div className="space-y-1">
          {res.tally.ranking.map((row, i) => {
            const val = row.votes ?? row.total ?? row.effectiveVotes ?? 0;
            const isWinner = row.option === res.tally.winner;
            return (
              <div key={row.option} className={`flex items-center gap-2 rounded border px-2.5 py-1.5 text-xs ${
                isWinner ? 'border-emerald-500/40 bg-emerald-500/5' : 'border-zinc-800'
              }`}>
                <span className="font-mono text-zinc-500">#{i + 1}</span>
                <span className="flex-1 text-zinc-200">{row.option}</span>
                {row.share != null && <span className="text-zinc-500">{Math.round(row.share * 100)}%</span>}
                {row.avg != null && <span className="text-zinc-500">avg {row.avg}</span>}
                <span className="font-mono font-semibold text-neon-purple">{val}</span>
                {isWinner && <span className="rounded bg-emerald-500/20 px-1.5 text-[10px] text-emerald-300">WINNER</span>}
              </div>
            );
          })}
        </div>
      </div>

      {/* IRV rounds */}
      {res.tally.rounds && res.tally.rounds.length > 1 && (
        <div>
          <p className="mb-1.5 flex items-center gap-1 text-xs font-medium text-zinc-400">
            <GitBranch className="h-3.5 w-3.5" /> Instant-runoff elimination rounds
          </p>
          <div className="space-y-2">
            {res.tally.rounds.map((rd) => (
              <div key={rd.round} className="rounded border border-zinc-800 bg-zinc-900/30 p-2">
                <div className="text-[11px] font-medium text-zinc-400">Round {rd.round}</div>
                <div className="mt-1 flex flex-wrap gap-2">
                  {rd.tally.map((t) => (
                    <span key={t.option} className="rounded bg-zinc-800 px-1.5 py-0.5 text-[11px] text-zinc-300">
                      {t.option}: {t.votes} ({Math.round((t.share ?? 0) * 100)}%)
                    </span>
                  ))}
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Consensus over time */}
      {res.consensusSeries.length > 1 && (
        <div>
          <p className="mb-1.5 text-xs font-medium text-zinc-400">Leading-share consensus over time</p>
          <ChartKit
            kind="line"
            data={res.consensusSeries as unknown as Array<Record<string, unknown>>}
            xKey="ballot"
            series={[{ key: 'leadShare', label: 'Leader share', color: '#06b6d4' }]}
            height={180}
            showLegend={false}
          />
        </div>
      )}

      {poll.status === 'open' && (
        <button
          onClick={closePoll}
          disabled={closing}
          className="flex items-center gap-1.5 rounded-lg border border-rose-500/30 bg-rose-500/5 px-3 py-1.5 text-xs text-rose-300 hover:bg-rose-500/10 disabled:opacity-40"
        >
          <Lock className="h-3.5 w-3.5" /> {closing ? 'Closing…' : 'Close voting period now'}
        </button>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Delegation panel — liquid democracy
// ---------------------------------------------------------------------------

function DelegationPanel({ poll }: { poll: Poll }) {
  const [outgoing, setOutgoing] = useState<Delegation[]>([]);
  const [incoming, setIncoming] = useState<Delegation[]>([]);
  const [target, setTarget] = useState('');
  const [scopeGlobal, setScopeGlobal] = useState(false);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);

  const load = useCallback(async () => {
    const { data } = await lensRun<{ outgoing: Delegation[]; incoming: Delegation[] }>('vote', 'delegation-list', {});
    if (data.ok && data.result) {
      setOutgoing(data.result.outgoing);
      setIncoming(data.result.incoming);
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  const delegate = async () => {
    if (!target.trim()) return;
    setBusy(true);
    setMsg(null);
    const input: Record<string, unknown> = { delegateTo: target.trim() };
    if (!scopeGlobal) input.pollId = poll.id;
    const { data } = await lensRun('vote', 'delegate-vote', input);
    setMsg(data.ok ? 'Delegation set.' : (data.error || 'Failed.'));
    setBusy(false);
    if (data.ok) { setTarget(''); load(); }
  };

  const revoke = async (pollId: string) => {
    setBusy(true);
    await lensRun('vote', 'revoke-delegation', pollId === '*' ? {} : { pollId });
    setBusy(false);
    load();
  };

  return (
    <div className="space-y-4">
      <div className="rounded-lg border border-zinc-800 bg-zinc-900/30 p-3">
        <p className="text-xs font-medium text-zinc-300">Delegate your voting power</p>
        <p className="mt-0.5 text-[11px] text-zinc-500">
          Liquid democracy — your weight flows to the delegate&apos;s ballot at tally time if you don&apos;t vote directly.
        </p>
        <div className="mt-2 flex flex-wrap items-center gap-2">
          <input
            value={target}
            onChange={(e) => setTarget(e.target.value)}
            placeholder="Delegate's user id"
            className="flex-1 min-w-[160px] rounded border border-zinc-800 bg-zinc-950 px-2.5 py-1.5 text-xs text-white"
          />
          <label className="flex items-center gap-1.5 text-[11px] text-zinc-400">
            <input type="checkbox" checked={scopeGlobal} onChange={(e) => setScopeGlobal(e.target.checked)} className="accent-neon-purple" />
            All polls (global)
          </label>
          <button
            onClick={delegate}
            disabled={busy || !target.trim()}
            className="rounded bg-neon-purple/20 px-3 py-1.5 text-xs text-neon-purple border border-neon-purple/30 hover:bg-neon-purple/30 disabled:opacity-40"
          >
            Delegate
          </button>
        </div>
        {msg && <p className="mt-1.5 text-[11px] text-zinc-400">{msg}</p>}
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        <div>
          <p className="mb-1.5 text-xs font-medium text-zinc-400">Outgoing ({outgoing.length})</p>
          {outgoing.length === 0 ? (
            <p className="text-[11px] text-zinc-600">You delegate nothing.</p>
          ) : (
            <div className="space-y-1">
              {outgoing.map((d) => (
                <div key={d.id} className="flex items-center gap-2 rounded border border-zinc-800 px-2.5 py-1.5 text-[11px]">
                  <Network className="h-3 w-3 text-cyan-400" />
                  <span className="flex-1 text-zinc-300">→ {d.to}</span>
                  <span className="text-zinc-600">{d.pollId === '*' ? 'global' : 'this poll'}</span>
                  <button onClick={() => revoke(d.pollId)} disabled={busy} className="text-rose-400 hover:text-rose-300" aria-label="Revoke">
                    <Trash2 className="h-3 w-3" />
                  </button>
                </div>
              ))}
            </div>
          )}
        </div>
        <div>
          <p className="mb-1.5 text-xs font-medium text-zinc-400">Incoming ({incoming.length})</p>
          {incoming.length === 0 ? (
            <p className="text-[11px] text-zinc-600">No one delegates to you.</p>
          ) : (
            <div className="space-y-1">
              {incoming.map((d) => (
                <div key={d.id} className="flex items-center gap-2 rounded border border-zinc-800 px-2.5 py-1.5 text-[11px]">
                  <Network className="h-3 w-3 text-emerald-400" />
                  <span className="flex-1 text-zinc-300">{d.from} → you</span>
                  <span className="text-zinc-600">{d.pollId === '*' ? 'global' : 'scoped'}</span>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Audit panel — verifiable receipts
// ---------------------------------------------------------------------------

function AuditPanel({ poll }: { poll: Poll }) {
  const [audit, setAudit] = useState<AuditResult | null>(null);
  const [loading, setLoading] = useState(true);
  const [verifyState, setVerifyState] = useState<Record<string, 'ok' | 'bad' | 'checking'>>({});

  const load = useCallback(async () => {
    setLoading(true);
    const { data } = await lensRun<AuditResult>('vote', 'audit-trail', { pollId: poll.id });
    setAudit(data.ok ? data.result : null);
    setLoading(false);
  }, [poll.id]);

  useEffect(() => { load(); }, [load]);

  const verify = async (receiptId: string) => {
    setVerifyState((s) => ({ ...s, [receiptId]: 'checking' }));
    const { data } = await lensRun<{ valid: boolean }>('vote', 'verify-receipt', { pollId: poll.id, receiptId });
    setVerifyState((s) => ({ ...s, [receiptId]: data.ok && data.result?.valid ? 'ok' : 'bad' }));
  };

  if (loading) return <div className="py-8 text-center text-xs text-zinc-500">Loading audit trail…</div>;
  if (!audit) return <div className="py-8 text-center text-xs text-zinc-500">No audit data.</div>;

  return (
    <div className="space-y-3">
      <div className="flex items-center gap-3 rounded-lg border border-zinc-800 bg-zinc-900/30 px-3 py-2 text-xs">
        <ShieldCheck className="h-4 w-4 text-emerald-400" />
        <span className="text-zinc-300">{audit.receiptCount} receipts · {audit.ballotCount} ballots</span>
        <span className={`rounded px-1.5 py-0.5 text-[10px] uppercase ${
          audit.integrity === 'consistent' ? 'bg-emerald-500/20 text-emerald-300' : 'bg-rose-500/20 text-rose-300'
        }`}>
          {audit.integrity}
        </span>
      </div>

      {audit.receipts.length === 0 ? (
        <p className="text-[11px] text-zinc-600">No ballots cast yet.</p>
      ) : (
        <div className="space-y-1">
          {audit.receipts.map((r) => {
            const st = verifyState[r.id];
            return (
              <div key={r.id} className="flex items-center gap-2 rounded border border-zinc-800 px-2.5 py-1.5 text-[11px]">
                <Hash className="h-3 w-3 text-zinc-600" />
                <code className="font-mono text-cyan-300">{r.hash}</code>
                <span className="flex-1 text-zinc-500">{r.voter} · {fmtDate(r.castAt)}</span>
                {st === 'ok' && <span className="flex items-center gap-1 text-emerald-400"><CheckCircle2 className="h-3 w-3" />verified</span>}
                {st === 'bad' && <span className="flex items-center gap-1 text-rose-400"><XCircle className="h-3 w-3" />invalid</span>}
                {st !== 'ok' && st !== 'bad' && (
                  <button
                    onClick={() => verify(r.id)}
                    disabled={st === 'checking'}
                    className="rounded border border-zinc-700 px-1.5 py-0.5 text-zinc-400 hover:text-white"
                  >
                    {st === 'checking' ? 'checking…' : 'verify'}
                  </button>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Opinion cluster panel — Polis-style grouping
// ---------------------------------------------------------------------------

interface ClusterVoter { voter: string; opinions: Record<string, number> }

function OpinionClusterPanel() {
  const [comments, setComments] = useState<string[]>(['', '', '']);
  const [voters, setVoters] = useState<ClusterVoter[]>([
    { voter: '', opinions: {} },
    { voter: '', opinions: {} },
  ]);
  const [result, setResult] = useState<ClusterResult | null>(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const validComments = comments.map((c) => c.trim()).filter(Boolean);

  const run = async () => {
    setBusy(true);
    setErr(null);
    const cmts = validComments;
    const vts = voters
      .filter((v) => v.voter.trim())
      .map((v) => ({
        voter: v.voter.trim(),
        opinions: Object.fromEntries(cmts.map((c, i) => [c, v.opinions[i] ?? 0])),
      }));
    const { data } = await lensRun<ClusterResult>('vote', 'opinion-cluster', { comments: cmts, votes: vts });
    if (data.ok) setResult(data.result);
    else { setErr(data.error || 'Clustering failed.'); setResult(null); }
    setBusy(false);
  };

  const setOpinion = (vi: number, ci: number, val: number) => {
    setVoters((cur) => cur.map((v, i) => i === vi ? { ...v, opinions: { ...v.opinions, [ci]: val } } : v));
  };

  return (
    <div className="space-y-4">
      <p className="text-xs text-zinc-500">
        Polis-style clustering — enter comment statements and how voters stand on each (agree / pass / disagree),
        then group voters by agreement.
      </p>

      {/* Comments */}
      <div>
        <div className="mb-1.5 flex items-center justify-between">
          <p className="text-xs font-medium text-zinc-400">Comment statements</p>
          <button onClick={() => setComments((c) => [...c, ''])} className="text-[11px] text-neon-purple hover:underline">+ add</button>
        </div>
        <div className="space-y-1.5">
          {comments.map((c, i) => (
            <div key={i} className="flex items-center gap-2">
              <input
                value={c}
                onChange={(e) => setComments((cur) => cur.map((x, j) => j === i ? e.target.value : x))}
                placeholder={`Statement ${i + 1}`}
                className="flex-1 rounded border border-zinc-800 bg-zinc-950 px-2.5 py-1.5 text-xs text-white"
              />
              {comments.length > 1 && (
                <button onClick={() => setComments((cur) => cur.filter((_, j) => j !== i))} className="text-rose-400" aria-label="Remove">
                  <X className="h-3.5 w-3.5" />
                </button>
              )}
            </div>
          ))}
        </div>
      </div>

      {/* Voters opinion grid */}
      <div>
        <div className="mb-1.5 flex items-center justify-between">
          <p className="text-xs font-medium text-zinc-400">Voters &amp; opinions</p>
          <button onClick={() => setVoters((v) => [...v, { voter: '', opinions: {} }])} className="text-[11px] text-neon-purple hover:underline">+ add voter</button>
        </div>
        <div className="space-y-2">
          {voters.map((v, vi) => (
            <div key={vi} className="rounded border border-zinc-800 bg-zinc-900/30 p-2">
              <div className="flex items-center gap-2">
                <input
                  value={v.voter}
                  onChange={(e) => setVoters((cur) => cur.map((x, j) => j === vi ? { ...x, voter: e.target.value } : x))}
                  placeholder={`Voter ${vi + 1}`}
                  className="w-32 rounded border border-zinc-800 bg-zinc-950 px-2 py-1 text-xs text-white"
                />
                {voters.length > 2 && (
                  <button onClick={() => setVoters((cur) => cur.filter((_, j) => j !== vi))} className="text-rose-400" aria-label="Remove voter">
                    <X className="h-3.5 w-3.5" />
                  </button>
                )}
              </div>
              {validComments.length > 0 && (
                <div className="mt-1.5 space-y-1">
                  {validComments.map((c, ci) => (
                    <div key={ci} className="flex items-center gap-2">
                      <span className="flex-1 truncate text-[11px] text-zinc-500">{c}</span>
                      {([['agree', 1], ['pass', 0], ['disagree', -1]] as const).map(([label, val]) => (
                        <button
                          key={label}
                          onClick={() => setOpinion(vi, ci, val)}
                          className={`rounded px-2 py-0.5 text-[10px] transition-colors ${
                            (v.opinions[ci] ?? 0) === val
                              ? val > 0 ? 'bg-emerald-500/30 text-emerald-200' : val < 0 ? 'bg-rose-500/30 text-rose-200' : 'bg-zinc-700 text-zinc-200'
                              : 'bg-zinc-800 text-zinc-500 hover:text-zinc-300'
                          }`}
                        >
                          {label}
                        </button>
                      ))}
                    </div>
                  ))}
                </div>
              )}
            </div>
          ))}
        </div>
      </div>

      {err && (
        <div className="flex items-center gap-2 rounded border border-rose-500/30 bg-rose-500/5 px-3 py-2 text-xs text-rose-300">
          <AlertCircle className="h-4 w-4" /> {err}
        </div>
      )}

      <button
        onClick={run}
        disabled={busy || validComments.length < 1 || voters.filter((v) => v.voter.trim()).length < 2}
        className="rounded-lg bg-neon-purple/20 px-4 py-2 text-sm font-medium text-neon-purple border border-neon-purple/30 hover:bg-neon-purple/30 disabled:opacity-40"
      >
        {busy ? 'Clustering…' : 'Cluster Opinions'}
      </button>

      {/* Results */}
      {result && (
        <div className="space-y-3 border-t border-zinc-800 pt-3">
          <div className="flex flex-wrap gap-3 text-xs">
            <span className="text-zinc-400">{result.numGroups} opinion group(s)</span>
            <span className="text-zinc-400">{result.numVoters} voters</span>
            <span className={result.polarization > 0.5 ? 'text-rose-400' : 'text-emerald-400'}>
              polarization {Math.round(result.polarization * 100)}%
            </span>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
            {result.groups.map((g) => (
              <div key={g.groupId} className="rounded-lg border border-zinc-800 bg-zinc-900/30 p-3">
                <div className="flex items-center justify-between">
                  <span className="text-sm font-semibold text-white">{g.groupId}</span>
                  <span className="text-[11px] text-zinc-500">{g.size} member(s)</span>
                </div>
                <p className="mt-0.5 text-[11px] text-zinc-500">{g.members.join(', ')}</p>
                {g.signatureComments.length > 0 && (
                  <div className="mt-1.5 space-y-0.5">
                    {g.signatureComments.map((c) => (
                      <div key={c.comment} className="flex items-center gap-1.5 text-[11px]">
                        <span className={`rounded px-1 ${
                          c.stance === 'agree' ? 'bg-emerald-500/20 text-emerald-300' : 'bg-rose-500/20 text-rose-300'
                        }`}>
                          {c.stance}
                        </span>
                        <span className="truncate text-zinc-400">{c.comment}</span>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            ))}
          </div>

          {result.consensusComments.length > 0 && (
            <div className="rounded-lg border border-emerald-500/30 bg-emerald-500/5 p-2.5">
              <p className="text-xs font-medium text-emerald-300">Consensus statements (all groups agree)</p>
              <ul className="mt-1 space-y-0.5 text-[11px] text-zinc-300">
                {result.consensusComments.map((c) => <li key={c}>· {c}</li>)}
              </ul>
            </div>
          )}
          {result.divisiveComments.length > 0 && (
            <div className="rounded-lg border border-rose-500/30 bg-rose-500/5 p-2.5">
              <p className="text-xs font-medium text-rose-300">Divisive statements (groups split)</p>
              <ul className="mt-1 space-y-0.5 text-[11px] text-zinc-300">
                {result.divisiveComments.map((c) => <li key={c}>· {c}</li>)}
              </ul>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Create poll modal — poll-create macro
// ---------------------------------------------------------------------------

function CreatePollModal({ onClose, onCreated }: { onClose: () => void; onCreated: () => void }) {
  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [method, setMethod] = useState<VoteMethod>('plurality');
  const [options, setOptions] = useState<string[]>(['', '']);
  const [durationDays, setDurationDays] = useState('7');
  const [quorum, setQuorum] = useState('0');
  const [useThreshold, setUseThreshold] = useState(false);
  const [passThreshold, setPassThreshold] = useState('50');
  const [restricted, setRestricted] = useState(false);
  const [eligibleVoters, setEligibleVoters] = useState('');
  const [weighted, setWeighted] = useState(false);
  const [weights, setWeights] = useState('');
  const [scoreMax, setScoreMax] = useState('5');
  const [creditBudget, setCreditBudget] = useState('100');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const submit = async () => {
    setErr(null);
    const opts = options.map((o) => o.trim()).filter(Boolean);
    if (!title.trim()) { setErr('Title required.'); return; }
    if (opts.length < 2) { setErr('At least 2 options required.'); return; }
    setBusy(true);

    const input: Record<string, unknown> = {
      title: title.trim(),
      description: description.trim() || undefined,
      method,
      options: opts,
      durationDays: Number(durationDays) || 0,
      quorum: Number(quorum) || 0,
    };
    if (useThreshold) input.passThreshold = (Number(passThreshold) || 50) / 100;
    if (restricted) {
      input.eligibility = 'list';
      input.eligibleVoters = eligibleVoters.split(',').map((v) => v.trim()).filter(Boolean);
    }
    if (weighted) {
      input.weighting = 'custom';
      const w: Record<string, number> = {};
      weights.split(',').forEach((pair) => {
        const [id, val] = pair.split(':').map((x) => x.trim());
        if (id && val && Number.isFinite(Number(val))) w[id] = Number(val);
      });
      input.weights = w;
    }
    if (method === 'score') input.scoreMax = Number(scoreMax) || 5;
    if (method === 'quadratic') input.creditBudget = Number(creditBudget) || 100;

    const { data } = await lensRun('vote', 'poll-create', input);
    setBusy(false);
    if (data.ok) onCreated();
    else setErr(data.error || 'Failed to create poll.');
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm p-4">
      <div className="w-full max-w-lg max-h-[90vh] overflow-y-auto rounded-xl border border-zinc-800 bg-zinc-950 p-5 space-y-3">
        <div className="flex items-center justify-between">
          <h2 className="flex items-center gap-2 text-base font-semibold text-white">
            <Plus className="h-5 w-5 text-neon-purple" /> New Governance Poll
          </h2>
          <button onClick={onClose} className="text-zinc-400 hover:text-white" aria-label="Close"><X className="h-5 w-5" /></button>
        </div>

        {err && (
          <div className="flex items-center gap-2 rounded border border-rose-500/30 bg-rose-500/5 px-3 py-2 text-xs text-rose-300">
            <AlertCircle className="h-4 w-4" /> {err}
          </div>
        )}

        <div>
          <label className="mb-1 block text-xs text-zinc-400">Title</label>
          <input value={title} onChange={(e) => setTitle(e.target.value)} maxLength={160}
            className="w-full rounded border border-zinc-800 bg-zinc-900 px-3 py-2 text-sm text-white" placeholder="What is being decided?" />
        </div>

        <div>
          <label className="mb-1 block text-xs text-zinc-400">Description</label>
          <textarea value={description} onChange={(e) => setDescription(e.target.value)} rows={2}
            className="w-full resize-none rounded border border-zinc-800 bg-zinc-900 px-3 py-2 text-sm text-white" placeholder="Optional context" />
        </div>

        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className="mb-1 block text-xs text-zinc-400">Voting method</label>
            <select value={method} onChange={(e) => setMethod(e.target.value as VoteMethod)}
              className="w-full rounded border border-zinc-800 bg-zinc-900 px-3 py-2 text-sm text-white">
              {(Object.keys(METHOD_LABEL) as VoteMethod[]).map((m) => (
                <option key={m} value={m}>{METHOD_LABEL[m]}</option>
              ))}
            </select>
          </div>
          <div>
            <label className="mb-1 block text-xs text-zinc-400">Duration (days)</label>
            <input type="number" min={0} max={365} value={durationDays} onChange={(e) => setDurationDays(e.target.value)}
              className="w-full rounded border border-zinc-800 bg-zinc-900 px-3 py-2 text-sm text-white" />
          </div>
        </div>

        <div>
          <div className="mb-1 flex items-center justify-between">
            <label className="text-xs text-zinc-400">Options</label>
            <button onClick={() => setOptions((o) => [...o, ''])} className="text-[11px] text-neon-purple hover:underline">+ add</button>
          </div>
          <div className="space-y-1.5">
            {options.map((o, i) => (
              <div key={i} className="flex items-center gap-2">
                <input value={o} onChange={(e) => setOptions((cur) => cur.map((x, j) => j === i ? e.target.value : x))}
                  placeholder={`Option ${i + 1}`} className="flex-1 rounded border border-zinc-800 bg-zinc-900 px-3 py-1.5 text-sm text-white" />
                {options.length > 2 && (
                  <button onClick={() => setOptions((cur) => cur.filter((_, j) => j !== i))} className="text-rose-400" aria-label="Remove option">
                    <X className="h-3.5 w-3.5" />
                  </button>
                )}
              </div>
            ))}
          </div>
        </div>

        {method === 'score' && (
          <div>
            <label className="mb-1 block text-xs text-zinc-400">Max score</label>
            <input type="number" min={1} max={100} value={scoreMax} onChange={(e) => setScoreMax(e.target.value)}
              className="w-full rounded border border-zinc-800 bg-zinc-900 px-3 py-2 text-sm text-white" />
          </div>
        )}
        {method === 'quadratic' && (
          <div>
            <label className="mb-1 block text-xs text-zinc-400">Credit budget per voter</label>
            <input type="number" min={1} max={1000} value={creditBudget} onChange={(e) => setCreditBudget(e.target.value)}
              className="w-full rounded border border-zinc-800 bg-zinc-900 px-3 py-2 text-sm text-white" />
          </div>
        )}

        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className="mb-1 block text-xs text-zinc-400">Quorum (min ballots)</label>
            <input type="number" min={0} value={quorum} onChange={(e) => setQuorum(e.target.value)}
              className="w-full rounded border border-zinc-800 bg-zinc-900 px-3 py-2 text-sm text-white" />
          </div>
          <div>
            <label className="mb-1 flex items-center gap-1.5 text-xs text-zinc-400">
              <input type="checkbox" checked={useThreshold} onChange={(e) => setUseThreshold(e.target.checked)} className="accent-neon-purple" />
              Pass threshold (%)
            </label>
            <input type="number" min={0} max={100} value={passThreshold} disabled={!useThreshold}
              onChange={(e) => setPassThreshold(e.target.value)}
              className="w-full rounded border border-zinc-800 bg-zinc-900 px-3 py-2 text-sm text-white disabled:opacity-40" />
          </div>
        </div>

        <div className="space-y-2 rounded border border-zinc-800 bg-zinc-900/30 p-2.5">
          <label className="flex items-center gap-2 text-xs text-zinc-300">
            <input type="checkbox" checked={restricted} onChange={(e) => setRestricted(e.target.checked)} className="accent-neon-purple" />
            Restrict to an eligibility list
          </label>
          {restricted && (
            <input value={eligibleVoters} onChange={(e) => setEligibleVoters(e.target.value)}
              placeholder="user ids, comma-separated"
              className="w-full rounded border border-zinc-800 bg-zinc-950 px-2.5 py-1.5 text-xs text-white" />
          )}
          <label className="flex items-center gap-2 text-xs text-zinc-300">
            <input type="checkbox" checked={weighted} onChange={(e) => setWeighted(e.target.checked)} className="accent-neon-purple" />
            Custom vote weighting
          </label>
          {weighted && (
            <input value={weights} onChange={(e) => setWeights(e.target.value)}
              placeholder="userId:weight pairs, e.g. user_a:3, user_b:1"
              className="w-full rounded border border-zinc-800 bg-zinc-950 px-2.5 py-1.5 text-xs text-white" />
          )}
        </div>

        <div className="flex gap-2 pt-1">
          <button onClick={onClose} className="flex-1 rounded-lg border border-zinc-800 py-2 text-sm text-zinc-400 hover:text-white">
            Cancel
          </button>
          <button onClick={submit} disabled={busy}
            className="flex-1 rounded-lg bg-neon-purple/20 py-2 text-sm font-medium text-neon-purple border border-neon-purple/30 hover:bg-neon-purple/30 disabled:opacity-40">
            {busy ? 'Creating…' : 'Create Poll'}
          </button>
        </div>
      </div>
    </div>
  );
}
