'use client';

import { Crown } from 'lucide-react';
import { partnerLabel } from './courtship-types';
import type { useCourtshipDesk } from './useCourtshipDesk';

type Desk = ReturnType<typeof useCourtshipDesk>;

export function MarriagesPanel({ desk }: { desk: Desk }) {
  const { marriages, pregnancies, pending, conceive, setDissolveTarget, spouses } = desk;

  return (
    <div className="space-y-6">
    <section className="space-y-2" aria-labelledby="marriages-heading">
      <h2 id="marriages-heading" className="flex items-center gap-1 text-sm font-semibold text-amber-300">
        <Crown size={14} aria-hidden="true" /> Marriages ({marriages.length})
      </h2>
      {marriages.length === 0 ? (
        <p className="text-xs text-zinc-500">No active marriages.</p>
      ) : (
        <ul data-testid="marriage-list" className="space-y-1">
          {marriages.map((m) => (
            <li key={m.id} className="flex flex-col gap-1 rounded border border-amber-500/30 bg-amber-950/30 p-2 text-xs sm:flex-row sm:items-center sm:justify-between">
              <div className="flex flex-col">
                <span className="text-amber-100">{partnerLabel(m.partner_kind, m.partnerName)}</span>
                <span className="text-amber-300/70">since {new Date(m.married_at * 1000).toLocaleDateString()}</span>
              </div>
              <div className="flex gap-1 self-start sm:self-auto">
                {pregnancies.length === 0 && (
                  <button
                    type="button"
                    aria-label={`Try for a child with ${partnerLabel(m.partner_kind, m.partnerName)}`}
                    onClick={() => conceive(m)}
                    disabled={pending}
                    className="rounded bg-emerald-500/30 px-2 py-1 text-[10px] text-emerald-100 hover:bg-emerald-500/50 disabled:opacity-50"
                  >
                    Try for a child
                  </button>
                )}
                <button
                  type="button"
                  aria-label={`End marriage to ${partnerLabel(m.partner_kind, m.partnerName)}`}
                  onClick={() => setDissolveTarget(m)}
                  disabled={pending}
                  className="rounded bg-red-500/20 px-2 py-1 text-[10px] text-red-300 hover:bg-red-500/40 hover:text-red-100 disabled:opacity-50"
                >
                  End Marriage
                </button>
              </div>
            </li>
          ))}
        </ul>
      )}
    </section>
    {spouses.length > 0 && (
      <section className="space-y-2" aria-labelledby="spouses-heading" data-testid="courtship-spouses">
        <h2 id="spouses-heading" className="flex items-center gap-1 text-sm font-semibold text-amber-200">
          <Crown size={14} aria-hidden="true" /> Your NPC spouses ({spouses.length})
        </h2>
        <ul className="space-y-1">
          {spouses.map((s) => (
            <li key={s.npcId} className="rounded border border-amber-500/20 bg-amber-950/10 p-2 text-xs text-amber-100">
              {partnerLabel('npc', s.partnerName)}
            </li>
          ))}
        </ul>
      </section>
    )}
    </div>
  );
}
