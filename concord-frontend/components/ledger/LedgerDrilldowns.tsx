'use client';

/**
 * Ledger drill-downs — the faction dossier ("follow the money up the chain")
 * and the platform-wide flow pulse. Both wire real `ledger` macros
 * (faction_economy / flow_summary) that previously sat in the manifest with
 * no UI caller. Extracted from ledger/page.tsx.
 */

import { useCallback, useEffect, useState } from 'react';
import { lensRun } from '@/lib/api/client';
import type { FactionEconomy, FlowSummary } from './ledger-shared';

export function FactionDossier({
  worldId, factionId, onClose,
}: {
  worldId: string;
  factionId: string;
  onClose: () => void;
}) {
  const [dossier, setDossier] = useState<FactionEconomy | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setDossier(null);
    setError(null);
    setLoading(true);
    try {
      const r = await lensRun<FactionEconomy>('ledger', 'faction_economy', { worldId, factionId });
      if (r?.data?.ok === false || r?.data?.result == null) {
        setError(r?.data?.error || 'unavailable');
        return;
      }
      const out = r.data.result as FactionEconomy;
      if (out.ok === false) {
        setError(out.reason || 'unavailable');
        return;
      }
      setDossier(out);
    } catch {
      setError('request_failed');
    } finally {
      setLoading(false);
    }
  }, [worldId, factionId]);

  useEffect(() => { void load(); }, [load]);

  return (
    <section className="mb-6 rounded border border-emerald-700/40 bg-emerald-950/10 p-3" data-testid="faction-dossier">
      <div className="mb-2 flex items-center justify-between">
        <h2 className="text-xs uppercase tracking-widest text-emerald-400/80">Dossier — {factionId}</h2>
        <button type="button" onClick={onClose} className="text-xs text-zinc-500 hover:text-zinc-300">Close</button>
      </div>
      {loading && <div role="status" aria-live="polite" className="text-xs text-zinc-500">Following the money…</div>}
      {!loading && error && (
        <div role="alert" className="text-xs text-red-300">
          Couldn&apos;t read the dossier ({error}).{' '}
          <button type="button" onClick={() => void load()} className="underline hover:text-red-200">Retry</button>
        </div>
      )}
      {!loading && !error && dossier && (
        <div className="grid grid-cols-1 gap-3 text-xs sm:grid-cols-3">
          <div>
            <div className="text-zinc-500">Treasury</div>
            <div className="font-mono text-zinc-100">{dossier.treasury ?? 'unknown'}</div>
          </div>
          <div>
            <div className="text-zinc-500">Funded by</div>
            {(dossier.fundedBy?.length ?? 0) === 0 ? (
              <div className="text-zinc-600">none on record</div>
            ) : (
              <ul>{dossier.fundedBy!.map((f) => <li key={f} className="text-zinc-100">{f}</li>)}</ul>
            )}
          </div>
          <div>
            <div className="text-zinc-500">Liens against</div>
            {(dossier.liensAgainst?.length ?? 0) === 0 ? (
              <div className="text-zinc-600">none on record</div>
            ) : (
              <ul>{dossier.liensAgainst!.map((l, i) => (
                <li key={i} className="text-zinc-100">{l.creditor_id}{typeof l.amount === 'number' ? ` — ${l.amount}` : ''}</li>
              ))}</ul>
            )}
          </div>
        </div>
      )}
    </section>
  );
}

export function GlobalFlowPulse({ worldId }: { worldId: string }) {
  const [pulse, setPulse] = useState<FlowSummary | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const r = await lensRun<FlowSummary>('ledger', 'flow_summary', { limit: 12 });
      if (r?.data?.ok === false || r?.data?.result == null) {
        setError(r?.data?.error || 'unavailable');
        return;
      }
      const out = r.data.result as FlowSummary;
      if (out.ok === false) {
        setError(out.reason || 'unavailable');
        return;
      }
      setPulse(out);
    } catch {
      setError('request_failed');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { void load(); }, [load]);

  return (
    <section className="mb-6 rounded border border-zinc-800 bg-zinc-950/60 p-3" data-testid="flow-pulse">
      <h2 className="mb-2 text-xs uppercase tracking-widest text-zinc-500">
        Global flow pulse <span className="normal-case text-zinc-600">(platform-wide, not scoped to {worldId} — the ledger carries no per-row world id)</span>
      </h2>
      {loading && <div role="status" aria-live="polite" className="text-xs text-zinc-500">Reading the ledger…</div>}
      {!loading && error && (
        <div role="alert" className="text-xs text-red-300">
          Couldn&apos;t read the flow pulse ({error}).{' '}
          <button type="button" onClick={() => void load()} className="underline hover:text-red-200">Retry</button>
        </div>
      )}
      {!loading && !error && (pulse?.byType?.length ?? 0) === 0 && (
        <div className="text-xs text-zinc-500">No ledger rows yet.</div>
      )}
      {!loading && !error && (pulse?.byType?.length ?? 0) > 0 && (
        <ul className="grid grid-cols-2 gap-2 sm:grid-cols-4">
          {pulse!.byType!.map((row) => (
            <li key={row.type} className="rounded border border-zinc-800 bg-zinc-900/60 px-2 py-1.5 text-xs">
              <div className="text-zinc-400">{row.type}</div>
              <div className="font-mono text-zinc-100">{row.total} <span className="text-zinc-500">({row.n})</span></div>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
