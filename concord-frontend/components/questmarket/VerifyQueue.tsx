/* eslint-disable @typescript-eslint/no-explicit-any */
'use client';

import { useCallback, useEffect, useState } from 'react';
import { lensRun } from '@/lib/api/client';
import {
  Loader2, ShieldCheck, ChevronDown, ChevronRight, ExternalLink,
  Check, X, Coins,
} from 'lucide-react';

interface Quest {
  id: string;
  title: string;
  reward: number;
  difficulty: string;
  status: string;
  poster: string;
}
interface Claim {
  id: string;
  questId: string;
  claimant: string;
  status: string;
  acceptedAt: string;
  submittedAt: string | null;
  proof: { summary: string; links: string[]; artifactIds: string[] } | null;
}

export function VerifyQueue({ onChanged }: { onChanged?: () => void }) {
  const [quests, setQuests] = useState<Quest[]>([]);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState<string | null>(null);
  const [expanded, setExpanded] = useState<string | null>(null);
  const [claims, setClaims] = useState<Record<string, Claim[]>>({});
  const [busy, setBusy] = useState<string | null>(null);
  const [note, setNote] = useState('');

  const load = useCallback(async () => {
    setLoading(true);
    const r = await lensRun<any>('questmarket', 'listQuests', { mine: true });
    if (r.data?.ok && r.data.result) {
      setQuests(r.data.result.quests || []);
      setErr(null);
    } else {
      setErr(r.data?.error || 'failed to load');
    }
    setLoading(false);
  }, []);

  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => { load(); }, []);

  const loadClaims = async (questId: string) => {
    if (expanded === questId) { setExpanded(null); return; }
    setExpanded(questId);
    const r = await lensRun<any>('questmarket', 'questClaims', { questId });
    if (r.data?.ok && r.data.result) {
      setClaims((p) => ({ ...p, [questId]: r.data.result.claims || [] }));
    }
  };

  const verify = async (questId: string, claimId: string, approve: boolean) => {
    setBusy(claimId);
    const r = await lensRun<any>('questmarket', 'verifyClaim', {
      claimId, approve, note: note.trim(),
    });
    setBusy(null);
    setNote('');
    if (r.data?.ok) {
      const cr = await lensRun<any>('questmarket', 'questClaims', { questId });
      if (cr.data?.ok && cr.data.result) {
        setClaims((p) => ({ ...p, [questId]: cr.data.result.claims || [] }));
      }
      load();
      onChanged?.();
    } else {
      setErr(r.data?.error || 'verify failed');
    }
  };

  const cancel = async (questId: string) => {
    setBusy(questId);
    const r = await lensRun<any>('questmarket', 'cancelQuest', { questId });
    setBusy(null);
    if (r.data?.ok) { load(); onChanged?.(); }
    else setErr(r.data?.error || 'cancel failed');
  };

  return (
    <div className="space-y-3">
      <div className="flex items-center gap-2">
        <ShieldCheck className="h-4 w-4 text-emerald-400" />
        <h3 className="text-sm font-semibold text-white">Verify Queue — Quests I Posted</h3>
      </div>

      {err && (
        <div className="rounded border border-red-500/30 bg-red-500/5 px-3 py-2 text-xs text-red-300">
          {err}
        </div>
      )}

      {loading ? (
        <div className="flex items-center gap-2 py-6 text-xs text-zinc-500">
          <Loader2 className="h-4 w-4 animate-spin" /> Loading…
        </div>
      ) : quests.length === 0 ? (
        <div className="rounded border border-dashed border-zinc-800 py-8 text-center text-xs text-zinc-500">
          You have not posted any quests yet.
        </div>
      ) : (
        <div className="space-y-2">
          {quests.map((q) => {
            const open = expanded === q.id;
            const qClaims = claims[q.id] || [];
            const pending = qClaims.filter((c) => c.status === 'submitted').length;
            return (
              <div key={q.id} className="rounded-lg border border-zinc-800 bg-zinc-950/60">
                <button onClick={() => loadClaims(q.id)}
                  className="flex w-full items-center justify-between gap-3 p-3 text-left">
                  <div className="flex items-center gap-2">
                    {open ? <ChevronDown className="h-4 w-4 text-zinc-500" />
                      : <ChevronRight className="h-4 w-4 text-zinc-500" />}
                    <span className="text-sm font-medium text-white">{q.title}</span>
                    <span className="rounded-full bg-zinc-800 px-1.5 py-0.5 text-[10px] text-zinc-400">
                      {q.status.replace('_', ' ')}
                    </span>
                    {pending > 0 && (
                      <span className="rounded-full bg-amber-500/15 px-1.5 py-0.5 text-[10px] text-amber-300">
                        {pending} to verify
                      </span>
                    )}
                  </div>
                  <span className="flex items-center gap-1 text-xs font-bold text-amber-300">
                    <Coins className="h-3 w-3" />{q.reward}
                  </span>
                </button>

                {open && (
                  <div className="space-y-2 border-t border-zinc-800 p-3">
                    {(q.status === 'open' || q.status === 'in_progress') && qClaims.every((c) => c.status !== 'accepted' && c.status !== 'submitted') && (
                      <button onClick={() => cancel(q.id)} disabled={busy === q.id}
                        className="rounded border border-zinc-700 px-2.5 py-1 text-[10px] text-zinc-400 hover:text-red-300">
                        Cancel quest & refund escrow
                      </button>
                    )}
                    {qClaims.length === 0 && (
                      <p className="text-xs text-zinc-500">No claims on this quest yet.</p>
                    )}
                    {qClaims.map((c) => (
                      <div key={c.id} className="rounded border border-zinc-800 bg-zinc-900/60 p-2.5">
                        <div className="flex items-center justify-between">
                          <span className="text-xs font-medium text-white">{c.claimant}</span>
                          <span className="rounded-full bg-zinc-800 px-1.5 py-0.5 text-[10px] text-zinc-400">
                            {c.status}
                          </span>
                        </div>
                        {c.proof ? (
                          <div className="mt-1.5 space-y-1">
                            <p className="text-[11px] text-zinc-300">{c.proof.summary}</p>
                            {c.proof.links.length > 0 && (
                              <div className="flex flex-wrap gap-2">
                                {c.proof.links.map((l, i) => (
                                  <a key={i} href={l} target="_blank" rel="noopener noreferrer"
                                    className="flex items-center gap-0.5 text-[10px] text-sky-400 hover:underline">
                                    <ExternalLink className="h-2.5 w-2.5" />{l}
                                  </a>
                                ))}
                              </div>
                            )}
                          </div>
                        ) : (
                          <p className="mt-1.5 text-[11px] text-zinc-600">No proof submitted yet.</p>
                        )}
                        {c.status === 'submitted' && (
                          <div className="mt-2 space-y-1.5">
                            <input value={note} onChange={(e) => setNote(e.target.value)}
                              placeholder="Verdict note (optional)"
                              className="w-full rounded border border-zinc-800 bg-zinc-950 px-2 py-1 text-[11px] text-white" />
                            <div className="flex gap-2">
                              <button onClick={() => verify(q.id, c.id, true)} disabled={busy === c.id}
                                className="flex items-center gap-1 rounded bg-emerald-500/20 px-3 py-1 text-[10px] font-semibold text-emerald-200 hover:bg-emerald-500/30 disabled:opacity-50">
                                <Check className="h-3 w-3" /> Approve & Pay
                              </button>
                              <button onClick={() => verify(q.id, c.id, false)} disabled={busy === c.id}
                                className="flex items-center gap-1 rounded bg-red-500/20 px-3 py-1 text-[10px] font-semibold text-red-200 hover:bg-red-500/30 disabled:opacity-50">
                                <X className="h-3 w-3" /> Reject
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
          })}
        </div>
      )}
    </div>
  );
}
