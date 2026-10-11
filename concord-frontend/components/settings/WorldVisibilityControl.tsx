'use client';

/**
 * Ghost / appear-offline. The server's `player:visibility` handler is
 * in-memory and resets to visible on reconnect, so this control only
 * emits when the player changes the toggle and then presses Apply.
 * It does not render a volume or a graphics default, and it does not
 * write a settings preference — there is no saved visibility row to overwrite.
 */

import { useState } from 'react';
import { emit, subscribe } from '@/lib/realtime/socket';

const VISIBILITY_APPLY_TIMEOUT_MS = 1500;

export function applyLiveVisibility(hidden: boolean): Promise<{ applied: boolean; note: string }> {
  return new Promise((resolve) => {
    const mode = hidden ? 'hidden' : 'visible';
    let settled = false;
    const finish = (result: { applied: boolean; note: string }) => {
      if (settled) return;
      settled = true;
      offAck();
      offNack();
      clearTimeout(timer);
      resolve(result);
    };
    const offAck = subscribe<{ mode: string }>('player:visibility:ack', () => {
      finish({
        applied: true,
        note: hidden ? 'You are now hidden from other players.' : 'You are now visible to other players.',
      });
    });
    const offNack = subscribe<{ reason: string }>('player:visibility:nack', (data) => {
      finish({ applied: false, note: `Could not apply live visibility (${data?.reason || 'unknown'}). Preference saved for next time.` });
    });
    const timer = setTimeout(() => {
      finish({ applied: false, note: 'Not connected to a world right now — preference saved for next time you play.' });
    }, VISIBILITY_APPLY_TIMEOUT_MS);
    emit('player:visibility', { mode });
  });
}

export function WorldVisibilityControl() {
  const [visible, setVisible] = useState(true);
  const [draftVisible, setDraftVisible] = useState(true);
  const [note, setNote] = useState<string | null>(null);
  const [applying, setApplying] = useState(false);

  const apply = () => {
    if (applying || draftVisible === visible) return;
    setApplying(true);
    setNote('Applying visibility change…');
    const hidden = draftVisible === false;
    applyLiveVisibility(hidden).then(({ note: next }) => {
      setApplying(false);
      setVisible(draftVisible);
      setNote(next);
    });
  };

  return (
    <section className="rounded-xl border border-white/10 bg-zinc-950/40 p-4" aria-labelledby="world-visibility-heading">
      <h2 id="world-visibility-heading" className="text-sm font-semibold text-zinc-100">Privacy</h2>
      <p className="mt-1 text-xs text-zinc-400">
        World visibility is live presence, not a saved volume. It starts visible, which is what the server uses after a reconnect.
      </p>
      <div className="mt-3 flex items-center justify-between gap-3">
        <span className="text-sm text-zinc-200">World Visible to Others</span>
        <button
          type="button"
          aria-pressed={draftVisible}
          onClick={() => setDraftVisible((v) => !v)}
          className={`rounded border px-3 py-1 text-xs ${draftVisible ? 'border-teal-500/50 text-teal-100' : 'border-zinc-600 text-zinc-400'}`}
        >
          {draftVisible ? 'On' : 'Off'}
        </button>
      </div>
      <div className="mt-3 flex justify-end">
        <button
          type="button"
          onClick={apply}
          disabled={applying || draftVisible === visible}
          data-testid="visibility-apply"
          className="rounded bg-teal-400 px-3 py-1.5 text-sm font-medium text-black disabled:opacity-40"
        >
          Apply
        </button>
      </div>
      {note && (
        <div role="status" className="mt-3 rounded-md border border-teal-700/40 bg-teal-950/30 px-3 py-2 text-xs text-teal-100">
          {note}
        </div>
      )}
    </section>
  );
}
