'use client';

import { LensShell } from '@/components/lens/LensShell';

/**
 * Ledger lens — the analytical overlay you toggle to see the flows the Curtain
 * hides. Reads ledger.anomalies and renders the managed-parity funding (who funds
 * both sides of which war) + the extraction liens (rescue-as-acquisition). The
 * flows are real economy rows (faction_funding + extraction_loans), not authored
 * prose.
 *
 * Read-only by design, but it IS a workspace: pick the world to audit, refresh
 * on demand, export the surfaced flows (JSON/CSV), and pin worlds to a persisted
 * watchlist. Four honest UX states: loading / error+retry / empty / populated.
 *
 * The faction dossier drill-down (ledger.faction_economy) and the platform-wide
 * flow pulse (ledger.flow_summary) live in components/ledger/LedgerDrilldowns.tsx.
 */

import { useCallback, useEffect, useMemo, useState } from 'react';
import { lensRun } from '@/lib/api/client';
import { useLensData } from '@/lib/hooks/use-lens-data';
import { FactionDossier, GlobalFlowPulse } from '@/components/ledger/LedgerDrilldowns';
import { toCsv, download, type Anomalies } from '@/components/ledger/ledger-shared';

// Known audit-able worlds. Sere is the satire's home; the others let the reader
// confirm a clean record elsewhere (which is the point — you have to look).
const WORLD_OPTIONS = ['sere', 'concordia-hub', 'tunya'];

export default function LedgerLensPage() {
  const [worldId, setWorldId] = useState('sere');
  const [data, setData] = useState<Anomalies | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Persisted watchlist of worlds to keep an eye on — a real workspace artifact
  // stored in the lens substrate (NOT mock data).
  const { items: watchItems, create: createWatch, remove: removeWatch } =
    useLensData<{ worldId: string }>('ledger', 'watchlist', { seed: [] });

  const watchedWorlds = useMemo(
    () => watchItems.map((w) => w.data?.worldId).filter(Boolean) as string[],
    [watchItems],
  );

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const r = await lensRun<Anomalies>('ledger', 'anomalies', { worldId });
      // A backend failure surfaces at the ENVELOPE level (r.data.ok === false,
      // result === null). Inspect it first so a closed ledger reads as an ERROR
      // (with Retry), never as a clean record.
      if (r?.data?.ok === false || r?.data?.result == null) {
        setError(r?.data?.error || 'unavailable');
        setData(null);
        return;
      }
      const out = r.data.result as Anomalies;
      if (out.ok === false) {
        setError(out.reason || 'unavailable');
        setData(null);
        return;
      }
      setData(out);
    } catch {
      setError('request_failed');
      setData(null);
    } finally {
      setLoading(false);
    }
  }, [worldId]);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      await load();
      void cancelled;
    })();
    return () => { cancelled = true; };
  }, [load]);

  const parity = data?.managedParity ?? [];
  const liens = data?.extractionLiens ?? [];
  const isEmpty = !loading && !error && parity.length + liens.length === 0;
  const hasFlows = parity.length + liens.length > 0;

  const [dossierId, setDossierId] = useState<string | null>(null);
  const [showPulse, setShowPulse] = useState(false);

  const isWatched = watchedWorlds.includes(worldId);
  const toggleWatch = useCallback(() => {
    if (isWatched) {
      const hit = watchItems.find((w) => w.data?.worldId === worldId);
      if (hit) void removeWatch(hit.id);
    } else {
      void createWatch({ title: worldId, data: { worldId } });
    }
  }, [isWatched, watchItems, worldId, removeWatch, createWatch]);

  const exportJson = useCallback(() => {
    download(`ledger-${worldId}.json`, JSON.stringify({ worldId, managedParity: parity, extractionLiens: liens }, null, 2), 'application/json');
  }, [worldId, parity, liens]);
  const exportCsv = useCallback(() => {
    download(`ledger-${worldId}.csv`, toCsv(parity, liens), 'text/csv');
  }, [worldId, parity, liens]);

  return (
    <LensShell lensId="ledger">
      <div className="min-h-screen bg-black text-zinc-200 p-4 sm:p-6">
        <header className="mb-6">
          <h1 className="text-xl font-semibold text-emerald-300">The Ledger</h1>
          <p className="text-sm text-zinc-400">
            The flows the Curtain keeps off the public record. Nothing here is told to you — it is read from the books.
          </p>
        </header>

        {/* ── Workspace controls ─────────────────────────────────────── */}
        <div className="mb-6 flex flex-col items-stretch gap-3 sm:flex-row sm:flex-wrap sm:items-center" role="group" aria-label="Ledger controls">
          <label className="text-xs text-zinc-400">
            World&nbsp;
            <select
              aria-label="World to audit"
              className="rounded border border-zinc-700 bg-zinc-900 px-2 py-1 text-sm text-zinc-100"
              value={worldId}
              onChange={(e) => setWorldId(e.target.value)}
            >
              {Array.from(new Set([...WORLD_OPTIONS, ...watchedWorlds])).map((w) => (
                <option key={w} value={w}>{w}</option>
              ))}
            </select>
          </label>

          <button
            type="button"
            onClick={() => void load()}
            className="rounded border border-zinc-700 bg-zinc-900 px-3 py-1 text-sm text-zinc-100 transition-colors hover:bg-zinc-800"
          >
            Refresh
          </button>

          <button
            type="button"
            onClick={toggleWatch}
            aria-pressed={isWatched}
            className="rounded border border-emerald-700/50 bg-emerald-900/20 px-3 py-1 text-sm text-emerald-200 transition-colors hover:bg-emerald-900/40"
          >
            {isWatched ? 'Unwatch this world' : 'Watch this world'}
          </button>

          <span className="flex-1" />

          <button
            type="button"
            onClick={exportJson}
            disabled={!hasFlows}
            className="rounded border border-zinc-700 bg-zinc-900 px-3 py-1 text-sm text-zinc-100 transition-colors hover:bg-zinc-800 disabled:opacity-40"
          >
            Export JSON
          </button>
          <button
            type="button"
            onClick={exportCsv}
            disabled={!hasFlows}
            className="rounded border border-zinc-700 bg-zinc-900 px-3 py-1 text-sm text-zinc-100 transition-colors hover:bg-zinc-800 disabled:opacity-40"
          >
            Export CSV
          </button>

          <button
            type="button"
            onClick={() => setShowPulse((v) => !v)}
            aria-pressed={showPulse}
            className="rounded border border-zinc-700 bg-zinc-900 px-3 py-1 text-sm text-zinc-100 transition-colors hover:bg-zinc-800"
          >
            {showPulse ? 'Hide' : 'Show'} global pulse
          </button>
        </div>

        {showPulse && <GlobalFlowPulse worldId={worldId} />}

        {dossierId && (
          <FactionDossier worldId={worldId} factionId={dossierId} onClose={() => setDossierId(null)} />
        )}

        {watchedWorlds.length > 0 && (
          <div className="mb-4 text-xs text-zinc-500" data-testid="watchlist">
            Watching: {watchedWorlds.join(', ')}
          </div>
        )}

        {/* ── LOADING ────────────────────────────────────────────────── */}
        {loading && (
          <div role="status" aria-live="polite" className="text-zinc-500 text-sm">
            Reading the books…
          </div>
        )}

        {/* ── ERROR ──────────────────────────────────────────────────── */}
        {!loading && error && (
          <div role="alert" className="rounded border border-red-500/40 bg-red-500/5 p-4 text-sm">
            <div className="text-red-300">Couldn&apos;t read the ledger for {worldId}.</div>
            <div className="mt-1 text-xs text-zinc-400">The books are closed right now ({error}).</div>
            <button
              type="button"
              onClick={() => void load()}
              className="mt-3 rounded border border-red-500/40 bg-red-500/10 px-3 py-1 text-red-200 hover:bg-red-500/20"
            >
              Retry
            </button>
          </div>
        )}

        {/* ── EMPTY ──────────────────────────────────────────────────── */}
        {isEmpty && (
          <div className="text-zinc-500 text-sm">
            No anomalous flows surfaced for {worldId}. The record looks clean. (That is usually a sign you have not looked hard enough.)
          </div>
        )}

        {/* ── POPULATED ──────────────────────────────────────────────── */}
        {!loading && !error && parity.length > 0 && (
          <section className="mb-8" data-testid="managed-parity">
            <h2 className="mb-2 text-sm uppercase tracking-widest text-amber-400/80">
              Managed parity — wars funded on both sides ({parity.length})
            </h2>
            <ul className="space-y-2">
              {parity.map((p, i) => (
                <li key={i} className="rounded border border-amber-500/30 bg-amber-500/5 p-3 text-sm">
                  <button type="button" onClick={() => setDossierId(p.funder)} className="font-medium text-amber-200 underline decoration-dotted underline-offset-2 hover:text-amber-100">{p.funder}</button>{' '}
                  funds both{' '}
                  {(p.fundsBothSidesOf || []).map((f, j) => (
                    <span key={f}>
                      {j > 0 && ' and '}
                      <button type="button" onClick={() => setDossierId(f)} className="text-zinc-100 underline decoration-dotted underline-offset-2 hover:text-white">{f}</button>
                    </span>
                  ))}
                  <div className="mt-1 text-xs text-zinc-400">{p.detail}</div>
                </li>
              ))}
            </ul>
          </section>
        )}

        {!loading && !error && liens.length > 0 && (
          <section data-testid="extraction-liens">
            <h2 className="mb-2 text-sm uppercase tracking-widest text-cyan-400/80">
              Extraction liens — rescue as acquisition ({liens.length})
            </h2>
            <ul className="space-y-2">
              {liens.map((l, i) => (
                <li key={i} className="rounded border border-cyan-500/30 bg-cyan-500/5 p-3 text-sm">
                  <button type="button" onClick={() => setDossierId(l.creditor)} className="font-medium text-cyan-200 underline decoration-dotted underline-offset-2 hover:text-cyan-100">{l.creditor}</button>{' '}
                  holds a lien over{' '}
                  <button type="button" onClick={() => l.debtor?.id && setDossierId(l.debtor.id)} className="text-zinc-100 underline decoration-dotted underline-offset-2 hover:text-white">{l.debtor?.id}</button>
                  {typeof l.amount === 'number' && <span className="text-zinc-400"> for {l.amount}</span>}
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
