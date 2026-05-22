'use client';

/**
 * SessionDetail — full per-session inspector for the sessions lens.
 *
 * Loads one session + its complete event history via sessions.get, then
 * renders:
 *   - a step-transition timeline (viz/TimelineView)
 *   - an ordered step breadcrumb of every transition
 *   - the raw event log
 *   - inline rename, annotate, pause/resume, and close actions
 *
 * Real data end-to-end. Every value comes from sessions.get / mutating
 * macros — no fake events, no placeholder steps.
 */

import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  X, Pencil, MessageSquarePlus, Pause, Play, CheckCircle2, XCircle,
  RefreshCw, ChevronRight,
} from 'lucide-react';
import { lensRun } from '@/lib/api/client';
import { TimelineView, type TimelineEvent } from '@/components/viz/TimelineView';
import { cn } from '@/lib/utils';

type SessionStatus = 'open' | 'paused' | 'completed' | 'abandoned';

interface SessionEvent {
  id: number;
  kind: string;
  fromStep: string | null;
  toStep: string | null;
  note: string | null;
  payload: unknown;
  createdAt: number;
}

interface SessionFull {
  id: string;
  lensId: string;
  title: string | null;
  status: SessionStatus;
  currentStep: string | null;
  stepCount: number;
  createdAt: number;
  updatedAt: number;
  closedAt: number | null;
}

interface GetResult {
  ok: boolean;
  session?: SessionFull;
  events?: SessionEvent[];
  reason?: string;
}

function fmtTime(secs: number): string {
  return new Date(secs * 1000).toLocaleString();
}

const EVENT_TONE: Record<string, TimelineEvent['tone']> = {
  started: 'info',
  advanced: 'default',
  state_merged: 'default',
  paused: 'warn',
  resumed: 'good',
  annotated: 'info',
  completed: 'good',
  abandoned: 'bad',
};

export function SessionDetail({
  sessionId,
  onClose,
  onMutated,
}: {
  sessionId: string;
  onClose: () => void;
  onMutated: () => void;
}) {
  const [session, setSession] = useState<SessionFull | null>(null);
  const [events, setEvents] = useState<SessionEvent[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const [renameOpen, setRenameOpen] = useState(false);
  const [renameValue, setRenameValue] = useState('');
  const [annotateValue, setAnnotateValue] = useState('');

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    const r = await lensRun<GetResult>('sessions', 'get', { sessionId, eventLimit: 200 });
    if (r.data?.ok && r.data.result?.ok && r.data.result.session) {
      setSession(r.data.result.session);
      setEvents(r.data.result.events || []);
    } else {
      setError(r.data?.result?.reason || r.data?.error || 'fetch_failed');
    }
    setLoading(false);
  }, [sessionId]);

  useEffect(() => { void load(); }, [load]);

  // Ordered (oldest-first) transition breadcrumb derived from real events.
  const breadcrumb = useMemo(() => {
    const steps: { step: string; at: number }[] = [];
    const ordered = [...events].sort((a, b) => a.createdAt - b.createdAt || a.id - b.id);
    for (const e of ordered) {
      if ((e.kind === 'started' || e.kind === 'advanced') && e.toStep) {
        steps.push({ step: e.toStep, at: e.createdAt });
      }
    }
    return steps;
  }, [events]);

  const timelineEvents = useMemo<TimelineEvent[]>(
    () => events.map(e => ({
      id: String(e.id),
      label: e.kind === 'advanced' && e.toStep ? e.toStep : e.kind,
      time: e.createdAt * 1000,
      tone: EVENT_TONE[e.kind] || 'default',
      detail: e.note || undefined,
    })),
    [events],
  );

  const mutate = useCallback(async (
    macro: string,
    params: Record<string, unknown>,
  ): Promise<boolean> => {
    setBusy(true);
    const r = await lensRun<{ ok: boolean; reason?: string }>('sessions', macro, params);
    setBusy(false);
    const ok = Boolean(r.data?.ok && r.data.result?.ok);
    if (ok) { await load(); onMutated(); }
    else setError(r.data?.result?.reason || r.data?.error || `${macro}_failed`);
    return ok;
  }, [load, onMutated]);

  const doRename = async () => {
    const t = renameValue.trim();
    if (!t) return;
    if (await mutate('rename', { sessionId, title: t })) {
      setRenameOpen(false);
      setRenameValue('');
    }
  };

  const doAnnotate = async () => {
    const n = annotateValue.trim();
    if (!n) return;
    if (await mutate('annotate', { sessionId, note: n })) setAnnotateValue('');
  };

  const active = session && (session.status === 'open' || session.status === 'paused');

  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center bg-black/70 p-4 overflow-y-auto">
      <div className="w-full max-w-3xl rounded-xl border border-zinc-800 bg-zinc-950 shadow-2xl my-8">
        <header className="flex items-center justify-between border-b border-zinc-800 p-4">
          <div className="min-w-0">
            <h2 className="text-lg font-semibold text-zinc-100 truncate">
              {session?.title || (session ? `Untitled session in ${session.lensId}` : 'Session')}
            </h2>
            {session && (
              <p className="text-[11px] text-zinc-500 font-mono mt-0.5">
                {session.lensId} · {session.status} · started {fmtTime(session.createdAt)}
              </p>
            )}
          </div>
          <div className="flex items-center gap-1 shrink-0">
            <button
              type="button"
              onClick={() => void load()}
              disabled={loading}
              className="p-2 text-zinc-500 hover:text-zinc-200 rounded border border-zinc-800"
              aria-label="Refresh session"
            >
              <RefreshCw className={cn('w-4 h-4', loading && 'animate-spin')} />
            </button>
            <button
              type="button"
              onClick={onClose}
              className="p-2 text-zinc-500 hover:text-zinc-200 rounded border border-zinc-800"
              aria-label="Close detail"
            >
              <X className="w-4 h-4" />
            </button>
          </div>
        </header>

        <div className="p-4 space-y-5">
          {error && (
            <div className="rounded border border-rose-500/30 bg-rose-500/5 p-2 text-xs text-rose-300">
              {error}
            </div>
          )}

          {loading && !session && (
            <p className="text-xs text-zinc-500 py-8 text-center">Loading session…</p>
          )}

          {session && (
            <>
              {/* Action bar */}
              <div className="flex flex-wrap items-center gap-2">
                <button
                  type="button"
                  onClick={() => { setRenameOpen(v => !v); setRenameValue(session.title || ''); }}
                  className="inline-flex items-center gap-1 text-xs px-2.5 py-1.5 rounded border border-zinc-800 text-zinc-300 hover:border-indigo-500/40"
                >
                  <Pencil className="w-3.5 h-3.5" /> Rename
                </button>
                {active && session.status === 'open' && (
                  <button
                    type="button"
                    disabled={busy}
                    onClick={() => void mutate('pause', { sessionId })}
                    className="inline-flex items-center gap-1 text-xs px-2.5 py-1.5 rounded border border-zinc-800 text-amber-300 hover:border-amber-500/40"
                  >
                    <Pause className="w-3.5 h-3.5" /> Pause
                  </button>
                )}
                {active && session.status === 'paused' && (
                  <button
                    type="button"
                    disabled={busy}
                    onClick={() => void mutate('resume', { sessionId })}
                    className="inline-flex items-center gap-1 text-xs px-2.5 py-1.5 rounded border border-zinc-800 text-emerald-300 hover:border-emerald-500/40"
                  >
                    <Play className="w-3.5 h-3.5" /> Resume
                  </button>
                )}
                {active && (
                  <>
                    <button
                      type="button"
                      disabled={busy}
                      onClick={() => void mutate('close', { sessionId, outcome: 'completed' })}
                      className="inline-flex items-center gap-1 text-xs px-2.5 py-1.5 rounded border border-zinc-800 text-emerald-400 hover:border-emerald-500/40"
                    >
                      <CheckCircle2 className="w-3.5 h-3.5" /> Complete
                    </button>
                    <button
                      type="button"
                      disabled={busy}
                      onClick={() => void mutate('close', { sessionId, outcome: 'abandoned' })}
                      className="inline-flex items-center gap-1 text-xs px-2.5 py-1.5 rounded border border-zinc-800 text-rose-400 hover:border-rose-500/40"
                    >
                      <XCircle className="w-3.5 h-3.5" /> Abandon
                    </button>
                  </>
                )}
              </div>

              {renameOpen && (
                <div className="flex items-center gap-2">
                  <input
                    type="text"
                    value={renameValue}
                    onChange={e => setRenameValue(e.target.value)}
                    onKeyDown={e => { if (e.key === 'Enter') void doRename(); }}
                    placeholder="New session title"
                    maxLength={200}
                    className="flex-1 text-xs bg-zinc-900 border border-zinc-800 rounded px-2 py-1.5 text-zinc-100 focus:border-indigo-500/50 outline-none"
                  />
                  <button
                    type="button"
                    disabled={busy || !renameValue.trim()}
                    onClick={() => void doRename()}
                    className="text-xs px-3 py-1.5 rounded bg-indigo-600 text-white disabled:opacity-40 hover:bg-indigo-500"
                  >
                    Save
                  </button>
                </div>
              )}

              {/* Step-transition timeline */}
              <section>
                <h3 className="text-xs font-medium text-zinc-400 mb-2">Step transitions</h3>
                <TimelineView events={timelineEvents} height={140} />
              </section>

              {/* Step breadcrumb */}
              <section>
                <h3 className="text-xs font-medium text-zinc-400 mb-2">
                  Progress breadcrumb · {session.stepCount} transition{session.stepCount === 1 ? '' : 's'}
                </h3>
                {breadcrumb.length === 0 ? (
                  <p className="text-[11px] text-zinc-600">No steps recorded yet.</p>
                ) : (
                  <div className="flex flex-wrap items-center gap-1">
                    {breadcrumb.map((b, i) => (
                      <span key={`${b.step}-${b.at}-${i}`} className="flex items-center gap-1">
                        <span
                          className={cn(
                            'text-[11px] font-mono px-2 py-0.5 rounded border',
                            b.step === session.currentStep && i === breadcrumb.length - 1
                              ? 'border-indigo-500/50 bg-indigo-500/15 text-indigo-200'
                              : 'border-zinc-800 bg-zinc-900/60 text-zinc-400',
                          )}
                          title={fmtTime(b.at)}
                        >
                          {b.step}
                        </span>
                        {i < breadcrumb.length - 1 && (
                          <ChevronRight className="w-3 h-3 text-zinc-700" />
                        )}
                      </span>
                    ))}
                  </div>
                )}
              </section>

              {/* Annotate */}
              <section>
                <h3 className="text-xs font-medium text-zinc-400 mb-2">Add annotation</h3>
                <div className="flex items-center gap-2">
                  <input
                    type="text"
                    value={annotateValue}
                    onChange={e => setAnnotateValue(e.target.value)}
                    onKeyDown={e => { if (e.key === 'Enter') void doAnnotate(); }}
                    placeholder="Note something about this session…"
                    maxLength={500}
                    className="flex-1 text-xs bg-zinc-900 border border-zinc-800 rounded px-2 py-1.5 text-zinc-100 focus:border-indigo-500/50 outline-none"
                  />
                  <button
                    type="button"
                    disabled={busy || !annotateValue.trim()}
                    onClick={() => void doAnnotate()}
                    className="inline-flex items-center gap-1 text-xs px-3 py-1.5 rounded bg-zinc-800 text-zinc-200 disabled:opacity-40 hover:bg-zinc-700"
                  >
                    <MessageSquarePlus className="w-3.5 h-3.5" /> Add
                  </button>
                </div>
              </section>

              {/* Full event log */}
              <section>
                <h3 className="text-xs font-medium text-zinc-400 mb-2">Event log · {events.length}</h3>
                {events.length === 0 ? (
                  <p className="text-[11px] text-zinc-600">No events yet.</p>
                ) : (
                  <ul className="space-y-1 max-h-72 overflow-y-auto">
                    {[...events]
                      .sort((a, b) => b.createdAt - a.createdAt || b.id - a.id)
                      .map(e => (
                        <li
                          key={e.id}
                          className="flex items-start gap-2 text-[11px] rounded border border-zinc-800/70 bg-zinc-900/40 px-2 py-1.5"
                        >
                          <span
                            className={cn(
                              'font-mono px-1.5 py-0.5 rounded shrink-0',
                              EVENT_TONE[e.kind] === 'bad' ? 'bg-rose-500/15 text-rose-300'
                                : EVENT_TONE[e.kind] === 'good' ? 'bg-emerald-500/15 text-emerald-300'
                                : EVENT_TONE[e.kind] === 'warn' ? 'bg-amber-500/15 text-amber-300'
                                : 'bg-zinc-800 text-zinc-400',
                            )}
                          >
                            {e.kind}
                          </span>
                          <span className="flex-1 min-w-0 text-zinc-400">
                            {e.fromStep || e.toStep ? (
                              <span className="font-mono text-zinc-500">
                                {e.fromStep || '∅'} → {e.toStep || '∅'}
                              </span>
                            ) : null}
                            {e.note && <span className="block text-zinc-300">{e.note}</span>}
                          </span>
                          <span className="text-zinc-600 shrink-0">{fmtTime(e.createdAt)}</span>
                        </li>
                      ))}
                  </ul>
                )}
              </section>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
