'use client';

import { useEffect, useRef, useState } from 'react';
import { Mail, Loader2, CheckCircle, Clock, PartyPopper } from 'lucide-react';
import { lensRun } from '@/lib/api/client';
import { showToast } from '@/components/common/Toasts';
import { cn } from '@/lib/utils';

interface Recipient {
  id: string; name: string; email: string; role: string;
  status: 'pending' | 'signed'; signedAt: string | null;
}
interface Envelope {
  id: string; number: string;
  documentId: string; documentName: string;
  matterId: string;
  recipients: Recipient[];
  status: 'sent' | 'completed';
  sentAt: string; completedAt: string | null;
}

function signedCount(env: Envelope): number {
  return env.recipients.filter((r) => r.status === 'signed').length;
}

export function ESignaturePanel() {
  const [list, setList] = useState<Envelope[]>([]);
  const [filter, setFilter] = useState<'all' | 'sent' | 'completed'>('all');
  const [loading, setLoading] = useState(true);
  // recipientId → in-flight, so a slow network doesn't let a second click
  // race the first, and the button shows real progress instead of freezing.
  const [signing, setSigning] = useState<Record<string, boolean>>({});
  // envelopeId that JUST completed this session — drives a one-shot
  // celebratory pulse, never re-fires from a background refetch.
  const [justCompleted, setJustCompleted] = useState<string | null>(null);
  const prevStatus = useRef<Record<string, Envelope['status']>>({});

  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => { refresh(); }, [filter]);

  async function refresh() {
    setLoading(true);
    try {
      const r = await lensRun({ domain: 'legal', action: 'esign-envelopes-list', input: filter === 'all' ? {} : { status: filter } });
      const envelopes = (r.data?.result?.envelopes || []) as Envelope[];
      for (const env of envelopes) prevStatus.current[env.id] = env.status;
      setList(envelopes);
    } catch (e) { console.error('[Esign] list failed', e); }
    finally { setLoading(false); }
  }

  async function recipientSign(envelopeId: string, recipientId: string) {
    if (signing[recipientId]) return;
    const snapshot = list;
    const signedAtOptimistic = new Date().toISOString();

    // Optimistic UI: reflect the sign immediately (sub-100ms perceived
    // response), including the envelope flipping to "completed" when this
    // is the last outstanding signature — real, derived state, not a fake
    // progress animation. Reconciled quietly on success, rolled back
    // visibly on failure.
    setSigning((s) => ({ ...s, [recipientId]: true }));
    setList((prev) =>
      prev.map((env) => {
        if (env.id !== envelopeId) return env;
        const recipients = env.recipients.map((r) =>
          r.id === recipientId ? { ...r, status: 'signed' as const, signedAt: signedAtOptimistic } : r
        );
        const allSigned = recipients.every((r) => r.status === 'signed');
        return {
          ...env,
          recipients,
          status: allSigned ? 'completed' : env.status,
          completedAt: allSigned ? signedAtOptimistic : env.completedAt,
        };
      })
    );

    try {
      await lensRun({
        domain: 'legal',
        action: 'esign-envelope-sign',
        input: { envelopeId, recipientId, ip: window.location.host, userAgent: navigator.userAgent },
      });
      const wasIncomplete = prevStatus.current[envelopeId] !== 'completed';
      const envNow = list.find((e) => e.id === envelopeId);
      const nowComplete = envNow ? signedCount(envNow) + 1 >= envNow.recipients.length : false;
      if (wasIncomplete && nowComplete) {
        setJustCompleted(envelopeId);
        showToast('success', 'All parties have signed — envelope completed.');
        setTimeout(() => setJustCompleted((id) => (id === envelopeId ? null : id)), 1600);
      }
      await refresh(); // quiet reconcile with server truth
    } catch (e) {
      console.error('[Esign] sign failed', e);
      setList(snapshot); // visible rollback — the row reverts to pending
      showToast('error', 'Could not record that signature. Please try again.');
    } finally {
      setSigning((s) => {
        const next = { ...s };
        delete next[recipientId];
        return next;
      });
    }
  }

  return (
    <div className="bg-lattice-surface border border-amber-500/15 rounded-lg overflow-hidden">
      <header className="px-4 py-2.5 border-b border-white/10 flex items-center gap-2">
        <Mail className="w-4 h-4 text-amber-400" />
        <span className="text-sm font-semibold text-gray-200">E-signature envelopes</span>
        <span className="text-[10px] text-gray-400">{list.length}</span>
        <select value={filter} onChange={e => setFilter(e.target.value as typeof filter)} className="ml-auto text-[10px] px-1.5 py-0.5 bg-lattice-deep border border-lattice-border rounded text-white">
          <option value="all">All</option>
          <option value="sent">Awaiting signatures</option>
          <option value="completed">Completed</option>
        </select>
      </header>

      <div className="max-h-[28rem] overflow-y-auto">
        {loading ? (
          <div className="flex items-center justify-center py-10 text-xs text-gray-400"><Loader2 className="w-4 h-4 animate-spin mr-2" /> Loading…</div>
        ) : list.length === 0 ? (
          <div className="px-3 py-10 text-center text-xs text-gray-400"><Mail className="w-6 h-6 mx-auto mb-2 opacity-30" />No envelopes yet. Generate a document and send it for signature.</div>
        ) : (
          <ul className="divide-y divide-white/5">
            {list.map(env => {
              const signed = signedCount(env);
              const total = env.recipients.length || 1;
              const pct = Math.round((signed / total) * 100);
              const celebrating = justCompleted === env.id;
              return (
                <li
                  key={env.id}
                  className={cn(
                    'px-4 py-3 transition-colors duration-500',
                    celebrating ? 'bg-emerald-500/10 ring-1 ring-inset ring-emerald-400/40' : 'hover:bg-white/[0.02]'
                  )}
                >
                  <div className="flex items-center gap-2 mb-1.5">
                    <Mail className={cn('w-3.5 h-3.5', env.status === 'completed' ? 'text-emerald-400' : 'text-amber-400')} />
                    <span className="font-mono text-[10px] text-gray-400">{env.number}</span>
                    <span className="text-sm text-white truncate flex-1">{env.documentName}</span>
                    {celebrating && (
                      <PartyPopper className="w-3.5 h-3.5 text-emerald-300" aria-hidden="true" />
                    )}
                    <span className={cn(
                      'text-[9px] uppercase px-1.5 py-0.5 rounded font-mono',
                      env.status === 'completed' ? 'bg-emerald-500/20 text-emerald-300' : 'bg-amber-500/20 text-amber-300',
                    )}>{env.status}</span>
                  </div>

                  {/* Signing progress — real count, not decorative. */}
                  <div className="flex items-center gap-2 mb-1.5">
                    <div className="flex-1 h-1 rounded-full bg-white/5 overflow-hidden" role="progressbar" aria-valuenow={pct} aria-valuemin={0} aria-valuemax={100} aria-label={`${signed} of ${total} recipients signed`}>
                      <div
                        className={cn('h-full rounded-full transition-all duration-500', env.status === 'completed' ? 'bg-emerald-400' : 'bg-amber-400')}
                        style={{ width: `${pct}%` }}
                      />
                    </div>
                    <span className="text-[10px] font-mono tabular-nums text-gray-400 shrink-0">{signed}/{total}</span>
                  </div>

                  <div className="text-[10px] text-gray-400 mb-1.5">Sent {env.sentAt.slice(0, 10)} · {env.recipients.length} recipient(s){env.completedAt && ` · completed ${env.completedAt.slice(0, 10)}`}</div>
                  <ul className="space-y-1 pl-4">
                    {env.recipients.map(r => {
                      const isSigning = !!signing[r.id];
                      return (
                        <li key={r.id} className="flex items-center gap-2 text-xs">
                          {r.status === 'signed' ? <CheckCircle className="w-3 h-3 text-emerald-400" /> : <Clock className="w-3 h-3 text-amber-400" />}
                          <span className="text-white">{r.name}</span>
                          <span className="text-gray-400">{r.email}</span>
                          <span className="text-[10px] text-gray-400">· {r.role}</span>
                          {r.status === 'signed' ? (
                            <span className="ml-auto flex items-center gap-1 text-[10px] text-emerald-300">
                              {isSigning && <Loader2 className="w-2.5 h-2.5 animate-spin" aria-label="Saving" />}
                              signed {isSigning ? 'just now — saving…' : r.signedAt?.slice(0, 10)}
                            </span>
                          ) : (
                            <button
                              onClick={() => recipientSign(env.id, r.id)}
                              disabled={isSigning}
                              className="ml-auto px-2 py-0.5 text-[10px] rounded bg-amber-500 text-black font-bold hover:bg-amber-400 disabled:opacity-60 disabled:cursor-wait"
                            >
                              Simulate sign
                            </button>
                          )}
                        </li>
                      );
                    })}
                  </ul>
                </li>
              );
            })}
          </ul>
        )}
      </div>
    </div>
  );
}

export default ESignaturePanel;
