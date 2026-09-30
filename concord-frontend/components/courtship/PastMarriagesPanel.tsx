'use client';

import type { useCourtshipDesk } from './useCourtshipDesk';

type Desk = ReturnType<typeof useCourtshipDesk>;

export function PastMarriagesPanel({ desk }: { desk: Desk }) {
  const { pastMarriages } = desk;

  if (pastMarriages.length === 0) {
    return <p className="text-xs text-zinc-500">No past (dissolved) marriages.</p>;
  }

  return (
    <section className="space-y-2" aria-labelledby="past-marriages-heading">
      <h2 id="past-marriages-heading" className="text-sm font-semibold text-zinc-400">
        Past marriages ({pastMarriages.length})
      </h2>
      <ul data-testid="past-marriage-list" className="space-y-1">
        {pastMarriages.map((m) => (
          <li key={m.id} className="flex flex-col gap-0.5 rounded border border-zinc-700/50 bg-zinc-900/40 p-2 text-xs">
            <span className="font-mono text-zinc-300">{m.partner_kind}:{String(m.partner_id ?? "").slice(0, 14)}</span>
            <span className="text-zinc-500">
              {new Date(m.married_at * 1000).toLocaleDateString()}
              {m.dissolved_at ? ` – ${new Date(m.dissolved_at * 1000).toLocaleDateString()}` : ''}
              {m.dissolved_reason ? ` (${m.dissolved_reason})` : ''}
            </span>
          </li>
        ))}
      </ul>
    </section>
  );
}
