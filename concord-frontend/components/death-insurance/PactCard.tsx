'use client';

/**
 * PactCard — a single pact the caller wrote. Surfaces multi-beneficiary
 * splits, renewal / auto-renew, recurring premium schedule, handshake
 * status and revoke. All actions hit real `insurance` macros.
 */

import { useState } from 'react';
import { RefreshCw, Wallet, Users, Ban, Repeat } from 'lucide-react';
import { lensRun } from '@/lib/api/client';
import type { Pact } from './types';

interface PactCardProps {
  pact: Pact;
  onChanged: () => void;
}

const STATUS_TONE: Record<Pact['status'], string> = {
  active: 'text-emerald-300 border-emerald-700/40 bg-emerald-950/30',
  expired: 'text-amber-300 border-amber-700/40 bg-amber-950/30',
  revoked: 'text-zinc-400 border-zinc-700/40 bg-zinc-900/40',
  fired: 'text-rose-300 border-rose-700/40 bg-rose-950/30',
};

function fmtDate(unixSec: number): string {
  return new Date(unixSec * 1000).toLocaleDateString();
}

export function PactCard({ pact, onChanged }: PactCardProps) {
  const [busy, setBusy] = useState(false);
  const [renewDays, setRenewDays] = useState(pact.durationDays);
  const [note, setNote] = useState<string | null>(null);

  const run = async (action: string, params: Record<string, unknown>, ok: string) => {
    setBusy(true);
    const r = await lensRun('insurance', action, params);
    if (r.data?.ok) {
      setNote(ok);
      onChanged();
    } else {
      setNote(r.data?.error || 'action failed');
    }
    setBusy(false);
    window.setTimeout(() => setNote(null), 5000);
  };

  const acceptedCount = pact.beneficiaries.filter((b) => b.accepted).length;

  return (
    <li className={`rounded-lg border p-3 text-xs ${STATUS_TONE[pact.status]}`}>
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="font-semibold text-zinc-100">{pact.payoutSparks} ⚡ payout</p>
          <p className="mt-0.5 font-mono text-[10px] text-zinc-400">
            {pact.id} · written {fmtDate(pact.writtenAt)} · expires {fmtDate(pact.expiresAt)}
          </p>
        </div>
        <span className="rounded px-2 py-0.5 text-[10px] font-bold uppercase tracking-wider">
          {pact.status}
        </span>
      </div>

      <ul className="mt-2 space-y-1">
        {pact.beneficiaries.map((b) => (
          <li key={b.userId} className="flex items-center justify-between gap-2 text-[11px]">
            <span className="flex items-center gap-1 text-zinc-200">
              <Users className="h-3 w-3 text-zinc-400" />
              {b.userId.slice(0, 16)}
            </span>
            <span className="text-zinc-400">
              {b.sharePct}% ·{' '}
              {pact.requireHandshake ? (
                <span className={b.accepted ? 'text-emerald-400' : 'text-amber-400'}>
                  {b.accepted ? 'accepted' : 'pending'}
                </span>
              ) : (
                <span className="text-zinc-400">no handshake</span>
              )}
            </span>
          </li>
        ))}
      </ul>

      <div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-0.5 font-mono text-[10px] text-zinc-400">
        <span>
          premium {pact.premiumSparks} ⚡ {pact.premiumFrequency}
        </span>
        <span>paid {pact.premiumPaidSparks} ⚡</span>
        {pact.autoRenew && (
          <span className="flex items-center gap-0.5 text-cyan-400">
            <Repeat className="h-3 w-3" /> auto-renew
          </span>
        )}
        {pact.renewCount > 0 && <span>renewed ×{pact.renewCount}</span>}
        {pact.requireHandshake && (
          <span>
            handshake {acceptedCount}/{pact.beneficiaries.length}
          </span>
        )}
        {pact.nextPremiumDueAt != null && pact.status === 'active' && (
          <span>next premium {fmtDate(pact.nextPremiumDueAt)}</span>
        )}
      </div>

      {note && <p className="mt-2 text-[11px] text-cyan-300">{note}</p>}

      {(pact.status === 'active' || pact.status === 'expired') && (
        <div className="mt-3 flex flex-wrap items-center gap-2 border-t border-white/5 pt-2">
          <div className="flex items-center gap-1">
            <input
              type="number"
              min={1}
              value={renewDays}
              onChange={(e) => setRenewDays(Math.max(1, Number(e.target.value) || 1))}
              className="w-16 rounded border border-zinc-700 bg-zinc-950 px-1.5 py-1 text-[11px] text-zinc-100"
              aria-label="Renewal days"
            />
            <button
              type="button"
              disabled={busy}
              onClick={() => run('pact-renew', { pactId: pact.id, durationDays: renewDays }, 'Pact renewed.')}
              className="flex items-center gap-1 rounded bg-cyan-800 px-2 py-1 text-[11px] text-white hover:bg-cyan-700 disabled:opacity-50"
            >
              <RefreshCw className="h-3 w-3" /> Renew
            </button>
          </div>
          <button
            type="button"
            disabled={busy}
            onClick={() =>
              run(
                'pact-set-auto-renew',
                { pactId: pact.id, autoRenew: !pact.autoRenew },
                pact.autoRenew ? 'Auto-renew off.' : 'Auto-renew on.',
              )
            }
            className="flex items-center gap-1 rounded bg-zinc-800 px-2 py-1 text-[11px] text-zinc-200 hover:bg-zinc-700 disabled:opacity-50"
          >
            <Repeat className="h-3 w-3" /> {pact.autoRenew ? 'Disable' : 'Enable'} auto-renew
          </button>
          {pact.premiumFrequency !== 'upfront' && pact.status === 'active' && (
            <button
              type="button"
              disabled={busy}
              onClick={() =>
                run('pact-pay-premium', { pactId: pact.id }, `Paid ${pact.premiumSparks} ⚡ premium.`)
              }
              className="flex items-center gap-1 rounded bg-emerald-800 px-2 py-1 text-[11px] text-white hover:bg-emerald-700 disabled:opacity-50"
            >
              <Wallet className="h-3 w-3" /> Pay {pact.premiumSparks} ⚡ premium
            </button>
          )}
          {pact.status === 'active' && (
            <button
              type="button"
              disabled={busy}
              onClick={() => run('pact-revoke', { pactId: pact.id }, 'Pact revoked.')}
              className="flex items-center gap-1 rounded bg-rose-900 px-2 py-1 text-[11px] text-rose-200 hover:bg-rose-800 disabled:opacity-50"
            >
              <Ban className="h-3 w-3" /> Revoke
            </button>
          )}
        </div>
      )}
    </li>
  );
}
