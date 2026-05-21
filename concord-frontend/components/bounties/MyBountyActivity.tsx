'use client';

import { useEffect, useState, useCallback } from 'react';
import { lensRun } from '@/lib/api/client';
import { Loader2, Coins, CheckCircle2, Briefcase, Send } from 'lucide-react';
import type { PlatformBounty, Submission } from './types';
import { STATUS_STYLE } from './types';

export function MyBountyActivity({ refreshKey }: { refreshKey: number }) {
  const [posted, setPosted] = useState<PlatformBounty[]>([]);
  const [submitted, setSubmitted] = useState<Submission[]>([]);
  const [earnedCc, setEarnedCc] = useState(0);
  const [resolvedCount, setResolvedCount] = useState(0);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    setLoading(true);
    const r = await lensRun<{
      posted: PlatformBounty[]; submitted: Submission[];
      earnedCc: number; resolvedCount: number;
    }>('bounties', 'my-activity', {});
    if (r.data?.ok && r.data.result) {
      setPosted(r.data.result.posted || []);
      setSubmitted(r.data.result.submitted || []);
      setEarnedCc(r.data.result.earnedCc || 0);
      setResolvedCount(r.data.result.resolvedCount || 0);
    }
    setLoading(false);
  }, []);

  useEffect(() => { void load(); }, [load, refreshKey]);

  if (loading) {
    return (
      <div className="rounded-xl border border-zinc-800 bg-zinc-950/40 p-6 text-center text-zinc-500">
        <Loader2 className="w-5 h-5 animate-spin mx-auto" />
      </div>
    );
  }

  return (
    <div className="rounded-xl border border-zinc-800 bg-zinc-950/40 p-4 space-y-3">
      <h3 className="text-sm font-bold text-zinc-100 flex items-center gap-1.5">
        <Briefcase className="w-4 h-4 text-cyan-400" /> My activity
      </h3>
      <div className="grid grid-cols-2 gap-2">
        <div className="rounded-lg bg-amber-950/30 border border-amber-800/40 px-3 py-2">
          <div className="text-[10px] text-amber-400/80 uppercase tracking-wide">Earned</div>
          <div className="text-lg font-bold text-amber-300 flex items-center gap-1">
            <Coins className="w-4 h-4" /> {earnedCc} CC
          </div>
        </div>
        <div className="rounded-lg bg-emerald-950/30 border border-emerald-800/40 px-3 py-2">
          <div className="text-[10px] text-emerald-400/80 uppercase tracking-wide">Resolved</div>
          <div className="text-lg font-bold text-emerald-300 flex items-center gap-1">
            <CheckCircle2 className="w-4 h-4" /> {resolvedCount}
          </div>
        </div>
      </div>

      <div>
        <h4 className="text-[11px] font-semibold text-zinc-400 uppercase tracking-wide mb-1">
          Bounties I posted ({posted.length})
        </h4>
        {posted.length === 0 ? (
          <p className="text-[11px] text-zinc-600">None yet.</p>
        ) : (
          <ul className="space-y-1">
            {posted.map((b) => (
              <li key={b.id} className="flex items-center justify-between rounded bg-zinc-900 px-2 py-1">
                <span className="text-xs text-zinc-200 truncate">{b.title}</span>
                <span className={`text-[10px] px-1 rounded ring-1 shrink-0 ${STATUS_STYLE[b.status] || STATUS_STYLE.open}`}>
                  {b.status}
                </span>
              </li>
            ))}
          </ul>
        )}
      </div>

      <div>
        <h4 className="text-[11px] font-semibold text-zinc-400 uppercase tracking-wide mb-1 flex items-center gap-1">
          <Send className="w-3 h-3" /> My submissions ({submitted.length})
        </h4>
        {submitted.length === 0 ? (
          <p className="text-[11px] text-zinc-600">None yet.</p>
        ) : (
          <ul className="space-y-1">
            {submitted.map((sub) => (
              <li key={sub.id} className="flex items-center justify-between rounded bg-zinc-900 px-2 py-1">
                <span className="text-xs text-zinc-200 truncate">{sub.bountyTitle || sub.summary}</span>
                <span className={`text-[10px] px-1 rounded shrink-0 ${
                  sub.status === 'accepted' ? 'bg-emerald-500/20 text-emerald-300'
                  : sub.status === 'rejected' ? 'bg-red-500/20 text-red-300'
                  : 'bg-amber-500/20 text-amber-300'}`}>
                  {sub.status}
                </span>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}
