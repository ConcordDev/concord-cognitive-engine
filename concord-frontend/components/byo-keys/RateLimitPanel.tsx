'use client';

/**
 * RateLimitPanel — per-slot requests-per-minute throttle (Wave 4
 * gap-closure, docs/lens-specs/byo-keys-capability-map.md item #9).
 *
 * Distinct from BudgetPanel's monthly USD/token *ceiling*: this is a
 * burst-rate *throttle* — a real continuous-refill token bucket
 * (server/lib/byo-rate-limit.js) that server/lib/byo-router.js#brainChat
 * consumes from on every outbound BYO-key inference call, BEFORE the key
 * is decrypted or the provider is contacted. A blocked call never
 * reaches the network — this panel's numbers are the same bucket state
 * the router itself just spent from, not a decorative estimate.
 *
 * Reads byo_keys.rate_limit_status, writes via byo_keys.rate_limit_set.
 */

import { useEffect, useState, useCallback, useRef } from 'react';
import { lensRun } from '@/lib/api/client';

interface RateLimitRow {
  slot: string;
  maxPerMinute: number;
  remaining: number;
  nextTokenInMs: number;
}

const SLOTS = ['conscious', 'subconscious', 'utility', 'repair', 'vision'];
const POLL_MS = 5000; // live refill visualization — see "Phase D first-draft constants"

function fmtCountdown(ms: number): string {
  if (ms <= 0) return '';
  const s = Math.ceil(ms / 1000);
  return s >= 60 ? `${Math.ceil(s / 60)}m` : `${s}s`;
}

export function RateLimitPanel() {
  const [rows, setRows] = useState<RateLimitRow[]>([]);
  const [editing, setEditing] = useState<string | null>(null);
  const [form, setForm] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const refresh = useCallback(async () => {
    const r = await lensRun<{ slots: RateLimitRow[] }>('byo_keys', 'rate_limit_status', {});
    if (r.data?.ok && r.data.result) {
      setRows(r.data.result.slots);
      setError(null);
    } else if (r.data && r.data.ok === false) {
      setError(String(r.data.error || 'failed to load rate limits'));
    }
  }, []);

  useEffect(() => {
    refresh();
    // Light auto-poll so a bucket visibly refills without a manual
    // click — the number is real derived backend state each tick, not
    // a client-side countdown fake (honest-by-construction: on every
    // poll we re-fetch, we never locally decrement/increment).
    pollRef.current = setInterval(refresh, POLL_MS);
    return () => { if (pollRef.current) clearInterval(pollRef.current); };
  }, [refresh]);

  const rowFor = (slot: string) => rows.find((r) => r.slot === slot);

  const startEdit = (slot: string) => {
    const r = rowFor(slot);
    setEditing(slot);
    setForm(r ? String(r.maxPerMinute) : '');
  };

  const save = async (slot: string) => {
    setBusy(true);
    const n = form.trim() === '' ? null : Number(form);
    await lensRun('byo_keys', 'rate_limit_set', { slot, maxPerMinute: n });
    setBusy(false);
    setEditing(null);
    refresh();
  };

  const clear = async (slot: string) => {
    await lensRun('byo_keys', 'rate_limit_set', { slot, maxPerMinute: null });
    refresh();
  };

  return (
    <section
      data-testid="ratelimit-panel"
      className="rounded-xl bg-zinc-900/60 ring-1 ring-zinc-800 p-4 sm:p-6"
    >
      <div className="flex items-center justify-between gap-3 mb-3">
        <h2 className="text-sm font-semibold text-zinc-100">Rate limits</h2>
        <span className="text-[10px] text-zinc-500 font-mono">requests / min</span>
      </div>
      <p className="text-[11px] text-zinc-400 mb-3">
        A burst throttle, separate from the monthly budget cap above. When a slot&apos;s bucket
        is empty, Concord rejects the call before it ever reaches your provider — protects
        against a runaway loop hammering a paid API even while comfortably under budget.
      </p>

      {error && (
        <div className="mb-3 text-[11px] text-red-400" data-testid="ratelimit-error">{error}</div>
      )}

      <ul className="space-y-2">
        {SLOTS.map((slot) => {
          const r = rowFor(slot);
          const isEditing = editing === slot;
          const hasLimit = !!r;
          const fillPct = r ? Math.max(0, Math.min(100, Math.round((r.remaining / r.maxPerMinute) * 100))) : 0;
          const empty = !!r && r.remaining <= 0;
          return (
            <li
              key={slot}
              data-testid={`ratelimit-${slot}`}
              className="rounded-lg bg-zinc-950 ring-1 ring-zinc-800 p-3"
            >
              <div className="flex items-center justify-between gap-3">
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2">
                    <span className="font-mono text-xs text-zinc-300">{slot}</span>
                    {empty && (
                      <span
                        data-testid={`ratelimit-${slot}-throttled`}
                        className="rounded bg-red-500/15 px-1.5 py-0.5 text-[9px] font-mono text-red-300"
                      >
                        throttled
                      </span>
                    )}
                  </div>

                  {!isEditing && (
                    <div className="mt-1.5">
                      {hasLimit ? (
                        <>
                          <div className="flex items-center gap-2 text-[11px] text-zinc-400">
                            <span data-testid={`ratelimit-${slot}-count`}>
                              {r!.remaining} / {r!.maxPerMinute} available
                            </span>
                            {r!.nextTokenInMs > 0 && (
                              <span className="text-zinc-500" data-testid={`ratelimit-${slot}-next`}>
                                next in {fmtCountdown(r!.nextTokenInMs)}
                              </span>
                            )}
                          </div>
                          {/* Bucket capacity gauge — 10 discrete cells, honest-rounded from remaining/max. */}
                          <div
                            className="flex gap-0.5 mt-1.5"
                            role="meter"
                            aria-valuenow={r!.remaining}
                            aria-valuemax={r!.maxPerMinute}
                            data-testid={`ratelimit-${slot}-gauge`}
                          >
                            {Array.from({ length: 10 }).map((_, i) => {
                              const cellFilled = i < Math.round((fillPct / 100) * 10);
                              return (
                                <div
                                  key={i}
                                  className={`h-2 flex-1 rounded-sm ${
                                    cellFilled
                                      ? empty ? 'bg-red-500' : fillPct > 40 ? 'bg-emerald-500' : 'bg-amber-500'
                                      : 'bg-zinc-800'
                                  }`}
                                />
                              );
                            })}
                          </div>
                        </>
                      ) : (
                        <span className="text-[11px] text-zinc-400">unrestricted — no throttle set</span>
                      )}
                    </div>
                  )}
                </div>

                <div className="flex items-center gap-2 shrink-0">
                  <button
                    onClick={() => (isEditing ? setEditing(null) : startEdit(slot))}
                    className="px-2 py-1 rounded-md text-[11px] bg-zinc-800 hover:bg-zinc-700 text-zinc-200"
                    data-testid={`ratelimit-${slot}-edit-btn`}
                  >
                    {isEditing ? 'cancel' : hasLimit ? 'edit' : 'set limit'}
                  </button>
                  {hasLimit && !isEditing && (
                    <button
                      onClick={() => clear(slot)}
                      className="px-2 py-1 rounded-md text-[11px] bg-zinc-800 hover:bg-red-900/50 text-zinc-400"
                      data-testid={`ratelimit-${slot}-clear-btn`}
                    >
                      clear
                    </button>
                  )}
                </div>
              </div>

              {isEditing && (
                <div className="mt-3 flex items-end gap-2 border-t border-zinc-800 pt-3">
                  <div className="flex-1">
                    <label className="block text-[10px] text-zinc-400 mb-1">Max requests / minute</label>
                    <input
                      type="number" min="1" step="1"
                      value={form}
                      onChange={(e) => setForm(e.target.value)}
                      placeholder="(unrestricted)"
                      className="w-full px-2 py-1 rounded-md bg-zinc-900 text-zinc-100 text-xs ring-1 ring-zinc-700 focus:ring-amber-500 focus:outline-none"
                      data-testid={`ratelimit-${slot}-input`}
                    />
                  </div>
                  <button
                    onClick={() => save(slot)}
                    disabled={busy}
                    className="px-3 py-1 rounded-md bg-amber-600 hover:bg-amber-500 text-amber-50 text-xs font-medium disabled:opacity-50"
                    data-testid={`ratelimit-${slot}-save-btn`}
                  >
                    save
                  </button>
                </div>
              )}
            </li>
          );
        })}
      </ul>
    </section>
  );
}
