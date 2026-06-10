'use client';

// POLISH_AUDIT T3.2 + D5 — interactive scheme barge-in.
//
// The scheme-overhear-cycle emits `scheme:overheard` (to user:{id}) with a
// snippet + scheme id whenever the player drifts within earshot of an active
// plot — but until now NO client listened, so the player could never act on it.
// This surfaces an actionable prompt and drives the three real intervene
// branches on /api/worlds/:worldId/schemes/:id/intervene:
//   - Expose    — surface the evidence (may flip the plot to 'exposed').
//   - Blackmail — spend a CK3 hook you hold over the plotter to force the plot
//                 to collapse (D5). Hidden when you hold no leverage.
//   - Ignore    — walk away.
//
// Proximity-gated server-side (you must be within 30m to expose/abet/blackmail).

import { useCallback, useEffect, useState } from 'react';
import { Ear, X, ShieldAlert, KeyRound } from 'lucide-react';
import { subscribe } from '@/lib/realtime/socket';

interface OverheardEvent {
  schemeId: string;
  plotterId: string;
  worldId: string;
  snippet?: string;
  plotterArchetype?: string | null;
  plotterFaction?: string | null;
  schemeKind?: string | null;
}

export function SchemeOverhearBargeIn() {
  const [ev, setEv] = useState<OverheardEvent | null>(null);
  const [canBlackmail, setCanBlackmail] = useState(false);
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<string | null>(null);

  useEffect(() => {
    const off = subscribe<OverheardEvent>('scheme:overheard', (msg) => {
      if (!msg?.schemeId) return;
      setEv(msg);
      setResult(null);
      // Do we hold leverage over the plotter? (enables the Blackmail branch)
      fetch(`/api/npc/${msg.plotterId}/hooks`, { credentials: 'include' })
        .then((r) => r.json())
        .then((j) => setCanBlackmail(!!j?.hooks?.playerHolds))
        .catch(() => setCanBlackmail(false));
    });
    return off;
  }, []);

  const act = useCallback(async (action: 'expose' | 'blackmail' | 'ignore') => {
    if (!ev) return;
    if (action === 'ignore') { setEv(null); return; }
    setBusy(true);
    try {
      const r = await fetch(`/api/worlds/${ev.worldId}/schemes/${ev.schemeId}/intervene`, {
        method: 'POST', credentials: 'include',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ action }),
      });
      const j = await r.json();
      if (!j?.ok) {
        setResult(
          j?.reason === 'no_hook' ? 'You hold no leverage over them.'
          : j?.error === 'too_far' ? 'Move closer to intervene.'
          : 'You couldn’t act on it.',
        );
      } else if (action === 'expose') {
        setResult(j.exposed ? 'You exposed the plot.' : 'You called it out.');
        setTimeout(() => setEv(null), 1800);
      } else if (action === 'blackmail') {
        setResult('You forced them to abandon it.');
        setTimeout(() => setEv(null), 1800);
      }
    } catch {
      setResult('Network error.');
    } finally { setBusy(false); }
  }, [ev]);

  if (!ev) return null;

  return (
    <div className="concordia-hud-fade fixed bottom-40 left-1/2 z-40 w-80 -translate-x-1/2 rounded-lg border border-purple-500/50 bg-zinc-950/95 p-3 shadow-2xl backdrop-blur">
      <div className="mb-1 flex items-center justify-between">
        <span className="flex items-center gap-1 text-[10px] uppercase tracking-wider text-purple-300">
          <Ear size={12} /> Overheard
        </span>
        <button aria-label="Close" onClick={() => setEv(null)} className="rounded p-0.5 text-zinc-500 hover:bg-zinc-800"><X size={12} /></button>
      </div>
      <p className="mb-2 text-xs italic text-purple-100">
        “{ev.snippet || 'whispers of a plot in motion…'}”
      </p>
      {ev.plotterFaction && (
        <p className="mb-2 text-[10px] text-zinc-500">{ev.plotterArchetype || 'someone'} · {ev.plotterFaction}{ev.schemeKind ? ` · ${ev.schemeKind}` : ''}</p>
      )}
      {result ? (
        <p className="py-1 text-center text-[11px] text-emerald-300">{result}</p>
      ) : (
        <div className="flex gap-1.5">
          <button disabled={busy} onClick={() => act('expose')}
            className="flex flex-1 items-center justify-center gap-1 rounded bg-amber-600/80 px-2 py-1 text-[11px] font-medium text-amber-50 hover:bg-amber-500 disabled:opacity-50">
            <ShieldAlert size={12} /> Expose
          </button>
          {canBlackmail && (
            <button disabled={busy} onClick={() => act('blackmail')}
              className="flex flex-1 items-center justify-center gap-1 rounded bg-purple-600/80 px-2 py-1 text-[11px] font-medium text-purple-50 hover:bg-purple-500 disabled:opacity-50">
              <KeyRound size={12} /> Blackmail
            </button>
          )}
          <button disabled={busy} onClick={() => act('ignore')}
            className="flex-1 rounded bg-zinc-800 px-2 py-1 text-[11px] text-zinc-300 hover:bg-zinc-700 disabled:opacity-50">
            Ignore
          </button>
        </div>
      )}
    </div>
  );
}
