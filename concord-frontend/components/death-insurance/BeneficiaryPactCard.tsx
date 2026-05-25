'use client';

/**
 * BeneficiaryPactCard — a pact where the caller is named beneficiary.
 * Surfaces the acceptance handshake (accept / decline) and the caller's
 * own share. No mutation other than the handshake response.
 */

import { useState } from 'react';
import { Check, X, Gift } from 'lucide-react';
import { lensRun } from '@/lib/api/client';
import type { Pact } from './types';

interface BeneficiaryPactCardProps {
  pact: Pact;
  onChanged: () => void;
}

function fmtDate(unixSec: number): string {
  return new Date(unixSec * 1000).toLocaleDateString();
}

export function BeneficiaryPactCard({ pact, onChanged }: BeneficiaryPactCardProps) {
  const [busy, setBusy] = useState(false);
  const mine = pact.myShare;
  const myPayout = mine ? Math.round((mine.sharePct / 100) * pact.payoutSparks) : 0;

  const respond = async (accept: boolean) => {
    setBusy(true);
    const r = await lensRun('insurance', 'pact-respond', { pactId: pact.id, accept });
    if (r.data?.ok) onChanged();
    setBusy(false);
  };

  const needsResponse =
    pact.requireHandshake && mine && !mine.accepted && mine.respondedAt == null && pact.status === 'active';

  return (
    <li className="rounded-lg border border-zinc-700/50 bg-zinc-900/80 p-3 text-xs">
      <div className="flex items-start justify-between gap-3">
        <div>
          <p className="flex items-center gap-1 font-semibold text-zinc-100">
            <Gift className="h-3.5 w-3.5 text-amber-400" />
            {myPayout} ⚡ ← {pact.insuredUserId.slice(0, 16)}
          </p>
          <p className="mt-0.5 font-mono text-[10px] text-zinc-400">
            {mine ? `${mine.sharePct}% of ${pact.payoutSparks} ⚡` : ''} · expires{' '}
            {fmtDate(pact.expiresAt)} · {pact.status}
          </p>
        </div>
        {pact.requireHandshake && mine && (
          <span
            className={`rounded px-2 py-0.5 text-[10px] font-bold uppercase tracking-wider ${
              mine.accepted
                ? 'bg-emerald-950/40 text-emerald-300'
                : mine.respondedAt
                  ? 'bg-rose-950/40 text-rose-300'
                  : 'bg-amber-950/40 text-amber-300'
            }`}
          >
            {mine.accepted ? 'accepted' : mine.respondedAt ? 'declined' : 'pending'}
          </span>
        )}
      </div>

      {needsResponse && (
        <div className="mt-3 flex items-center gap-2 border-t border-white/5 pt-2">
          <span className="text-[11px] text-zinc-400">Accept this inheritance pact?</span>
          <button
            type="button"
            disabled={busy}
            onClick={() => respond(true)}
            className="flex items-center gap-1 rounded bg-emerald-800 px-2 py-1 text-[11px] text-white hover:bg-emerald-700 disabled:opacity-50"
          >
            <Check className="h-3 w-3" /> Accept
          </button>
          <button
            type="button"
            disabled={busy}
            onClick={() => respond(false)}
            className="flex items-center gap-1 rounded bg-rose-900 px-2 py-1 text-[11px] text-rose-200 hover:bg-rose-800 disabled:opacity-50"
          >
            <X className="h-3 w-3" /> Decline
          </button>
        </div>
      )}

      {!needsResponse && pact.requireHandshake && mine?.respondedAt != null && pact.status === 'active' && (
        <button
          type="button"
          disabled={busy}
          onClick={() => respond(!mine.accepted)}
          className="mt-2 text-[11px] text-cyan-400 hover:text-cyan-300"
        >
          {mine.accepted ? 'Withdraw acceptance' : 'Accept after all'}
        </button>
      )}
    </li>
  );
}
