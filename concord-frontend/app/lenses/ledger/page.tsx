'use client';

import { LensShell } from '@/components/lens/LensShell';

/**
 * Ledger lens — the analytical overlay you toggle to see the flows the Curtain
 * hides. Reads ledger.anomalies and renders the managed-parity funding (who funds
 * both sides of which war) + the extraction liens (rescue-as-acquisition). This is
 * the satire's payoff surface: the corruption is uncovered by looking, not by
 * being told. Defaults to Sere; the flows are real rows, not authored prose.
 */

import { useEffect, useState } from 'react';
import { lensRun } from '@/lib/api/client';

interface ManagedParity { funder: string; fundsBothSidesOf: string[]; detail: string; }
interface Lien { creditor: string; debtor: { kind: string; id: string }; amount: number; collateral: { id: string } | null; detail: string; }
interface Anomalies { ok?: boolean; managedParity?: ManagedParity[]; extractionLiens?: Lien[]; total?: number; }

export default function LedgerLensPage() {
  const [worldId] = useState('sere');
  const [data, setData] = useState<Anomalies | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const r = await lensRun('ledger', 'anomalies', { worldId });
        if (!cancelled) setData((r?.data ?? null) as Anomalies | null);
      } catch { /* leave empty */ }
      finally { if (!cancelled) setLoading(false); }
    })();
    return () => { cancelled = true; };
  }, [worldId]);

  const parity = data?.managedParity ?? [];
  const liens = data?.extractionLiens ?? [];

  return (
    <LensShell lensId="ledger">
    <div className="min-h-screen bg-black text-zinc-200 p-6">
      <header className="mb-6">
        <h1 className="text-xl font-semibold text-emerald-300">The Ledger</h1>
        <p className="text-sm text-zinc-400">
          The flows the Curtain keeps off the public record. Nothing here is told to you — it is read from the books.
        </p>
      </header>

      {loading && <div className="text-zinc-500 text-sm">Reading the books…</div>}

      {!loading && (parity.length + liens.length) === 0 && (
        <div className="text-zinc-500 text-sm">No anomalous flows surfaced for {worldId}. The record looks clean. (That is usually a sign you have not looked hard enough.)</div>
      )}

      {parity.length > 0 && (
        <section className="mb-8" data-testid="managed-parity">
          <h2 className="mb-2 text-sm uppercase tracking-widest text-amber-400/80">Managed parity — wars funded on both sides</h2>
          <ul className="space-y-2">
            {parity.map((p, i) => (
              <li key={i} className="rounded border border-amber-500/30 bg-amber-500/5 p-3 text-sm">
                <span className="font-medium text-amber-200">{p.funder}</span>{' '}
                funds both <span className="text-zinc-100">{p.fundsBothSidesOf?.join(' and ')}</span>
                <div className="mt-1 text-xs text-zinc-400">{p.detail}</div>
              </li>
            ))}
          </ul>
        </section>
      )}

      {liens.length > 0 && (
        <section data-testid="extraction-liens">
          <h2 className="mb-2 text-sm uppercase tracking-widest text-cyan-400/80">Extraction liens — rescue as acquisition</h2>
          <ul className="space-y-2">
            {liens.map((l, i) => (
              <li key={i} className="rounded border border-cyan-500/30 bg-cyan-500/5 p-3 text-sm">
                <span className="font-medium text-cyan-200">{l.creditor}</span>{' '}
                holds a lien over <span className="text-zinc-100">{l.debtor?.id}</span>
                {l.collateral && <span className="text-zinc-400"> (collateral: {l.collateral.id})</span>}
                <div className="mt-1 text-xs text-zinc-400">{l.detail}</div>
              </li>
            ))}
          </ul>
        </section>
      )}
    </div>
    </LensShell>
  );
}
