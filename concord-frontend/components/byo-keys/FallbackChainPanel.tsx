'use client';

/**
 * FallbackChainPanel — per-slot ordered fallback chains. If the primary
 * key for a slot fails, Concord routes the inference through the next
 * active slot in the chain. Reads byo_keys.list_fallbacks, writes via
 * byo_keys.set_fallback.
 */

import { useEffect, useState, useCallback } from 'react';
import { lensRun } from '@/lib/api/client';

const SLOTS = ['conscious', 'subconscious', 'utility', 'repair', 'vision'];

export function FallbackChainPanel() {
  const [chains, setChains] = useState<Record<string, string[]>>({});
  const [editing, setEditing] = useState<string | null>(null);
  const [draft, setDraft] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);

  const refresh = useCallback(async () => {
    const r = await lensRun<{ chains: Record<string, string[]> }>('byo_keys', 'list_fallbacks', {});
    if (r.data?.ok && r.data.result) setChains(r.data.result.chains || {});
  }, []);

  useEffect(() => { refresh(); }, [refresh]);

  const startEdit = (slot: string) => {
    setEditing(slot);
    setDraft(chains[slot] ? [...chains[slot]] : []);
  };

  const save = async (slot: string) => {
    setBusy(true);
    await lensRun('byo_keys', 'set_fallback', { slot, chain: draft });
    setBusy(false);
    setEditing(null);
    refresh();
  };

  const toggleInDraft = (slot: string, candidate: string) => {
    setDraft((d) => (d.includes(candidate) ? d.filter((x) => x !== candidate) : [...d, candidate]));
  };

  const move = (idx: number, dir: -1 | 1) => {
    setDraft((d) => {
      const next = [...d];
      const j = idx + dir;
      if (j < 0 || j >= next.length) return d;
      [next[idx], next[j]] = [next[j], next[idx]];
      return next;
    });
  };

  return (
    <section className="rounded-xl bg-zinc-900/60 ring-1 ring-zinc-800 p-4 sm:p-6">
      <h2 className="text-sm font-semibold text-zinc-100 mb-1">Fallback routing</h2>
      <p className="text-[11px] text-zinc-500 mb-3">
        If a slot&apos;s primary key fails (rate limit, outage, bad key), Concord retries through
        the next <em>active</em> slot in its chain — in order.
      </p>

      <ul className="space-y-2">
        {SLOTS.map((slot) => {
          const chain = chains[slot] || [];
          const isEditing = editing === slot;
          return (
            <li key={slot} className="rounded-lg bg-zinc-950 ring-1 ring-zinc-800 p-3">
              <div className="flex items-center justify-between gap-3">
                <div className="flex-1 min-w-0">
                  <span className="font-mono text-xs text-zinc-300">{slot}</span>
                  {!isEditing && (
                    <span className="text-[11px] text-zinc-500 ml-2">
                      {chain.length > 0 ? (
                        <>→ {chain.join(' → ')}</>
                      ) : (
                        <span className="text-zinc-600">no fallback configured</span>
                      )}
                    </span>
                  )}
                </div>
                <button
                  onClick={() => (isEditing ? setEditing(null) : startEdit(slot))}
                  className="px-2 py-1 rounded-md text-[11px] bg-zinc-800 hover:bg-zinc-700 text-zinc-200 shrink-0"
                >
                  {isEditing ? 'cancel' : chain.length ? 'edit chain' : 'set chain'}
                </button>
              </div>

              {isEditing && (
                <div className="mt-3 border-t border-zinc-800 pt-3">
                  {draft.length > 0 && (
                    <div className="mb-2 space-y-1">
                      <div className="text-[10px] uppercase tracking-wide text-zinc-500">Chain order</div>
                      {draft.map((s, i) => (
                        <div key={s} className="flex items-center gap-2 text-xs">
                          <span className="font-mono text-zinc-600 w-4">{i + 1}.</span>
                          <span className="font-mono text-zinc-300 flex-1">{s}</span>
                          <button
                            onClick={() => move(i, -1)}
                            disabled={i === 0}
                            className="px-1.5 rounded bg-zinc-800 hover:bg-zinc-700 text-zinc-300 disabled:opacity-30"
                          >↑</button>
                          <button
                            onClick={() => move(i, 1)}
                            disabled={i === draft.length - 1}
                            className="px-1.5 rounded bg-zinc-800 hover:bg-zinc-700 text-zinc-300 disabled:opacity-30"
                          >↓</button>
                          <button
                            onClick={() => toggleInDraft(slot, s)}
                            className="px-1.5 rounded bg-zinc-800 hover:bg-red-900/50 text-zinc-400"
                          >×</button>
                        </div>
                      ))}
                    </div>
                  )}
                  <div className="text-[10px] uppercase tracking-wide text-zinc-500 mb-1">Add slot</div>
                  <div className="flex flex-wrap gap-1.5">
                    {SLOTS.filter((s) => s !== slot && !draft.includes(s)).map((s) => (
                      <button
                        key={s}
                        onClick={() => toggleInDraft(slot, s)}
                        className="px-2 py-1 rounded-md text-[11px] bg-zinc-800 hover:bg-zinc-700 text-zinc-300 font-mono"
                      >
                        + {s}
                      </button>
                    ))}
                  </div>
                  <button
                    onClick={() => save(slot)}
                    disabled={busy}
                    className="mt-3 px-3 py-1 rounded-md bg-amber-600 hover:bg-amber-500 text-amber-50 text-xs font-medium disabled:opacity-50"
                  >
                    save chain
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
