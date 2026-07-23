'use client';

// concord-frontend/components/conkay/ConKayMemoryPanel.tsx
//
// Beyond-Denial unit #2 — ConKay's persistent cross-session memory panel.
// Surfaces the REAL rolling-window memory substrate
// (`server/lib/conversation-memory.js#compressRollingWindow`), which already
// writes structured `conversation_memory` (and consolidated
// `conversation_memory_hyper`) DTUs into the write-through DTU store as a
// conversation grows past its active window. Nothing here re-implements that
// pipeline — this panel only lists/pins/forgets the DTUs it already produced,
// through three thin macros added alongside it (`server/domains/conkay.js`):
// `conkay.memory_list`, `conkay.memory_pin`, `conkay.memory_forget`.
//
// Honesty notes:
//   - Ownership is real: the backend only surfaces DTUs stamped with THIS
//     user's `machine.userId` (see the macro file's doc comment for why
//     `conversation_memory_mega` DTUs — which have no per-user attribution —
//     are excluded rather than guessed at). A pin/forget on a DTU this user
//     doesn't own is rejected server-side (`not_owned`), never silently
//     no-op'd as success.
//   - No memories yet is an honest, expected state (memory only forms once a
//     conversation crosses the rolling-window threshold) — rendered via the
//     shared `EmptyState` primitive, never a fabricated sample memory.
//   - Pin/forget only update the UI after the real macro call resolves
//     `ok: true`. A failure surfaces inline on that row and leaves the item
//     exactly as it was — never a fake optimistic success.
//   - One-shot fetch on mount, matching the sibling cockpit panels'
//     discipline. No setInterval/setTimeout anywhere in this file — the list
//     only changes in response to a real backend round trip.

import { useCallback, useEffect, useState } from 'react';
import { Brain, Pin, PinOff, Trash2, Loader2 } from 'lucide-react';
import { lensRun } from '@/lib/api/client';
import { EmptyState } from '@/components/ui/EmptyState';

export interface ConKayMemoryDtu {
  id: string;
  kind: string;
  title: string | null;
  tier: string;
  topics: string[];
  insights: string[];
  sessionId: string | null;
  messageCount: number | null;
  megaCount: number | null;
  pinned: boolean;
  createdAt: string | null;
  updatedAt: string | null;
}

type PanelStatus = 'loading' | 'ok' | 'error';
type RowAction = 'pin' | 'forget';

function formatWhen(iso: string | null): string | null {
  if (!iso) return null;
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return null;
  return d.toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
}

export function ConKayMemoryPanel() {
  const [status, setStatus] = useState<PanelStatus>('loading');
  const [memories, setMemories] = useState<ConKayMemoryDtu[]>([]);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  // Per-row in-flight action, so a pin/forget click on one row can't be
  // fired twice while its real request is still outstanding.
  const [pendingId, setPendingId] = useState<string | null>(null);
  // Per-row honest error (a rejected pin/forget), keyed by dtu id.
  const [rowErrors, setRowErrors] = useState<Record<string, string>>({});

  const load = useCallback(async () => {
    setStatus('loading');
    setErrorMessage(null);
    try {
      const res = await lensRun<{ memories: ConKayMemoryDtu[]; count: number }>(
        'conkay',
        'memory_list',
        {},
      );
      if (!res.data.ok || !res.data.result) {
        throw new Error(res.data.error || 'memory_list_failed');
      }
      setMemories(res.data.result.memories || []);
      setStatus('ok');
    } catch (e) {
      setErrorMessage(e instanceof Error ? e.message : String(e));
      setStatus('error');
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const runRowAction = useCallback(
    async (action: RowAction, dtu: ConKayMemoryDtu) => {
      setPendingId(dtu.id);
      setRowErrors((prev) => {
        const next = { ...prev };
        delete next[dtu.id];
        return next;
      });
      try {
        if (action === 'pin') {
          const res = await lensRun<{ dtuId: string; pinned: boolean }>('conkay', 'memory_pin', {
            dtuId: dtu.id,
            pinned: !dtu.pinned,
          });
          if (!res.data.ok || !res.data.result) {
            throw new Error(res.data.error || 'memory_pin_failed');
          }
          const { pinned } = res.data.result;
          setMemories((prev) => prev.map((m) => (m.id === dtu.id ? { ...m, pinned } : m)));
        } else {
          const res = await lensRun<{ dtuId: string; forgotten: boolean }>(
            'conkay',
            'memory_forget',
            { dtuId: dtu.id },
          );
          if (!res.data.ok || !res.data.result?.forgotten) {
            throw new Error(res.data.error || 'memory_forget_failed');
          }
          setMemories((prev) => prev.filter((m) => m.id !== dtu.id));
        }
      } catch (e) {
        setRowErrors((prev) => ({
          ...prev,
          [dtu.id]: e instanceof Error ? e.message : String(e),
        }));
      } finally {
        setPendingId(null);
      }
    },
    [],
  );

  return (
    <div
      data-testid="ck-memory-panel"
      className="mx-auto mt-2 max-w-2xl rounded-xl border border-cyan-400/15 bg-black/30 p-3"
    >
      <div className="flex items-center gap-1.5 px-1 pb-1 text-[10px] uppercase tracking-wide text-cyan-300/50">
        <Brain className="h-3 w-3" aria-hidden />
        cross-session memory
      </div>

      {status === 'loading' && (
        <div data-testid="ck-memory-loading" className="px-1 py-2 text-[11px] text-cyan-300/60">
          Loading your memory…
        </div>
      )}

      {status === 'error' && (
        <div data-testid="ck-memory-error" className="px-1 py-2 text-[11px] text-rose-300/80">
          Couldn&apos;t load your memory{errorMessage ? ` (${errorMessage})` : ''}.
        </div>
      )}

      {status === 'ok' && memories.length === 0 && (
        <EmptyState
          compact
          icon={<Brain className="h-5 w-5" aria-hidden="true" />}
          title="No memories yet"
          description="ConKay forms real memory automatically once a conversation compresses past its active window — nothing to create by hand yet."
          className="border-none bg-transparent py-4"
        />
      )}

      {status === 'ok' && memories.length > 0 && (
        <ul className="space-y-1.5" data-testid="ck-memory-list">
          {memories.map((m) => {
            const pending = pendingId === m.id;
            const rowError = rowErrors[m.id];
            const when = formatWhen(m.updatedAt);
            return (
              <li
                key={m.id}
                data-testid={`ck-memory-row-${m.id}`}
                data-pinned={m.pinned}
                className="rounded-lg border border-cyan-400/10 bg-black/20 px-2 py-1.5 text-[12px]"
              >
                <div className="flex items-start justify-between gap-2">
                  <div className="min-w-0 flex-1">
                    <div className="truncate text-cyan-100/90">
                      {m.title || (m.topics.length > 0 ? m.topics.join(', ') : 'Conversation memory')}
                    </div>
                    {m.insights.length > 0 && (
                      <div className="mt-0.5 truncate text-[11px] text-white/45">{m.insights[0]}</div>
                    )}
                    <div className="mt-0.5 flex flex-wrap items-center gap-1 text-[10px] text-cyan-300/40">
                      {m.kind === 'conversation_memory_hyper' && (
                        <span className="rounded-full border border-fuchsia-400/25 bg-fuchsia-400/10 px-1.5 py-0.5 text-fuchsia-200/80">
                          hyper
                        </span>
                      )}
                      {when && <span>{when}</span>}
                    </div>
                  </div>
                  <div className="flex shrink-0 items-center gap-1">
                    <button
                      type="button"
                      onClick={() => runRowAction('pin', m)}
                      disabled={pending}
                      aria-label={m.pinned ? `Unpin ${m.title || 'memory'}` : `Pin ${m.title || 'memory'}`}
                      title={m.pinned ? 'Unpin' : 'Pin'}
                      className="grid h-6 w-6 place-items-center rounded-md text-cyan-200/70 hover:bg-white/10 disabled:opacity-40"
                    >
                      {pending ? (
                        <Loader2 className="h-3.5 w-3.5 animate-spin" />
                      ) : m.pinned ? (
                        <Pin className="h-3.5 w-3.5 text-amber-300" />
                      ) : (
                        <PinOff className="h-3.5 w-3.5" />
                      )}
                    </button>
                    <button
                      type="button"
                      onClick={() => runRowAction('forget', m)}
                      disabled={pending}
                      aria-label={`Forget ${m.title || 'memory'}`}
                      title="Forget"
                      className="grid h-6 w-6 place-items-center rounded-md text-rose-300/70 hover:bg-rose-400/10 disabled:opacity-40"
                    >
                      <Trash2 className="h-3.5 w-3.5" />
                    </button>
                  </div>
                </div>
                {rowError && (
                  <div
                    data-testid={`ck-memory-row-error-${m.id}`}
                    className="mt-1 text-[10px] text-rose-300/80"
                  >
                    {rowError}
                  </div>
                )}
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}

export default ConKayMemoryPanel;
