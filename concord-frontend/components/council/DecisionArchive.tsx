'use client';

/**
 * DecisionArchive — Loomio-style searchable resolution archive plus a real
 * instant-runoff (ranked-choice) tabulation workbench for the council lens.
 *
 * Covers the 2026 feature-parity backlog items:
 *  - Decision search/archive — full-text search of past resolutions/outcomes
 *  - Ranked-choice actual tabulation UI — round-by-round IRV elimination
 *
 * All data is real user input persisted through the council domain macros
 * (decision-archive, decision-search, decision-delete, ranked-choice-tabulate).
 * No seed / demo data.
 */

import { useCallback, useEffect, useMemo, useState } from 'react';
import { motion } from 'framer-motion';
import {
  Archive, Search, Plus, X, Trash2, Loader2, ScrollText,
  ListOrdered, Trophy, ChevronRight, Tag, CheckCircle2, XCircle,
} from 'lucide-react';
import { lensRun } from '@/lib/api/client';
import { ds } from '@/lib/design-system';
import { cn } from '@/lib/utils';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface DecisionRecord {
  id: string;
  title: string;
  summary: string;
  outcome: 'passed' | 'rejected' | 'tabled' | 'decided';
  proposalId: string | null;
  meetingId: string | null;
  votesFor: number;
  votesAgainst: number;
  tags: string[];
  decidedAt: string;
  createdAt: string;
}

interface IRVTally { candidate: string; label: string; votes: number }
interface IRVRound { round: number; tallies: IRVTally[]; exhausted: number; majority: number }
interface IRVResult {
  method: string;
  totalBallots: number;
  majority: number;
  rounds: IRVRound[];
  eliminated: string[];
  winner: { candidate: string; label: string; votes: number } | null;
  decided: boolean;
}

const OUTCOME_STYLE: Record<DecisionRecord['outcome'], { label: string; color: string; bg: string }> = {
  passed: { label: 'Passed', color: 'text-green-400', bg: 'bg-green-500/20' },
  rejected: { label: 'Rejected', color: 'text-red-400', bg: 'bg-red-500/20' },
  tabled: { label: 'Tabled', color: 'text-yellow-400', bg: 'bg-yellow-500/20' },
  decided: { label: 'Decided', color: 'text-blue-400', bg: 'bg-blue-500/20' },
};

function fmtDate(s: string): string {
  if (!s) return '—';
  const d = new Date(s);
  if (Number.isNaN(d.getTime())) return s;
  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export function DecisionArchive() {
  const [view, setView] = useState<'archive' | 'tabulate'>('archive');

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-1 border-b border-lattice-border">
        <button
          onClick={() => setView('archive')}
          className={cn(
            'flex items-center gap-2 px-4 py-2 text-sm font-medium border-b-2 transition-colors',
            view === 'archive'
              ? 'border-neon-cyan text-neon-cyan'
              : 'border-transparent text-gray-400 hover:text-white',
          )}
        >
          <Archive className="w-4 h-4" /> Decision Archive
        </button>
        <button
          onClick={() => setView('tabulate')}
          className={cn(
            'flex items-center gap-2 px-4 py-2 text-sm font-medium border-b-2 transition-colors',
            view === 'tabulate'
              ? 'border-neon-cyan text-neon-cyan'
              : 'border-transparent text-gray-400 hover:text-white',
          )}
        >
          <ListOrdered className="w-4 h-4" /> Ranked-Choice Tabulator
        </button>
      </div>
      {view === 'archive' ? <ArchivePane /> : <TabulatorPane />}
    </div>
  );
}

// ---------------------------------------------------------------------------
// ArchivePane — searchable resolution archive
// ---------------------------------------------------------------------------

function ArchivePane() {
  const [decisions, setDecisions] = useState<DecisionRecord[]>([]);
  const [query, setQuery] = useState('');
  const [outcomeFilter, setOutcomeFilter] = useState<'all' | DecisionRecord['outcome']>('all');
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [showCreate, setShowCreate] = useState(false);
  const [form, setForm] = useState({
    title: '', summary: '', outcome: 'passed' as DecisionRecord['outcome'],
    votesFor: '', votesAgainst: '', tags: '', decidedAt: '',
  });

  const search = useCallback(async () => {
    const r = await lensRun('council', 'decision-search', {
      query: query.trim(),
      outcome: outcomeFilter,
    });
    if (r.data?.ok && r.data.result) {
      setDecisions((r.data.result as { decisions: DecisionRecord[] }).decisions || []);
    } else if (r.data?.error) {
      setError(r.data.error);
    }
  }, [query, outcomeFilter]);

  useEffect(() => {
    (async () => {
      setLoading(true);
      await search();
      setLoading(false);
    })();
  }, [search]);

  const handleArchive = useCallback(async () => {
    if (!form.title.trim()) return;
    setBusy(true);
    setError(null);
    try {
      const r = await lensRun('council', 'decision-archive', {
        title: form.title.trim(),
        summary: form.summary.trim(),
        outcome: form.outcome,
        votesFor: parseInt(form.votesFor, 10) || 0,
        votesAgainst: parseInt(form.votesAgainst, 10) || 0,
        tags: form.tags.split(',').map((t) => t.trim()).filter(Boolean),
        decidedAt: form.decidedAt ? new Date(form.decidedAt).toISOString() : '',
      });
      if (!r.data?.ok) {
        setError(r.data?.error || 'archive failed');
        return;
      }
      setShowCreate(false);
      setForm({
        title: '', summary: '', outcome: 'passed',
        votesFor: '', votesAgainst: '', tags: '', decidedAt: '',
      });
      await search();
    } finally {
      setBusy(false);
    }
  }, [form, search]);

  const handleDelete = useCallback(async (id: string) => {
    setBusy(true);
    await lensRun('council', 'decision-delete', { id });
    await search();
    setBusy(false);
  }, [search]);

  return (
    <div className="space-y-4">
      {error && (
        <div className="text-xs text-red-400 bg-red-500/10 rounded px-3 py-2">{error}</div>
      )}

      <div className={ds.sectionHeader}>
        <div className="flex items-center gap-2 flex-wrap">
          <div className="relative">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
            <input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Search resolutions, summaries, tags…"
              className={cn(ds.input, 'pl-10 !w-72')}
            />
          </div>
          <select
            value={outcomeFilter}
            onChange={(e) => setOutcomeFilter(e.target.value as 'all' | DecisionRecord['outcome'])}
            className={cn(ds.select, '!w-36')}
          >
            <option value="all">All outcomes</option>
            <option value="passed">Passed</option>
            <option value="rejected">Rejected</option>
            <option value="tabled">Tabled</option>
            <option value="decided">Decided</option>
          </select>
        </div>
        <button onClick={() => setShowCreate(true)} className={ds.btnPrimary}>
          <Plus className="w-4 h-4" /> Archive Decision
        </button>
      </div>

      {loading && (
        <div className={cn(ds.panel, 'flex items-center justify-center py-12 gap-2')}>
          <Loader2 className="w-5 h-5 animate-spin text-neon-cyan" />
          <span className={ds.textMuted}>Searching archive…</span>
        </div>
      )}

      {!loading && decisions.length === 0 && (
        <div className={cn(ds.panel, 'text-center py-12')}>
          <ScrollText className="w-10 h-10 mx-auto mb-3 text-gray-600" />
          <p className={ds.textMuted}>
            {query.trim() || outcomeFilter !== 'all'
              ? 'No resolutions match this search.'
              : 'No decisions archived yet. Archive a resolution to build the record.'}
          </p>
        </div>
      )}

      <div className="space-y-2">
        {decisions.map((d, idx) => {
          const style = OUTCOME_STYLE[d.outcome];
          const totalVotes = d.votesFor + d.votesAgainst;
          return (
            <motion.div
              key={d.id}
              initial={{ opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: idx * 0.03 }}
              className={ds.panel}
            >
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2 mb-1 flex-wrap">
                    <span className={cn('text-[10px] font-semibold px-2 py-0.5 rounded-full', style.bg, style.color)}>
                      {style.label}
                    </span>
                    <span className="text-xs text-gray-400">{fmtDate(d.decidedAt)}</span>
                  </div>
                  <h3 className={cn(ds.heading3, 'truncate')}>{d.title}</h3>
                  {d.summary && (
                    <p className={cn(ds.textMuted, 'text-sm mt-1 line-clamp-2')}>{d.summary}</p>
                  )}
                  <div className="flex items-center gap-3 mt-2 text-xs text-gray-400 flex-wrap">
                    {totalVotes > 0 && (
                      <span>
                        <span className="text-green-400">{d.votesFor} for</span>
                        {' / '}
                        <span className="text-red-400">{d.votesAgainst} against</span>
                      </span>
                    )}
                    {d.tags.map((t) => (
                      <span key={t} className="flex items-center gap-0.5 px-1.5 py-0.5 bg-lattice-elevated rounded">
                        <Tag className="w-2.5 h-2.5" /> {t}
                      </span>
                    ))}
                  </div>
                </div>
                <button
                  onClick={() => handleDelete(d.id)}
                  disabled={busy}
                  className="p-2 text-red-400 hover:bg-red-500/20 rounded flex-shrink-0"
                  aria-label="Delete decision"
                >
                  <Trash2 className="w-4 h-4" />
                </button>
              </div>
            </motion.div>
          );
        })}
      </div>

      {showCreate && (
        <div className={ds.modalBackdrop} onClick={() => setShowCreate(false)} role="button" tabIndex={0} onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); (e.currentTarget as HTMLElement).click(); } }}>
          <div className={ds.modalContainer}>
            <div className={cn(ds.modalPanel, 'max-w-lg')} onClick={(e) => e.stopPropagation()} role="button" tabIndex={0} onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); (e.currentTarget as HTMLElement).click(); } }}>
              <div className="flex items-center justify-between px-5 py-4 border-b border-lattice-border">
                <h2 className={ds.heading2}>Archive Decision</h2>
                <button onClick={() => setShowCreate(false)} className="text-gray-400 hover:text-white" aria-label="Close">
                  <X className="w-5 h-5" />
                </button>
              </div>
              <div className="p-5 space-y-4 max-h-[70vh] overflow-y-auto">
                <div>
                  <label className={ds.label}>Resolution Title</label>
                  <input
                    value={form.title}
                    onChange={(e) => setForm((f) => ({ ...f, title: e.target.value }))}
                    placeholder="e.g. Adopt remote-work policy"
                    className={ds.input}
                  />
                </div>
                <div>
                  <label className={ds.label}>Summary</label>
                  <textarea
                    value={form.summary}
                    onChange={(e) => setForm((f) => ({ ...f, summary: e.target.value }))}
                    rows={3}
                    placeholder="What was decided and why…"
                    className={ds.textarea}
                  />
                </div>
                <div className={ds.grid2}>
                  <div>
                    <label className={ds.label}>Outcome</label>
                    <select
                      value={form.outcome}
                      onChange={(e) => setForm((f) => ({ ...f, outcome: e.target.value as DecisionRecord['outcome'] }))}
                      className={ds.select}
                    >
                      <option value="passed">Passed</option>
                      <option value="rejected">Rejected</option>
                      <option value="tabled">Tabled</option>
                      <option value="decided">Decided</option>
                    </select>
                  </div>
                  <div>
                    <label className={ds.label}>Decided On</label>
                    <input
                      type="date"
                      value={form.decidedAt}
                      onChange={(e) => setForm((f) => ({ ...f, decidedAt: e.target.value }))}
                      className={ds.input}
                    />
                  </div>
                </div>
                <div className={ds.grid2}>
                  <div>
                    <label className={ds.label}>Votes For</label>
                    <input
                      type="number"
                      min={0}
                      value={form.votesFor}
                      onChange={(e) => setForm((f) => ({ ...f, votesFor: e.target.value }))}
                      placeholder="0"
                      className={ds.input}
                    />
                  </div>
                  <div>
                    <label className={ds.label}>Votes Against</label>
                    <input
                      type="number"
                      min={0}
                      value={form.votesAgainst}
                      onChange={(e) => setForm((f) => ({ ...f, votesAgainst: e.target.value }))}
                      placeholder="0"
                      className={ds.input}
                    />
                  </div>
                </div>
                <div>
                  <label className={ds.label}>Tags (comma-separated)</label>
                  <input
                    value={form.tags}
                    onChange={(e) => setForm((f) => ({ ...f, tags: e.target.value }))}
                    placeholder="hr, policy, governance"
                    className={ds.input}
                  />
                </div>
              </div>
              <div className="flex justify-end gap-3 px-5 py-4 border-t border-lattice-border">
                <button onClick={() => setShowCreate(false)} className={ds.btnGhost}>Cancel</button>
                <button
                  onClick={handleArchive}
                  disabled={!form.title.trim() || busy}
                  className={ds.btnPrimary}
                >
                  Archive
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// TabulatorPane — instant-runoff ranked-choice tabulation workbench
// ---------------------------------------------------------------------------

interface BallotDraft { id: string; voter: string; ranking: string }

function TabulatorPane() {
  const [candidates, setCandidates] = useState<string[]>(['']);
  const [ballots, setBallots] = useState<BallotDraft[]>([
    { id: `b-${Date.now()}`, voter: '', ranking: '' },
  ]);
  const [result, setResult] = useState<IRVResult | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const cleanCandidates = useMemo(
    () => candidates.map((c) => c.trim()).filter(Boolean),
    [candidates],
  );

  const tabulate = useCallback(async () => {
    setError(null);
    const payloadBallots = ballots
      .map((b) => ({
        voter: b.voter.trim() || 'voter',
        ranking: b.ranking.split(',').map((r) => r.trim()).filter(Boolean),
      }))
      .filter((b) => b.ranking.length > 0);
    if (payloadBallots.length === 0) {
      setError('Add at least one ballot with a preference ranking.');
      return;
    }
    setBusy(true);
    try {
      const r = await lensRun('council', 'ranked-choice-tabulate', {
        ballots: payloadBallots,
        candidates: cleanCandidates.map((c) => ({ id: c, label: c })),
      });
      if (r.data?.ok && r.data.result) {
        setResult(r.data.result as IRVResult);
      } else {
        setError(r.data?.error || 'tabulation failed');
        setResult(null);
      }
    } finally {
      setBusy(false);
    }
  }, [ballots, cleanCandidates]);

  return (
    <div className="space-y-4">
      {error && (
        <div className="text-xs text-red-400 bg-red-500/10 rounded px-3 py-2">{error}</div>
      )}

      <div className={ds.panel}>
        <p className="text-sm text-gray-300 mb-3">
          Run a real instant-runoff (IRV) count. Define candidates, enter each voter&apos;s
          ranked ballot (preferences comma-separated, highest first), then tabulate to
          watch round-by-round elimination.
        </p>

        {/* Candidates */}
        <h3 className={cn(ds.heading3, 'mb-2')}>Candidates</h3>
        <div className="space-y-2 mb-4">
          {candidates.map((c, idx) => (
            <div key={idx} className="flex gap-2">
              <input
                value={c}
                onChange={(e) => {
                  const next = [...candidates];
                  next[idx] = e.target.value;
                  setCandidates(next);
                }}
                placeholder={`Candidate ${idx + 1}`}
                className={cn(ds.input, 'flex-1')}
              />
              <button
                onClick={() => setCandidates(candidates.filter((_, i) => i !== idx))}
                disabled={candidates.length <= 1}
                className="p-2 text-red-400 hover:bg-red-500/20 rounded disabled:opacity-30"
                aria-label="Remove candidate"
              >
                <X className="w-4 h-4" />
              </button>
            </div>
          ))}
          <button
            onClick={() => setCandidates([...candidates, ''])}
            className={cn(ds.btnSecondary, 'text-xs')}
          >
            <Plus className="w-3.5 h-3.5" /> Add candidate
          </button>
        </div>

        {/* Ballots */}
        <h3 className={cn(ds.heading3, 'mb-2')}>Ballots</h3>
        <div className="space-y-2 mb-4">
          {ballots.map((b, idx) => (
            <div key={b.id} className="flex gap-2 flex-wrap">
              <input
                value={b.voter}
                onChange={(e) => {
                  const next = [...ballots];
                  next[idx] = { ...b, voter: e.target.value };
                  setBallots(next);
                }}
                placeholder={`Voter ${idx + 1}`}
                className={cn(ds.input, '!w-32')}
              />
              <input
                value={b.ranking}
                onChange={(e) => {
                  const next = [...ballots];
                  next[idx] = { ...b, ranking: e.target.value };
                  setBallots(next);
                }}
                placeholder="Ranking — e.g. Alice, Bob, Carol"
                className={cn(ds.input, 'flex-1 !min-w-[200px]')}
              />
              <button
                onClick={() => setBallots(ballots.filter((_, i) => i !== idx))}
                disabled={ballots.length <= 1}
                className="p-2 text-red-400 hover:bg-red-500/20 rounded disabled:opacity-30"
                aria-label="Remove ballot"
              >
                <X className="w-4 h-4" />
              </button>
            </div>
          ))}
          <button
            onClick={() => setBallots([...ballots, { id: `b-${Date.now()}`, voter: '', ranking: '' }])}
            className={cn(ds.btnSecondary, 'text-xs')}
          >
            <Plus className="w-3.5 h-3.5" /> Add ballot
          </button>
        </div>

        <button onClick={tabulate} disabled={busy} className={ds.btnPrimary}>
          {busy ? <Loader2 className="w-4 h-4 animate-spin" /> : <ListOrdered className="w-4 h-4" />}
          Tabulate (IRV)
        </button>
      </div>

      {/* Results */}
      {result && (
        <div className={ds.panel}>
          <div className="flex items-center justify-between mb-3">
            <h3 className={cn(ds.heading3, 'flex items-center gap-2')}>
              <Trophy className="w-4 h-4 text-yellow-400" /> Tabulation Result
            </h3>
            <span className="text-xs text-gray-400">
              {result.totalBallots} ballot{result.totalBallots !== 1 ? 's' : ''} · majority {result.majority}
            </span>
          </div>

          {result.winner ? (
            <div className={cn(
              'flex items-center gap-3 rounded-lg px-4 py-3 mb-3 border',
              result.decided
                ? 'bg-green-500/10 border-green-500/30'
                : 'bg-yellow-500/10 border-yellow-500/30',
            )}>
              {result.decided
                ? <CheckCircle2 className="w-5 h-5 text-green-400" />
                : <XCircle className="w-5 h-5 text-yellow-400" />}
              <div>
                <p className={cn('text-sm font-medium', result.decided ? 'text-green-400' : 'text-yellow-400')}>
                  {result.decided
                    ? `Winner: ${result.winner.label}`
                    : `Plurality leader: ${result.winner.label} (no majority)`}
                </p>
                <p className="text-xs text-gray-400">
                  {result.winner.votes} final-round vote{result.winner.votes !== 1 ? 's' : ''}
                </p>
              </div>
            </div>
          ) : (
            <p className={cn(ds.textMuted, 'mb-3')}>No winner determined.</p>
          )}

          <div className="space-y-3">
            {result.rounds.map((round) => {
              const roundTotal = round.tallies.reduce((s, t) => s + t.votes, 0) || 1;
              return (
                <div key={round.round} className="bg-lattice-elevated rounded-lg p-3">
                  <div className="flex items-center justify-between mb-2">
                    <span className="text-xs font-semibold text-neon-cyan">
                      Round {round.round}
                    </span>
                    {round.exhausted > 0 && (
                      <span className="text-xs text-gray-400">
                        {round.exhausted} exhausted ballot{round.exhausted !== 1 ? 's' : ''}
                      </span>
                    )}
                  </div>
                  <div className="space-y-1.5">
                    {round.tallies.map((t) => {
                      const reached = t.votes >= round.majority;
                      return (
                        <div key={t.candidate} className="flex items-center gap-2">
                          <span className="text-xs text-gray-300 w-28 truncate flex-shrink-0">
                            {t.label}
                          </span>
                          <div className="flex-1 h-3 bg-black/30 rounded-full overflow-hidden">
                            <div
                              className={cn('h-full rounded-full', reached ? 'bg-green-500' : 'bg-neon-cyan/60')}
                              style={{ width: `${(t.votes / roundTotal) * 100}%` }}
                            />
                          </div>
                          <span className="text-xs font-mono text-white w-8 text-right flex-shrink-0">
                            {t.votes}
                          </span>
                        </div>
                      );
                    })}
                  </div>
                </div>
              );
            })}
          </div>

          {result.eliminated.length > 0 && (
            <div className="mt-3 flex items-center gap-2 flex-wrap text-xs">
              <span className="text-gray-400">Eliminated in order:</span>
              {result.eliminated.map((e, i) => (
                <span key={e} className="flex items-center gap-1">
                  {i > 0 && <ChevronRight className="w-3 h-3 text-gray-700" />}
                  <span className="px-2 py-0.5 bg-red-500/10 text-red-400 rounded-full">{e}</span>
                </span>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
