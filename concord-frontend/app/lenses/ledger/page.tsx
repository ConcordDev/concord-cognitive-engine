'use client';

import { LensShell } from '@/components/lens/LensShell';

/**
 * Ledger lens — the analytical overlay you toggle to see the flows the Curtain
 * hides. Reads ledger.anomalies and renders the managed-parity funding (who funds
 * both sides of which war) + the extraction liens (rescue-as-acquisition). This is
 * the satire's payoff surface: the corruption is uncovered by looking, not by
 * being told. The flows are real economy rows (faction_funding + extraction_loans),
 * not authored prose.
 *
 * Read-only by design (a ledger reader has no editor in the create-artifact sense),
 * but it IS a workspace: pick the world to audit, refresh on demand, export the
 * surfaced flows (JSON/CSV), and pin worlds to a persisted watchlist
 * (useLensData → the real lens-artifact substrate). Four honest UX states:
 * loading / error+retry / empty / populated.
 *
 * Two more real macros previously sat in the manifest with zero UI caller —
 * ledger.faction_economy (a faction's treasury + who funds it + liens
 * against it — "follow the money up the chain") and ledger.flow_summary (a
 * platform-wide, non-world-scoped ledger rollup by type). Every actor name
 * in the parity/lien lists is now clickable and opens a faction dossier
 * drill-down; a "Show global pulse" toggle surfaces the flow rollup,
 * explicitly labelled as platform-wide since the underlying ledger has no
 * per-row world id.
 */

import { useCallback, useEffect, useMemo, useState } from 'react';
import { lensRun } from '@/lib/api/client';
import { useLensData } from '@/lib/hooks/use-lens-data';

interface ManagedParity {
  kind?: string;
  funder: string;
  fundsBothSidesOf: string[];
  detail: string;
}
interface Lien {
  kind?: string;
  creditor: string;
  debtor: { kind: string; id: string };
  amount?: number;
  collateral: { kind?: string; id: string } | null;
  dueAt?: number;
  detail: string;
}
interface Anomalies {
  ok?: boolean;
  reason?: string;
  worldId?: string;
  managedParity?: ManagedParity[];
  extractionLiens?: Lien[];
  total?: number;
}
interface FactionEconomy {
  ok?: boolean;
  reason?: string;
  factionId?: string;
  treasury?: number | null;
  fundedBy?: string[];
  liensAgainst?: { creditor_id: string; amount?: number; collateral_id?: string | null }[];
}
interface FlowSummaryRow { type: string; n: number; total: number }
interface FlowSummary { ok?: boolean; reason?: string; byType?: FlowSummaryRow[] }

// Known audit-able worlds. Sere is the satire's home; the others let the reader
// confirm a clean record elsewhere (which is the point — you have to look).
const WORLD_OPTIONS = ['sere', 'concordia-hub', 'tunya'];

function toCsv(parity: ManagedParity[], liens: Lien[]): string {
  const rows: string[] = ['stream,actor,counterparty,amount,detail'];
  const esc = (v: unknown) => `"${String(v ?? '').replace(/"/g, '""')}"`;
  for (const p of parity) {
    rows.push(['managed_parity', esc(p.funder), esc((p.fundsBothSidesOf || []).join(' & ')), '', esc(p.detail)].join(','));
  }
  for (const l of liens) {
    rows.push(['extraction_lien', esc(l.creditor), esc(l.debtor?.id), esc(l.amount ?? ''), esc(l.detail)].join(','));
  }
  return rows.join('\n');
}

function download(filename: string, text: string, mime: string) {
  if (typeof window === 'undefined') return;
  const blob = new Blob([text], { type: mime });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}

export default function LedgerLensPage() {
  const [worldId, setWorldId] = useState('sere');
  const [data, setData] = useState<Anomalies | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Persisted watchlist of worlds to keep an eye on — a real workspace artifact
  // stored in the lens substrate (NOT mock data). Read-only ledger, but the
  // user's own audit preferences persist.
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
      // The macro output lives at result (server wraps as { ok, result, error }).
      // A backend failure surfaces at the ENVELOPE level (r.data.ok === false,
      // result === null) — e.g. a no_db / handler throw. If we only read
      // r.data.result we silently fall through to the empty "record looks clean"
      // state and lie to the auditor. Inspect the envelope first so a closed
      // ledger reads as an ERROR (with Retry), never as a clean record.
      if (r?.data?.ok === false || r?.data?.result == null) {
        setError(r?.data?.error || 'unavailable');
        setData(null);
        return;
      }
      const out = r.data.result as Anomalies;
      // Defence-in-depth: the unwrapped payload can itself carry ok:false
      // (a macro that returns { ok:false, reason } without throwing).
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

  // ── Faction dossier drill-down — "follow the money up the chain" for a
  // named actor. Real macro (ledger.faction_economy), not fabricated —
  // previously registered in the manifest but never called from any UI.
  const [dossierId, setDossierId] = useState<string | null>(null);
  const [dossier, setDossier] = useState<FactionEconomy | null>(null);
  const [dossierLoading, setDossierLoading] = useState(false);
  const [dossierError, setDossierError] = useState<string | null>(null);

  const openDossier = useCallback(async (factionId: string) => {
    setDossierId(factionId);
    setDossier(null);
    setDossierError(null);
    setDossierLoading(true);
    try {
      const r = await lensRun<FactionEconomy>('ledger', 'faction_economy', { worldId, factionId });
      if (r?.data?.ok === false || r?.data?.result == null) {
        setDossierError(r?.data?.error || 'unavailable');
        return;
      }
      const out = r.data.result as FactionEconomy;
      if (out.ok === false) {
        setDossierError(out.reason || 'unavailable');
        return;
      }
      setDossier(out);
    } catch {
      setDossierError('request_failed');
    } finally {
      setDossierLoading(false);
    }
  }, [worldId]);

  // ── Global flow pulse — real macro (ledger.flow_summary), platform-wide
  // (the underlying ledger has no per-row world_id, so this is intentionally
  // NOT scoped to the world selector above — labelled as such below).
  const [showPulse, setShowPulse] = useState(false);
  const [pulse, setPulse] = useState<FlowSummary | null>(null);
  const [pulseLoading, setPulseLoading] = useState(false);
  const [pulseError, setPulseError] = useState<string | null>(null);

  const loadPulse = useCallback(async () => {
    setPulseLoading(true);
    setPulseError(null);
    try {
      const r = await lensRun<FlowSummary>('ledger', 'flow_summary', { limit: 12 });
      if (r?.data?.ok === false || r?.data?.result == null) {
        setPulseError(r?.data?.error || 'unavailable');
        return;
      }
      const out = r.data.result as FlowSummary;
      if (out.ok === false) {
        setPulseError(out.reason || 'unavailable');
        return;
      }
      setPulse(out);
    } catch {
      setPulseError('request_failed');
    } finally {
      setPulseLoading(false);
    }
  }, []);

  const togglePulse = useCallback(() => {
    setShowPulse((v) => {
      const next = !v;
      if (next && !pulse && !pulseLoading) void loadPulse();
      return next;
    });
  }, [pulse, pulseLoading, loadPulse]);

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

  const hasFlows = parity.length + liens.length > 0;

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
            onClick={togglePulse}
            aria-pressed={showPulse}
            className="rounded border border-zinc-700 bg-zinc-900 px-3 py-1 text-sm text-zinc-100 transition-colors hover:bg-zinc-800"
          >
            {showPulse ? 'Hide' : 'Show'} global pulse
          </button>
        </div>

        {/* ── Global flow pulse (platform-wide, not world-scoped) ───────── */}
        {showPulse && (
          <section className="mb-6 rounded border border-zinc-800 bg-zinc-950/60 p-3" data-testid="flow-pulse">
            <h2 className="mb-2 text-xs uppercase tracking-widest text-zinc-500">
              Global flow pulse <span className="normal-case text-zinc-600">(platform-wide, not scoped to {worldId} — the ledger carries no per-row world id)</span>
            </h2>
            {pulseLoading && <div role="status" aria-live="polite" className="text-xs text-zinc-500">Reading the ledger…</div>}
            {!pulseLoading && pulseError && (
              <div role="alert" className="text-xs text-red-300">
                Couldn&apos;t read the flow pulse ({pulseError}).{' '}
                <button type="button" onClick={() => void loadPulse()} className="underline hover:text-red-200">Retry</button>
              </div>
            )}
            {!pulseLoading && !pulseError && (pulse?.byType?.length ?? 0) === 0 && (
              <div className="text-xs text-zinc-500">No ledger rows yet.</div>
            )}
            {!pulseLoading && !pulseError && (pulse?.byType?.length ?? 0) > 0 && (
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
        )}

        {/* ── Faction dossier drill-down ─────────────────────────────────── */}
        {dossierId && (
          <section className="mb-6 rounded border border-emerald-700/40 bg-emerald-950/10 p-3" data-testid="faction-dossier">
            <div className="mb-2 flex items-center justify-between">
              <h2 className="text-xs uppercase tracking-widest text-emerald-400/80">Dossier — {dossierId}</h2>
              <button type="button" onClick={() => setDossierId(null)} className="text-xs text-zinc-500 hover:text-zinc-300">Close</button>
            </div>
            {dossierLoading && <div role="status" aria-live="polite" className="text-xs text-zinc-500">Following the money…</div>}
            {!dossierLoading && dossierError && (
              <div role="alert" className="text-xs text-red-300">
                Couldn&apos;t read the dossier ({dossierError}).{' '}
                <button type="button" onClick={() => void openDossier(dossierId)} className="underline hover:text-red-200">Retry</button>
              </div>
            )}
            {!dossierLoading && !dossierError && dossier && (
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
                  <button type="button" onClick={() => void openDossier(p.funder)} className="font-medium text-amber-200 underline decoration-dotted underline-offset-2 hover:text-amber-100">{p.funder}</button>{' '}
                  funds both{' '}
                  {(p.fundsBothSidesOf || []).map((f, j) => (
                    <span key={f}>
                      {j > 0 && ' and '}
                      <button type="button" onClick={() => void openDossier(f)} className="text-zinc-100 underline decoration-dotted underline-offset-2 hover:text-white">{f}</button>
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
                  <button type="button" onClick={() => void openDossier(l.creditor)} className="font-medium text-cyan-200 underline decoration-dotted underline-offset-2 hover:text-cyan-100">{l.creditor}</button>{' '}
                  holds a lien over{' '}
                  <button type="button" onClick={() => l.debtor?.id && void openDossier(l.debtor.id)} className="text-zinc-100 underline decoration-dotted underline-offset-2 hover:text-white">{l.debtor?.id}</button>
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
