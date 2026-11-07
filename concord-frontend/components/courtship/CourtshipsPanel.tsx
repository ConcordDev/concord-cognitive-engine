'use client';

import { Icon as SvgIcon } from '@/components/icons/Icon';
import type { useCourtshipDesk } from './useCourtshipDesk';

type Desk = ReturnType<typeof useCourtshipDesk>;

export function CourtshipsPanel({ desk }: { desk: Desk }) {
  const {
    courtships, pending, engageThreshold, marryThreshold, engagePct,
    interact, propose, wed,
  } = desk;

  return (
    <section className="space-y-2" aria-labelledby="courtships-heading">
      <h2 id="courtships-heading" className="flex items-center gap-1 text-sm font-semibold text-pink-300">
        <SvgIcon name="heart" size={14} className="text-pink-300" /> Active courtships ({courtships.length})
      </h2>
      {!Array.isArray(courtships) || courtships.length === 0 ? (
        <p data-testid="courtship-empty" className="text-xs text-zinc-500">
          No active courtships yet. Initiate one from an NPC&apos;s context menu in the world,
          then return here to track affinity, propose, and wed.
        </p>
      ) : (
        <ul data-testid="courtship-list" className="space-y-2">
          {courtships.map((c) => {
            const partnerId = String(c?.partner_id ?? '');
            const pct = Math.round(Number(c?.affinity || 0) * 100);
            const canPropose =
              Number(c?.affinity || 0) >= engageThreshold && c.status !== 'engaged' &&
              c.status !== 'married' && c.status !== 'estranged' && c.status !== 'widowed';
            const canWed = c.status === 'engaged' && Number(c?.affinity || 0) >= marryThreshold;
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
                {!canPropose && c.status !== 'engaged' && c.status !== 'married' && (
                  <p className="mt-1 text-[10px] text-zinc-500">Reach {engagePct}% affinity to propose.</p>
                )}
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}
