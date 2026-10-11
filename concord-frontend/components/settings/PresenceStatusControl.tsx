'use client';

/**
 * Presence status — a real, user-controlled activity status, distinct from
 * the ghost / appear-offline toggle. Applied immediately on click. Server
 * state is in-memory and resets to "available" on reconnect, so the
 * localStorage copy is only the last choice, re-applied the next time a
 * world socket connects. It is not itself the live authoritative state.
 */

import { useCallback, useRef, useState } from 'react';
import { emit, subscribe } from '@/lib/realtime/socket';

const PRESENCE_STATUS_STORAGE_KEY = 'concord:presenceStatus';
const PRESENCE_STATUS_APPLY_TIMEOUT_MS = 1500;

type PresenceStatus = 'available' | 'away' | 'busy' | 'dnd';
const PRESENCE_STATUS_OPTIONS: { value: PresenceStatus; label: string; dot: string }[] = [
  { value: 'available', label: 'Available', dot: 'bg-emerald-400' },
  { value: 'away', label: 'Away', dot: 'bg-amber-400' },
  { value: 'busy', label: 'Busy', dot: 'bg-orange-500' },
  { value: 'dnd', label: 'Do Not Disturb', dot: 'bg-rose-500' },
];

function loadPresenceStatus(): PresenceStatus {
  if (typeof window === 'undefined') return 'available';
  try {
    const raw = localStorage.getItem(PRESENCE_STATUS_STORAGE_KEY);
    return (PRESENCE_STATUS_OPTIONS.some((o) => o.value === raw) ? raw : 'available') as PresenceStatus;
  } catch {
    return 'available';
  }
}

function applyLivePresenceStatus(status: PresenceStatus): Promise<{ applied: boolean; note: string }> {
  return new Promise((resolve) => {
    let settled = false;
    const finish = (result: { applied: boolean; note: string }) => {
      if (settled) return;
      settled = true;
      offAck();
      offNack();
      clearTimeout(timer);
      resolve(result);
    };
    const offAck = subscribe<{ status: string }>('player:presence-status:ack', () => {
      finish({ applied: true, note: `Status set to ${status}.` });
    });
    const offNack = subscribe<{ reason: string }>('player:presence-status:nack', (data) => {
      finish({ applied: false, note: `Could not apply status live (${data?.reason || 'unknown'}). Saved for next time.` });
    });
    const timer = setTimeout(() => {
      finish({ applied: false, note: 'Not connected to a world right now — status saved for next time you play.' });
    }, PRESENCE_STATUS_APPLY_TIMEOUT_MS);
    emit('player:presence-status', { status });
  });
}

export function PresenceStatusControl() {
  const [presenceStatus, setPresenceStatus] = useState<PresenceStatus>(loadPresenceStatus);
  const [presenceNote, setPresenceNote] = useState<string | null>(null);
  const applyingPresenceRef = useRef(false);

  const handlePresenceStatusChange = useCallback((next: PresenceStatus) => {
    if (applyingPresenceRef.current || next === presenceStatus) return;
    applyingPresenceRef.current = true;
    setPresenceStatus(next);
    try { localStorage.setItem(PRESENCE_STATUS_STORAGE_KEY, next); } catch { /* best-effort */ }
    setPresenceNote('Applying status…');
    applyLivePresenceStatus(next).then(({ note }) => {
      applyingPresenceRef.current = false;
      setPresenceNote(note);
    });
  }, [presenceStatus]);

  return (
    <section
      className="rounded-xl border border-white/10 bg-zinc-950/40 p-4"
      aria-labelledby="presence-status-heading"
    >
      <header className="mb-3">
        <h2 id="presence-status-heading" className="text-base font-semibold text-zinc-100">
          Presence Status
        </h2>
        <p className="text-xs text-zinc-400">
          Shown to players near you and to your party. World visibility is separate:
          that toggle decides whether you can be seen at all.
        </p>
      </header>
      <div className="flex flex-wrap gap-2" role="group" aria-label="Presence status">
        {PRESENCE_STATUS_OPTIONS.map((opt) => (
          <button
            key={opt.value}
            type="button"
            aria-pressed={presenceStatus === opt.value}
            onClick={() => handlePresenceStatusChange(opt.value)}
            className={`flex items-center gap-2 rounded-md border px-3 py-1.5 text-xs font-medium transition-colors ${
              presenceStatus === opt.value
                ? 'border-teal-500/60 bg-teal-950/50 text-teal-100'
                : 'border-zinc-700/50 bg-zinc-900/40 text-zinc-300 hover:border-zinc-600'
            }`}
          >
            <span className={`h-2 w-2 rounded-full ${opt.dot}`} aria-hidden="true" />
            {opt.label}
          </button>
        ))}
      </div>
      {presenceNote && (
        <div role="status" className="mt-3 rounded-md border border-teal-700/40 bg-teal-950/30 px-3 py-2 text-xs text-teal-100">
          {presenceNote}
        </div>
      )}
    </section>
  );
}
