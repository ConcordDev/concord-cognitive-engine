/* eslint-disable @typescript-eslint/no-explicit-any */
'use client';

import { useCallback, useEffect, useState } from 'react';
import { lensRun } from '@/lib/api/client';
import {
  Loader2, Coins, FileCheck2, Send, XCircle, CheckCircle2, Clock, Trophy,
} from 'lucide-react';

interface Claim {
  id: string;
  questId: string;
  status: string;
  questTitle: string;
  questReward: number;
  questDifficulty: string | null;
  acceptedAt: string;
  submittedAt: string | null;
  verifiedAt: string | null;
  verdictNote: string | null;
  proof: { summary: string; links: string[] } | null;
}

const STATUS_STYLE: Record<string, string> = {
  accepted: 'text-sky-300 bg-sky-500/10',
  submitted: 'text-amber-300 bg-amber-500/10',
  verified: 'text-emerald-300 bg-emerald-500/10',
  rejected: 'text-red-300 bg-red-500/10',
  abandoned: 'text-zinc-400 bg-zinc-700/30',
};

export function MyClaimsPanel({ onChanged }: { onChanged?: () => void }) {
  const [claims, setClaims] = useState<Claim[]>([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [submitFor, setSubmitFor] = useState<string | null>(null);
  const [summary, setSummary] = useState('');
  const [links, setLinks] = useState('');

  const load = useCallback(async () => {
    setLoading(true);
    const r = await lensRun<any>('questmarket', 'myClaims', {});
    if (r.data?.ok && r.data.result) {
      setClaims(r.data.result.claims || []);
      setErr(null);
    } else {
      setErr(r.data?.error || 'failed to load claims');
    }
    setLoading(false);
  }, []);

  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => { load(); }, []);

  const submit = async (claimId: string) => {
    if (!summary.trim()) return;
    setBusy(claimId);
    const r = await lensRun<any>('questmarket', 'submitProof', {
      claimId,
      summary: summary.trim(),
      links: links.split(',').map((l) => l.trim()).filter(Boolean),
    });
    setBusy(null);
    if (r.data?.ok) {
      setSubmitFor(null); setSummary(''); setLinks('');
      load(); onChanged?.();
    } else {
      setErr(r.data?.error || 'submit failed');
    }
  };

  const abandon = async (claimId: string) => {
    setBusy(claimId);
    const r = await lensRun<any>('questmarket', 'abandonClaim', { claimId });
    setBusy(null);
    if (r.data?.ok) { load(); onChanged?.(); }
    else setErr(r.data?.error || 'abandon failed');
  };

  return (
    <div className="space-y-3">
      <div className="flex items-center gap-2">
        <FileCheck2 className="h-4 w-4 text-sky-400" />
        <h3 className="text-sm font-semibold text-white">My Claims</h3>
        <span className="rounded bg-zinc-800 px-1.5 py-0.5 text-[10px] text-zinc-400">
          {claims.length}
        </span>
      </div>

      {err && (
        <div className="rounded border border-red-500/30 bg-red-500/5 px-3 py-2 text-xs text-red-300">
          {err}
        </div>
      )}

      {loading ? (
        <div className="flex items-center gap-2 py-6 text-xs text-zinc-400">
          <Loader2 className="h-4 w-4 animate-spin" /> Loading…
        </div>
      ) : claims.length === 0 ? (
        <div className="rounded border border-dashed border-zinc-800 py-8 text-center text-xs text-zinc-400">
          No claims yet. Accept a quest from the board to start.
        </div>
      ) : (
        <div className="space-y-2">
          {claims.map((c) => (
            <div key={c.id} className="rounded-lg border border-zinc-800 bg-zinc-950/60 p-3">
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0 flex-1">
                  <span className="text-sm font-medium text-white">{c.questTitle}</span>
                  <div className="mt-1.5 flex flex-wrap items-center gap-1.5 text-[10px]">
                    <span className={`rounded-full px-1.5 py-0.5 ${STATUS_STYLE[c.status] || 'text-zinc-400 bg-zinc-700/30'}`}>
                      {c.status}
                    </span>
                    {c.questDifficulty && (
                      <span className="rounded-full bg-zinc-800 px-1.5 py-0.5 text-zinc-400">
                        {c.questDifficulty}
                      </span>
                    )}
                  </div>
                  {c.proof && (
                    <p className="mt-1.5 line-clamp-2 text-[11px] text-zinc-400">
                      Proof: {c.proof.summary}
                    </p>
                  )}
                  {c.verdictNote && (
                    <p className="mt-1 text-[11px] text-zinc-400">Verdict: {c.verdictNote}</p>
                  )}
                </div>
                <div className="flex shrink-0 flex-col items-end gap-2">
                  {c.questReward > 0 && (
                    <span className="flex items-center gap-1 text-xs font-bold text-amber-300">
                      <Coins className="h-3 w-3" />{c.questReward}
                    </span>
                  )}
                  {c.status === 'accepted' && (
                    <div className="flex gap-1">
                      <button onClick={() => { setSubmitFor(c.id); setSummary(''); setLinks(''); }}
                        className="flex items-center gap-1 rounded bg-amber-500/20 px-2 py-1 text-[10px] font-semibold text-amber-200 hover:bg-amber-500/30">
                        <Send className="h-3 w-3" /> Submit
                      </button>
                      <button onClick={() => abandon(c.id)} disabled={busy === c.id}
                        className="rounded border border-zinc-700 px-2 py-1 text-[10px] text-zinc-400 hover:text-red-300">
                        Abandon
                      </button>
                    </div>
                  )}
                  {c.status === 'submitted' && (
                    <span className="flex items-center gap-1 text-[10px] text-amber-300">
                      <Clock className="h-3 w-3" /> awaiting verify
                    </span>
                  )}
                  {c.status === 'verified' && (
                    <span className="flex items-center gap-1 text-[10px] text-emerald-300">
                      <Trophy className="h-3 w-3" /> paid out
                    </span>
                  )}
                  {c.status === 'rejected' && (
                    <span className="flex items-center gap-1 text-[10px] text-red-300">
                      <XCircle className="h-3 w-3" /> rejected
                    </span>
                  )}
                </div>
              </div>

              {submitFor === c.id && (
                <div className="mt-3 space-y-2 rounded border border-zinc-800 bg-zinc-900/60 p-2.5">
                  <p className="text-[10px] font-semibold text-zinc-400">
                    Proof of completion
                  </p>
                  <textarea value={summary} onChange={(e) => setSummary(e.target.value)}
                    placeholder="Describe what you completed…" rows={2}
                    className="w-full rounded border border-zinc-800 bg-zinc-950 px-2 py-1.5 text-xs text-white" />
                  <input value={links} onChange={(e) => setLinks(e.target.value)}
                    placeholder="Evidence links (comma-separated)"
                    className="w-full rounded border border-zinc-800 bg-zinc-950 px-2 py-1.5 text-xs text-white" />
                  <div className="flex justify-end gap-2">
                    <button onClick={() => setSubmitFor(null)}
                      className="rounded border border-zinc-700 px-2.5 py-1 text-[10px] text-zinc-300">
                      Cancel
                    </button>
                    <button onClick={() => submit(c.id)} disabled={!summary.trim() || busy === c.id}
                      className="flex items-center gap-1 rounded bg-amber-500/20 px-3 py-1 text-[10px] font-semibold text-amber-200 hover:bg-amber-500/30 disabled:opacity-50">
                      <CheckCircle2 className="h-3 w-3" />
                      {busy === c.id ? 'Submitting…' : 'Submit Proof'}
                    </button>
                  </div>
                </div>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
