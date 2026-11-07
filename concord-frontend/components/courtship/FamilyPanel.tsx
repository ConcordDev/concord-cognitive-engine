'use client';

import { Baby, Sparkles } from 'lucide-react';
import type { useCourtshipDesk } from './useCourtshipDesk';

type Desk = ReturnType<typeof useCourtshipDesk>;

export function FamilyPanel({ desk }: { desk: Desk }) {
  const { pregnancies, children, pending, birth } = desk;

  return (
    <div className="space-y-6">
      {pregnancies.length > 0 && (
        <section className="space-y-2" aria-labelledby="pregnancies-heading">
          <h2 id="pregnancies-heading" className="flex items-center gap-1 text-sm font-semibold text-fuchsia-300">
            <Sparkles size={14} aria-hidden="true" /> Pending pregnancies ({pregnancies.length})
          </h2>
          <ul data-testid="pregnancy-list" className="space-y-1">
            {pregnancies.map((p) => {
              const due = p.dueAt <= Math.floor(Date.now() / 1000);
              return (
                <li key={p.pregnancyId} className="flex flex-col gap-1 rounded border border-fuchsia-500/30 bg-fuchsia-950/20 p-2 text-xs sm:flex-row sm:items-center sm:justify-between">
                  <div className="flex flex-col">
                    <span className="font-mono text-fuchsia-100">{p.partnerKind}:{String(p.partnerId ?? "").slice(0, 14)}</span>
                    <span className="text-fuchsia-300/70">
                      {due ? 'ready to birth' : `due ${new Date(p.dueAt * 1000).toLocaleDateString()}`}
                    </span>
                  </div>
                  {due && (
                    <button
                      type="button"
                      aria-label="Birth this child"
                      onClick={() => birth(p)}
                      disabled={pending}
                      className="self-start rounded bg-fuchsia-500/40 px-2 py-1 text-[10px] text-fuchsia-100 hover:bg-fuchsia-500/60 disabled:opacity-50 sm:self-auto"
                    >
                      <Baby size={11} className="mr-1 inline" aria-hidden="true" /> Birth
                    </button>
                  )}
                </li>
              );
            })}
          </ul>
        </section>
      )}

      <section className="space-y-2" aria-labelledby="children-heading">
        <h2 id="children-heading" className="flex items-center gap-1 text-sm font-semibold text-emerald-300">
          <Baby size={14} aria-hidden="true" /> Children ({children.length})
        </h2>
        {children.length === 0 ? (
          <p className="text-xs text-zinc-500">No children.</p>
        ) : (
          <ul className="space-y-1">
            {children.map((c) => (
              <li key={c.id} className="flex flex-col gap-1 rounded border border-emerald-500/30 bg-emerald-950/30 p-2 text-xs sm:flex-row sm:justify-between">
                <span className="font-mono text-emerald-100">{c.name || String(c.id ?? "").slice(0, 16)}</span>
                <span className="text-emerald-300/70">{c.maturity}</span>
              </li>
            ))}
          </ul>
        )}
      </section>

      {pregnancies.length === 0 && children.length === 0 && (
        <p className="text-xs text-zinc-500">No pregnancies or children yet. Conceive from an active marriage.</p>
      )}
    </div>
  );
}
