'use client';

/* eslint-disable @typescript-eslint/no-explicit-any */

/**
 * BallotAnalysisLab — electoral-science toolkit for the vote lens.
 *
 * Wired directly to three real `vote` domain macros with NO persisted
 * artifact required (POST /api/lens/run builds a virtual artifact whose
 * `.data` is the input body):
 *   tallyVotes       — plurality / Borda / approval / Condorcet, side by side
 *   fairnessCheck    — Gallagher index, majority criterion, strategic voting
 *   consensusMeasure — Fleiss' kappa, entropy, polarization
 *
 * Distinct from the live poll flow in GovernanceWorkbench: this is a
 * what-if lab for testing an arbitrary ballot set (paste a real election's
 * raw rankings, or explore a hypothetical) and comparing what different
 * voting methods and fairness metrics say about it — the kind of tool
 * FairVote / electionscience.org publish write-ups with, not something
 * Decidim/Snapshot/Polis offer natively.
 *
 * No mock or seed data is auto-loaded — an empty ballot set renders an
 * empty state. "Load a worked example" is an explicit, clearly-labeled
 * user action, not something presented as live data.
 */

import { useMemo, useState } from 'react';
import { lensRun } from '@/lib/api/client';
import {
  FlaskConical, Plus, X, Play, Trophy, Scale, Users2, AlertTriangle,
  CheckCircle2, XCircle, GitBranch, Info,
} from 'lucide-react';

type Analysis = 'tallyVotes' | 'fairnessCheck' | 'consensusMeasure';

interface Ballot { voter: string; rankings: string[] }

const ANALYSIS_LABEL: Record<Analysis, string> = {
  tallyVotes: 'Multi-Method Tally',
  fairnessCheck: 'Fairness Check',
  consensusMeasure: 'Consensus Measure',
};
const ANALYSIS_DESC: Record<Analysis, string> = {
  tallyVotes: 'Plurality, Borda count, approval voting, and Condorcet winner — computed from the same ballots so you can see where methods agree or diverge.',
  fairnessCheck: 'Gallagher disproportionality index, majority-criterion verification, and strategic-voting pattern detection (burying, compromise).',
  consensusMeasure: "Fleiss' kappa inter-rater agreement, Shannon-entropy disagreement, and a bimodality-based polarization index.",
};

const EXAMPLE_CANDIDATES = ['Amara Chen', 'Devon Okafor', 'Priya Raman'];
const EXAMPLE_BALLOTS: Ballot[] = [
  { voter: 'v1', rankings: ['Amara Chen', 'Priya Raman', 'Devon Okafor'] },
  { voter: 'v2', rankings: ['Amara Chen', 'Devon Okafor', 'Priya Raman'] },
  { voter: 'v3', rankings: ['Devon Okafor', 'Priya Raman', 'Amara Chen'] },
  { voter: 'v4', rankings: ['Priya Raman', 'Devon Okafor', 'Amara Chen'] },
  { voter: 'v5', rankings: ['Priya Raman', 'Amara Chen', 'Devon Okafor'] },
];

function pct(v: unknown): string {
  const n = Number(v);
  return Number.isFinite(n) ? `${Math.round(n * 100)}%` : '—';
}

export function BallotAnalysisLab() {
  const [candidates, setCandidates] = useState<string[]>(['', '']);
  const [ballots, setBallots] = useState<Ballot[]>([]);
  const [seatsByCandidate, setSeatsByCandidate] = useState<Record<string, number>>({});
  const [analysis, setAnalysis] = useState<Analysis>('tallyVotes');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [results, setResults] = useState<Partial<Record<Analysis, any>>>({});

  const validCandidates = useMemo(() => candidates.map((c) => c.trim()).filter(Boolean), [candidates]);
  const validBallots = useMemo(() => ballots.filter((b) => b.rankings.length > 0), [ballots]);
  const totalSeats = useMemo(
    () => validCandidates.reduce((s, c) => s + Math.max(0, Math.round(seatsByCandidate[c] ?? 0)), 0),
    [validCandidates, seatsByCandidate],
  );
  const setSeatsFor = (c: string, v: number) => setSeatsByCandidate((cur) => ({ ...cur, [c]: v }));

  const loadExample = () => {
    setCandidates(EXAMPLE_CANDIDATES);
    setBallots(EXAMPLE_BALLOTS.map((b) => ({ ...b, rankings: [...b.rankings] })));
    setSeatsByCandidate({});
    setResults({});
    setErr(null);
  };

  const clearAll = () => {
    setCandidates(['', '']);
    setBallots([]);
    setSeatsByCandidate({});
    setResults({});
    setErr(null);
  };

  const addBallot = () => setBallots((cur) => [...cur, { voter: `voter-${cur.length + 1}`, rankings: [] }]);
  const removeBallot = (i: number) => setBallots((cur) => cur.filter((_, j) => j !== i));
  const toggleRank = (bi: number, candidate: string) => {
    setBallots((cur) => cur.map((b, i) => {
      if (i !== bi) return b;
      const has = b.rankings.includes(candidate);
      return { ...b, rankings: has ? b.rankings.filter((c) => c !== candidate) : [...b.rankings, candidate] };
    }));
  };

  const run = async (which: Analysis) => {
    setErr(null);
    if (validCandidates.length < 2) { setErr('Add at least 2 candidates.'); return; }
    if (validBallots.length === 0) { setErr('Add at least 1 ballot with a ranking.'); return; }
    setBusy(true);
    setAnalysis(which);
    try {
      const input: { candidates: string[]; ballots: { voter: string; rankings: string[] }[]; results?: Record<string, number> } = {
        candidates: validCandidates,
        ballots: validBallots.map((b) => ({ voter: b.voter, rankings: b.rankings })),
      };
      if (which === 'fairnessCheck') {
        // Seat allocation is genuine external real-world data (who actually won
        // which seats in the election/body being analyzed) — the system has no
        // way to derive this on its own, so it's manual entry, not fabrication.
        // Only sent when the user has actually entered at least one seat; an
        // untouched editor keeps the macro's honest "no seat data" empty state.
        const seatEntries = validCandidates
          .map((c) => [c, Math.max(0, Math.round(seatsByCandidate[c] ?? 0))] as const)
          .filter(([, seats]) => seats > 0);
        if (seatEntries.length > 0) {
          input.results = Object.fromEntries(seatEntries);
        }
      }
      const { data } = await lensRun(
        'vote',
        which === 'tallyVotes' ? 'tallyVotes' : which === 'fairnessCheck' ? 'fairnessCheck' : 'consensusMeasure',
        input,
      );
      if (data.ok) {
        setResults((cur) => ({ ...cur, [which]: data.result }));
      } else {
        setErr(data.error || 'Analysis failed.');
      }
    } finally {
      setBusy(false);
    }
  };

  const current = results[analysis];

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-neon-purple/20 pb-3">
        <div className="flex items-center gap-2">
          <FlaskConical className="h-5 w-5 text-neon-purple" />
          <h2 className="text-sm font-semibold text-white">Ballot Analysis Lab</h2>
          <span className="rounded bg-zinc-800 px-1.5 py-0.5 font-mono text-[10px] uppercase tracking-wider text-zinc-400">
            electoral science toolkit
          </span>
        </div>
        <div className="flex items-center gap-2">
          <button onClick={loadExample} className="rounded-lg border border-zinc-800 px-3 py-1.5 text-xs text-zinc-400 hover:text-white">
            Load worked example
          </button>
          <button onClick={clearAll} className="rounded-lg border border-zinc-800 px-3 py-1.5 text-xs text-zinc-400 hover:text-white">
            Clear
          </button>
        </div>
      </div>

      <div className="flex items-start gap-2 rounded-lg border border-zinc-800 bg-zinc-950/40 px-3 py-2 text-[11px] text-zinc-400">
        <Info className="mt-0.5 h-3.5 w-3.5 shrink-0 text-zinc-500" />
        <p>
          Enter candidates and each ballot&apos;s ranked preference order, then run any of the three analyses below.
          Nothing here is tied to a live poll — this is a scratch pad for testing an arbitrary ballot set (paste in a
          real election&apos;s raw rankings, or explore a hypothetical) against multiple voting methods and fairness
          metrics at once.
        </p>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        {/* Candidates + ballots editor */}
        <div className="space-y-4">
          <div>
            <div className="mb-1.5 flex items-center justify-between">
              <p className="text-xs font-medium text-zinc-400">Candidates</p>
              <button onClick={() => setCandidates((c) => [...c, ''])} className="text-[11px] text-neon-purple hover:underline">+ add</button>
            </div>
            <div className="space-y-1.5">
              {candidates.map((c, i) => (
                <div key={i} className="flex items-center gap-2">
                  <input
                    value={c}
                    onChange={(e) => setCandidates((cur) => cur.map((x, j) => (j === i ? e.target.value : x)))}
                    placeholder={`Candidate ${i + 1}`}
                    className="flex-1 rounded border border-zinc-800 bg-zinc-950 px-2.5 py-1.5 text-xs text-white"
                  />
                  {candidates.length > 2 && (
                    <button onClick={() => setCandidates((cur) => cur.filter((_, j) => j !== i))} className="text-rose-400" aria-label="Remove candidate">
                      <X className="h-3.5 w-3.5" />
                    </button>
                  )}
                </div>
              ))}
            </div>
          </div>

          <div>
            <div className="mb-1.5 flex items-center justify-between">
              <p className="text-xs font-medium text-zinc-400">Ballots ({validBallots.length})</p>
              <button
                onClick={addBallot}
                disabled={validCandidates.length < 2}
                className="flex items-center gap-1 text-[11px] text-neon-purple hover:underline disabled:opacity-40"
              >
                <Plus className="h-3 w-3" /> add ballot
              </button>
            </div>
            {validCandidates.length < 2 ? (
              <p className="text-[11px] text-zinc-500">Add at least 2 candidates first.</p>
            ) : ballots.length === 0 ? (
              <p className="text-[11px] text-zinc-500">No ballots yet.</p>
            ) : (
              <div className="space-y-2 max-h-[420px] overflow-y-auto pr-1">
                {ballots.map((b, bi) => (
                  <div key={bi} className="rounded border border-zinc-800 bg-zinc-900/30 p-2">
                    <div className="flex items-center gap-2">
                      <input
                        value={b.voter}
                        onChange={(e) => setBallots((cur) => cur.map((x, j) => (j === bi ? { ...x, voter: e.target.value } : x)))}
                        className="w-28 rounded border border-zinc-800 bg-zinc-950 px-2 py-1 text-[11px] text-white"
                      />
                      <button onClick={() => removeBallot(bi)} className="text-rose-400" aria-label="Remove ballot"><X className="h-3.5 w-3.5" /></button>
                    </div>
                    <p className="mt-1.5 text-[10px] text-zinc-500">Click in ranked order (1st click = top choice):</p>
                    <div className="mt-1 flex flex-wrap gap-1.5">
                      {validCandidates.map((cand) => {
                        const rank = b.rankings.indexOf(cand);
                        return (
                          <button
                            key={cand}
                            onClick={() => toggleRank(bi, cand)}
                            className={`flex items-center gap-1 rounded-full border px-2 py-0.5 text-[11px] transition-colors ${
                              rank >= 0 ? 'border-neon-purple/50 bg-neon-purple/10 text-white' : 'border-zinc-800 text-zinc-400 hover:border-zinc-700'
                            }`}
                          >
                            {rank >= 0 && <span className="font-bold text-neon-purple">{rank + 1}</span>}
                            {cand}
                          </button>
                        );
                      })}
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>

          <div>
            <div className="mb-1.5 flex items-center justify-between">
              <p className="text-xs font-medium text-zinc-400">
                Seat allocation <span className="text-zinc-600">(optional — Gallagher index)</span>
              </p>
              {totalSeats > 0 && (
                <span className="text-[10px] text-zinc-500">{totalSeats} seat{totalSeats === 1 ? '' : 's'} total</span>
              )}
            </div>
            {validCandidates.length < 2 ? (
              <p className="text-[11px] text-zinc-500">Add at least 2 candidates first.</p>
            ) : (
              <>
                <p className="mb-1.5 text-[10px] text-zinc-500">
                  Enter each candidate/party&apos;s actual seats won (a real election result, or a
                  hypothetical allocation) to compute the Gallagher disproportionality index against
                  the vote shares above. This is real-world data the system has no other way to
                  derive — leave everyone at 0 to skip it.
                </p>
                <div className="space-y-1">
                  {validCandidates.map((c) => (
                    <div key={c} className="flex items-center gap-2">
                      <span className="flex-1 truncate text-[11px] text-zinc-300">{c}</span>
                      <input
                        type="number"
                        min={0}
                        step={1}
                        value={seatsByCandidate[c] ?? 0}
                        onChange={(e) => setSeatsFor(c, Math.max(0, Math.round(Number(e.target.value) || 0)))}
                        className="w-16 rounded border border-zinc-800 bg-zinc-950 px-2 py-1 text-right text-[11px] text-white"
                        aria-label={`Seats won by ${c}`}
                      />
                    </div>
                  ))}
                </div>
              </>
            )}
          </div>
        </div>

        {/* Analysis runner + results */}
        <div className="space-y-3">
          <div className="grid grid-cols-1 gap-2">
            {(['tallyVotes', 'fairnessCheck', 'consensusMeasure'] as const).map((a) => (
              <button
                key={a}
                onClick={() => run(a)}
                disabled={busy}
                className={`flex items-start gap-2 rounded-lg border px-3 py-2 text-left transition-colors disabled:opacity-50 ${
                  analysis === a && results[a] ? 'border-neon-purple/50 bg-neon-purple/10' : 'border-zinc-800 bg-zinc-950/40 hover:border-zinc-700'
                }`}
              >
                <Play className="mt-0.5 h-3.5 w-3.5 shrink-0 text-neon-purple" />
                <span>
                  <span className="block text-xs font-medium text-white">{ANALYSIS_LABEL[a]}</span>
                  <span className="block text-[10px] text-zinc-400">{ANALYSIS_DESC[a]}</span>
                </span>
              </button>
            ))}
          </div>

          {err && (
            <div className="flex items-center gap-2 rounded-lg border border-rose-500/30 bg-rose-500/5 px-3 py-2 text-xs text-rose-300">
              <AlertTriangle className="h-4 w-4" /> {err}
            </div>
          )}

          {busy && <div className="py-4 text-center text-xs text-zinc-400">Computing…</div>}

          {!busy && current && analysis === 'tallyVotes' && <TallyResult r={current} />}
          {!busy && current && analysis === 'fairnessCheck' && <FairnessResult r={current} />}
          {!busy && current && analysis === 'consensusMeasure' && <ConsensusResult r={current} />}
        </div>
      </div>
    </div>
  );
}

function TallyResult({ r }: { r: any }) {
  const methods: Array<{ key: string; label: string; winner: string | null; extra?: string }> = [
    { key: 'plurality', label: 'Plurality', winner: r.plurality?.winner ?? null, extra: r.plurality?.hasMajority ? 'majority' : undefined },
    { key: 'bordaCount', label: 'Borda count', winner: r.bordaCount?.winner ?? null },
    { key: 'approvalVoting', label: 'Approval (derived)', winner: r.approvalVoting?.winner ?? null },
    { key: 'condorcet', label: 'Condorcet', winner: r.condorcet?.winner ?? null, extra: r.condorcet?.hasCycle ? 'cycle detected' : undefined },
  ];
  return (
    <div className="space-y-3 rounded-lg border border-zinc-800 bg-zinc-950/40 p-3">
      <div className="flex items-center gap-2 text-xs">
        <Trophy className="h-4 w-4 text-amber-400" />
        <span className="text-zinc-400">Overall winner:</span>
        <span className="font-semibold text-white">{r.overallWinner ?? '—'}</span>
        <span className={`ml-auto rounded px-1.5 py-0.5 text-[10px] uppercase ${
          r.methodAgreement === 'unanimous' ? 'bg-emerald-500/20 text-emerald-300' : r.methodAgreement === 'partial' ? 'bg-amber-500/20 text-amber-300' : 'bg-rose-500/20 text-rose-300'
        }`}>{r.methodAgreement}</span>
      </div>
      <div className="grid grid-cols-2 gap-2">
        {methods.map((m) => (
          <div key={m.key} className="rounded border border-zinc-800 px-2.5 py-1.5">
            <p className="text-[10px] text-zinc-400">{m.label}</p>
            <p className="text-xs font-medium text-white">{m.winner ?? '—'}</p>
            {m.extra && <p className="text-[10px] text-cyan-400">{m.extra}</p>}
          </div>
        ))}
      </div>
      <div>
        <p className="mb-1 text-[10px] text-zinc-400">Plurality ranking</p>
        <div className="space-y-1">
          {(r.plurality?.ranking ?? []).map((row: any) => (
            <div key={row.candidate} className="flex items-center justify-between rounded border border-zinc-800 px-2 py-1 text-[11px]">
              <span className="text-zinc-200">{row.candidate}</span>
              <span className="font-mono text-zinc-400">{row.votes} ({pct(row.share)})</span>
            </div>
          ))}
        </div>
      </div>
      <p className="text-[10px] text-zinc-500">{r.numVoters} voters · {r.numCandidates} candidates</p>
    </div>
  );
}

function FairnessResult({ r }: { r: any }) {
  const mc = r.majorityCriterion || {};
  return (
    <div className="space-y-3 rounded-lg border border-zinc-800 bg-zinc-950/40 p-3">
      <div className="flex items-center gap-2 text-xs">
        {mc.met ? <CheckCircle2 className="h-4 w-4 text-emerald-400" /> : <XCircle className="h-4 w-4 text-rose-400" />}
        <span className="text-zinc-300">{mc.detail}</span>
      </div>
      {r.gallagherIndex !== 'N/A (no seat data)' ? (
        <div className="rounded border border-zinc-800 px-2.5 py-1.5">
          <p className="text-[10px] text-zinc-400">Gallagher disproportionality index</p>
          <p className="text-xs font-medium text-white">{r.gallagherIndex} — {r.gallagherLabel}</p>
        </div>
      ) : (
        <div className="rounded border border-dashed border-zinc-800 px-2.5 py-1.5 text-[11px] text-zinc-500">
          No seat data supplied — enter each candidate&apos;s seats won in the &quot;Seat
          allocation&quot; editor and re-run to compute the Gallagher index.
        </div>
      )}
      <div>
        <p className="mb-1 flex items-center gap-1 text-[10px] text-zinc-400"><Scale className="h-3 w-3" /> Strategic voting patterns</p>
        {r.strategicVoting?.detected ? (
          <div className="space-y-1">
            {r.strategicVoting.patterns.map((p: any, i: number) => (
              <div key={i} className="flex items-center gap-2 rounded border border-amber-500/30 bg-amber-500/5 px-2 py-1 text-[11px] text-amber-300">
                <AlertTriangle className="h-3 w-3" /> {p.type} · {p.count} ballot(s) · {p.severity}
              </div>
            ))}
          </div>
        ) : (
          <p className="text-[11px] text-zinc-500">No burying or compromise patterns detected.</p>
        )}
      </div>
      <p className="text-[10px] text-zinc-500">
        {r.numVoters} voters · effective candidates {r.effectiveCandidates} (Laakso-Taagepera)
      </p>
    </div>
  );
}

function ConsensusResult({ r }: { r: any }) {
  const toneClass = r.overallConsensus === 'strong' ? 'text-emerald-300 bg-emerald-500/10 border-emerald-500/30'
    : r.overallConsensus === 'moderate' ? 'text-amber-300 bg-amber-500/10 border-amber-500/30'
    : 'text-rose-300 bg-rose-500/10 border-rose-500/30';
  return (
    <div className="space-y-3 rounded-lg border border-zinc-800 bg-zinc-950/40 p-3">
      <div className={`rounded-lg border px-3 py-2 ${toneClass}`}>
        <div className="flex items-center gap-2 text-xs font-semibold uppercase">
          <Users2 className="h-4 w-4" /> {r.overallConsensus} consensus
        </div>
        <p className="mt-0.5 text-[11px] opacity-90">
          Fleiss&apos; κ {r.fleissKappa} ({r.kappaInterpretation}) · agreement {r.agreementPercent}% · polarization {r.polarizationIndex} ({r.polarizationLabel})
        </p>
      </div>
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
        <div>
          <p className="mb-1 flex items-center gap-1 text-[10px] text-zinc-400"><GitBranch className="h-3 w-3" /> Most agreed</p>
          <div className="space-y-1">
            {(r.itemConsensus?.mostAgreed ?? []).map((it: any) => (
              <div key={it.item} className="flex items-center justify-between rounded border border-zinc-800 px-2 py-1 text-[11px]">
                <span className="text-zinc-200">{it.item}</span>
                <span className="font-mono text-zinc-400">σ {it.stdDev}</span>
              </div>
            ))}
          </div>
        </div>
        <div>
          <p className="mb-1 text-[10px] text-zinc-400">Most disputed</p>
          <div className="space-y-1">
            {(r.itemConsensus?.mostDisputed ?? []).map((it: any) => (
              <div key={it.item} className="flex items-center justify-between rounded border border-zinc-800 px-2 py-1 text-[11px]">
                <span className="text-zinc-200">{it.item}</span>
                <span className="font-mono text-zinc-400">σ {it.stdDev}</span>
              </div>
            ))}
          </div>
        </div>
      </div>
      <p className="text-[10px] text-zinc-500">{r.numVoters} voters · {r.numItems} items · entropy {r.entropy?.average}</p>
    </div>
  );
}
