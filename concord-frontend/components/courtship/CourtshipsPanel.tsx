'use client';

import { useState } from 'react';
import { Icon as SvgIcon } from '@/components/icons/Icon';
import { RecipientSearchInput } from '@/components/message/RecipientSearchInput';
import type { useCourtshipDesk } from './useCourtshipDesk';

type Desk = ReturnType<typeof useCourtshipDesk>;

/** Propose stays available on an estranged courtship once affinity is high enough to reconcile. Widowed does not. */
export function courtshipActions(
  status: string | undefined,
  affinity: number,
  engageThreshold: number,
  marryThreshold: number,
  engagePct: number,
): { canPropose: boolean; canWed: boolean; hint: string | null } {
  const canPropose = affinity >= engageThreshold
    && status !== 'engaged' && status !== 'married' && status !== 'widowed';
  const canWed = status === 'engaged' && affinity >= marryThreshold;
  if (canPropose || status === 'engaged' || status === 'married') {
    return { canPropose, canWed, hint: null };
  }
  if (status === 'estranged') {
    return { canPropose, canWed, hint: `This courtship is estranged. Affinity has to reach ${engagePct}% before you can propose again.` };
  }
  if (status === 'widowed') {
    return { canPropose, canWed, hint: 'This courtship ended.' };
  }
  return { canPropose, canWed, hint: `Reach ${engagePct}% affinity to propose.` };
}

export function CourtshipsPanel({ desk }: { desk: Desk }) {
  const {
    courtships, pending, engageThreshold, marryThreshold, engagePct,
    interact, propose, wed, startCourtship,
  } = desk;
  // FIX-courtship-001: the start form — pick a player (resolved to a
  // real account) or name an NPC met in the world, and Begin performs
  // the first interaction that creates the courtship.
  const [startOpen, setStartOpen] = useState(false);
  const [startKind, setStartKind] = useState<'player' | 'npc'>('player');
  const [startPartner, setStartPartner] = useState('');
  const [startError, setStartError] = useState<string | null>(null);

  const begin = async () => {
    if (!startPartner.trim()) {
      setStartError(startKind === 'player'
        ? 'Pick a player first — search by username and choose them from the list.'
        : "Enter the NPC's id first — it's the name the world shows for them.");
      return;
    }
    setStartError(null);
    await startCourtship(startKind, startPartner);
    setStartPartner('');
    setStartOpen(false);
  };

  return (
    <section className="space-y-2" aria-labelledby="courtships-heading">
      <h2 id="courtships-heading" className="flex items-center gap-1 text-sm font-semibold text-pink-300">
        <SvgIcon name="heart" size={14} className="text-pink-300" /> Active courtships ({courtships.length})
      </h2>
      <div>
        <button
          type="button"
          aria-expanded={startOpen}
          onClick={() => setStartOpen((v) => !v)}
          className="rounded bg-pink-500/30 px-2 py-1 text-[10px] text-pink-100 hover:bg-pink-500/50"
        >
          Start a courtship
        </button>
        {startOpen && (
          <div className="mt-2 space-y-2 rounded-lg border border-pink-500/30 bg-zinc-900/50 p-3">
            <div className="flex gap-1" role="group" aria-label="Partner kind">
              <button
                type="button"
                aria-pressed={startKind === 'player'}
                onClick={() => { setStartKind('player'); setStartPartner(''); setStartError(null); }}
                className={startKind === 'player' ? 'rounded bg-pink-500/40 px-2 py-1 text-[10px] text-pink-50' : 'rounded bg-zinc-800 px-2 py-1 text-[10px] text-zinc-300'}
              >
                A player
              </button>
              <button
                type="button"
                aria-pressed={startKind === 'npc'}
                onClick={() => { setStartKind('npc'); setStartPartner(''); setStartError(null); }}
                className={startKind === 'npc' ? 'rounded bg-pink-500/40 px-2 py-1 text-[10px] text-pink-50' : 'rounded bg-zinc-800 px-2 py-1 text-[10px] text-zinc-300'}
              >
                An NPC
              </button>
            </div>
            {startKind === 'player' ? (
              <RecipientSearchInput value={startPartner} onChange={setStartPartner} inputId="courtship-start-player" />
            ) : (
              <input
                type="text"
                aria-label="NPC id"
                value={startPartner}
                onChange={(e) => setStartPartner(e.target.value)}
                placeholder="NPC id — the name the world shows for them"
                className="block w-full rounded-md border border-zinc-700 bg-zinc-900 px-2 py-1 text-[12px] text-zinc-100 outline-none focus:border-pink-400"
              />
            )}
            {startError && <p role="alert" className="text-[11px] text-rose-300">{startError}</p>}
            <button
              type="button"
              onClick={() => void begin()}
              disabled={pending}
              className="rounded bg-pink-500/40 px-2 py-1 text-[10px] font-medium text-pink-50 hover:bg-pink-500/60 disabled:opacity-50"
            >
              Begin courtship
            </button>
          </div>
        )}
      </div>
      {!Array.isArray(courtships) || courtships.length === 0 ? (
        <p data-testid="courtship-empty" className="text-xs text-zinc-500">
          No active courtships yet. Start one above — with a player, or with an NPC you&apos;ve
          met in the world — then track affinity, propose, and wed here.
        </p>
      ) : (
        <ul data-testid="courtship-list" className="space-y-2">
          {courtships.map((c) => {
            const partnerId = String(c?.partner_id ?? '');
            const affinity = Number(c?.affinity || 0);
            const pct = Math.round(affinity * 100);
            const { canPropose, canWed, hint } = courtshipActions(
              c.status, affinity, engageThreshold, marryThreshold, engagePct,
            );
            return (
              <li key={`${c.partner_kind}:${partnerId || 'unknown'}`} className="rounded-lg border border-pink-500/30 bg-zinc-900/50 p-3">
                <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between sm:gap-3">
                  <div>
                    <div className="font-mono text-sm text-pink-100">{c.partner_kind}:{partnerId.slice(0, 14)}</div>
                    <div className="text-[10px] text-pink-300/60">status: {c.status}</div>
                  </div>
                  <div className="font-mono text-base text-pink-200" aria-label={`affinity ${pct} percent`}>{pct}%</div>
                </div>
                <div
                  className="mt-2 h-1 overflow-hidden rounded bg-zinc-800"
                  role="progressbar"
                  aria-valuenow={pct}
                  aria-valuemin={-100}
                  aria-valuemax={100}
                >
                  <div className="h-full bg-pink-500 transition-all" style={{ width: `${Math.max(0, pct)}%` }} />
                </div>
                <div className="mt-2 flex flex-col gap-1 sm:flex-row">
                  <button type="button" aria-label={`Interact positively with ${c.partner_id}`} onClick={() => interact(c, 1)} disabled={pending} className="flex-1 rounded bg-pink-500/30 px-2 py-1 text-[10px] text-pink-100 hover:bg-pink-500/50 disabled:opacity-50">
                    Interact (+)
                  </button>
                  {canPropose && (
                    <button type="button" aria-label={`Propose to ${c.partner_id}`} onClick={() => propose(c)} disabled={pending} className="rounded bg-amber-500/40 px-2 py-1 text-[10px] text-amber-100 hover:bg-amber-500/60 disabled:opacity-50">
                      Propose
                    </button>
                  )}
                  {canWed && (
                    <button type="button" aria-label={`Wed ${c.partner_id}`} onClick={() => wed(c)} disabled={pending} className="rounded bg-amber-500/50 px-2 py-1 text-[10px] font-bold text-amber-50 hover:bg-amber-500/70 disabled:opacity-50">
                      ⚭ Wed
                    </button>
                  )}
                </div>
                {hint && (
                  <p className="mt-1 text-[10px] text-zinc-500">{hint}</p>
                )}
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}
