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
  // FIX-death-insurance-011: the handshake response is a consequential
  // choice, so Accept / Decline (and reversing either) arm a confirm
  // step that shows the terms first; nothing is sent until confirmed.
  const [confirming, setConfirming] = useState<boolean | null>(null);
  const mine = pact.myShare;
  const myPayout = mine ? Math.round((mine.sharePct / 100) * pact.payoutSparks) : 0;

  const respond = async (accept: boolean) => {
    setBusy(true);
    const r = await lensRun('insurance', 'pact-respond', { pactId: pact.id, accept });
    if (r.data?.ok) onChanged();
    setBusy(false);
    setConfirming(null);
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

      {needsResponse && confirming === null && (
        <div className="mt-3 flex items-center gap-2 border-t border-white/5 pt-2">
          <span className="text-[11px] text-zinc-400">Accept this inheritance pact?</span>
          <button
            type="button"
            disabled={busy}
            onClick={() => setConfirming(true)}
            className="flex items-center gap-1 rounded bg-emerald-800 px-2 py-1 text-[11px] text-white hover:bg-emerald-700 disabled:opacity-50"
          >
            <Check className="h-3 w-3" /> Accept
          </button>
          <button
            type="button"
            disabled={busy}
            onClick={() => setConfirming(false)}
            className="flex items-center gap-1 rounded bg-rose-900 px-2 py-1 text-[11px] text-rose-200 hover:bg-rose-800 disabled:opacity-50"
          >
            <X className="h-3 w-3" /> Decline
          </button>
        </div>
      )}

      {!needsResponse && pact.requireHandshake && mine?.respondedAt != null && pact.status === 'active' && confirming === null && (
        <button
          type="button"
          disabled={busy}
          onClick={() => setConfirming(!mine.accepted)}
          className="mt-2 text-[11px] text-cyan-400 hover:text-cyan-300"
        >
          {mine.accepted ? 'Withdraw acceptance' : 'Accept after all'}
        </button>
      )}

      {confirming !== null && mine && (
        <div className="mt-3 border-t border-white/5 pt-2" role="group" aria-label={confirming ? 'Confirm acceptance' : 'Confirm decline'}>
          <p className="text-[11px] font-medium text-zinc-200">
            {confirming ? 'Accept your share of this pact?' : 'Decline your share of this pact?'}
          </p>
          <p className="mt-1 text-[11px] text-zinc-400">
            Your share: {mine.sharePct}% of {pact.payoutSparks} ⚡ = {myPayout} ⚡ · insured{' '}
            {pact.insuredUserId.slice(0, 16)} · expires {fmtDate(pact.expiresAt)}
          </p>
          <p className="mt-1 text-[11px] text-zinc-400">
            {confirming
              ? 'Accepting records your acceptance of these terms. You can withdraw while the pact stays active.'
              : 'Declining gives up your share for now. You can accept after all while the pact stays active.'}
          </p>
          <div className="mt-2 flex items-center gap-2">
            <button
              type="button"
              disabled={busy}
              onClick={() => respond(confirming)}
              className={`flex items-center gap-1 rounded px-2 py-1 text-[11px] disabled:opacity-50 ${
                confirming
                  ? 'bg-emerald-800 text-white hover:bg-emerald-700'
                  : 'bg-rose-900 text-rose-200 hover:bg-rose-800'
              }`}
            >
              {confirming ? <Check className="h-3 w-3" /> : <X className="h-3 w-3" />}
              {confirming ? 'Confirm accept' : 'Confirm decline'}
            </button>
            <button
              type="button"
              disabled={busy}
              onClick={() => setConfirming(null)}
              className="rounded px-2 py-1 text-[11px] text-zinc-400 hover:text-zinc-200"
            >
              Keep deciding
            </button>
          </div>
        </div>
      )}
    </li>
  );
}
