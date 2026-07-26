'use client';

// RoyaltyFlowCard — EC2.
//
// The real-money counterpart to <CascadePanel> (app/lenses/creator/page.tsx),
// which is explicit that its numbers are a PROJECTION ("projected share",
// "downstream lineage"). This card reads the actual historical ledger via
// `GET /api/creator/royalty-flow` (server/server.js — thin wrapper over
// `computeRoyaltyFlow`, server/lib/creator-dashboard.js), which composes:
//   1. real economy_ledger ROYALTY_PAYOUT rows (via the canonical
//      CREDIT_ROW_PREDICATE, economy/balances.js), and
//   2. getAncestorChain() (economy/royalty-cascade.js) — the SAME function
//      the actual payout path and the EC1 DTU Lineage tab use.
//
// Every number rendered here came back from that endpoint. No client-side
// fabrication, no estimation — an empty ledger renders an honest empty
// state, never a placeholder amount.
import { useEffect, useState, useCallback } from 'react';
import { Coins, GitBranch, Loader2 } from 'lucide-react';

interface RoyaltyHop {
  ledgerId: string;
  contentId: string | null;
  contentTitle: string | null;
  generation: number | null;
  royaltyRate: number | null;
  royaltyPercent: string | null;
  amount: number;
  fromUserId: string | null;
  toUserId: string | null;
  sourceTxId: string | null;
  crossWorldHop: boolean;
  createdAt: string;
}

interface LineageHop {
  contentId: string;
  contentTitle: string | null;
  generation: number;
  royaltyRate: number;
  royaltyPercent: string;
}

interface RoyaltyFlowResponse {
  ok: boolean;
  userId?: string | null;
  dtuId?: string | null;
  totalCC?: number;
  hopCount?: number;
  byGeneration?: Record<string, number>;
  hops?: RoyaltyHop[];
  lineage?: LineageHop[];
  error?: string;
}

interface TopCited {
  id: string;
  title: string;
  domain: string;
  citationsReceived: number;
}

interface RoyaltyFlowCardProps {
  /** Optional: lets the viewer scope the card to one of their own DTUs
   *  (reuses the same top-cited list the Cascade panel already fetched —
   *  no duplicate request). Omit to show only "my own real earnings". */
  topCited?: TopCited[];
}

const PANEL = 'rounded-lg border border-white/10 bg-black/60 p-4';

export function RoyaltyFlowCard({ topCited = [] }: RoyaltyFlowCardProps) {
  const [scope, setScope] = useState<string>(''); // '' = my own earnings, else a dtuId
  const [data, setData] = useState<RoyaltyFlowResponse | null>(null);
  const [loading, setLoading] = useState(false);
  const [errored, setErrored] = useState(false);

  const load = useCallback(() => {
    setLoading(true);
    setErrored(false);
    const url = scope
      ? `/api/creator/royalty-flow?dtuId=${encodeURIComponent(scope)}`
      : '/api/creator/royalty-flow';
    fetch(url, { credentials: 'include' })
      .then((r) => r.json())
      .then((d: RoyaltyFlowResponse) => {
        if (!d?.ok) { setErrored(true); setData(null); return; }
        setData(d);
      })
      .catch(() => { setErrored(true); setData(null); })
      .finally(() => setLoading(false));
  }, [scope]);

  useEffect(() => { load(); }, [load]);

  const hops = data?.hops ?? [];
  const lineage = data?.lineage ?? [];
  const totalCC = data?.totalCC ?? 0;
  const genEntries = Object.entries(data?.byGeneration ?? {}).sort((a, b) => {
    if (a[0] === 'unknown') return 1;
    if (b[0] === 'unknown') return -1;
    return Number(a[0]) - Number(b[0]);
  });
  const maxGenAmount = Math.max(1, ...genEntries.map(([, v]) => v));

  return (
    <section className={PANEL}>
      <div className="flex flex-wrap items-baseline justify-between gap-2 mb-3">
        <h2 className="text-amber-200 font-semibold inline-flex items-center gap-1.5">
          <Coins className="w-4 h-4" /> Royalty flow — real ledger
        </h2>
        <span className="text-[11px] text-gray-400">
          lineage → earner → CC · actual paid-out royalties, not a projection
        </span>
      </div>

      {topCited.length > 0 && (
        <div className="mb-3">
          <label className="block text-[11px] text-gray-400 mb-1">Scope</label>
          <select
            value={scope}
            onChange={(e) => setScope(e.target.value)}
            className="w-full max-w-md bg-black/60 border border-white/10 rounded px-3 py-2 text-sm text-gray-200"
          >
            <option value="">My real earnings (all DTUs)</option>
            {topCited.map((d) => (
              <option key={d.id} value={d.id}>
                {d.title || d.id.slice(0, 16)} · {d.citationsReceived} citations
              </option>
            ))}
          </select>
        </div>
      )}

      {loading ? (
        <div className="text-xs text-gray-400 italic inline-flex items-center gap-1.5">
          <Loader2 className="w-3.5 h-3.5 animate-spin" /> Reading the ledger…
        </div>
      ) : errored ? (
        <div className="text-xs text-red-300 italic">
          Couldn&apos;t read the royalty ledger just now. Try refreshing.
        </div>
      ) : hops.length === 0 && lineage.length === 0 ? (
        <div className="text-xs text-gray-400 italic">
          No real royalty payouts yet{scope ? ' for this DTU' : ''}. As citations of your
          work turn into real sales, each payout appears here with its exact
          generation, rate, and CC amount — never an estimate.
        </div>
      ) : (
        <div className="space-y-4">
          {hops.length > 0 && (
            <>
              <div className="flex items-baseline gap-4 text-xs text-gray-400">
                <span>
                  <span className="text-emerald-300 font-mono">{totalCC.toFixed(2)} CC</span> real earned
                  {scope ? ' (from this DTU, all earners)' : ''}
                </span>
                <span><span className="text-gray-200 font-mono">{hops.length}</span> payout{hops.length === 1 ? '' : 's'}</span>
              </div>

              {genEntries.length > 0 && (
                <ol className="space-y-1.5">
                  {genEntries.map(([gen, amount]) => {
                    const widthPct = Math.round((amount / maxGenAmount) * 100);
                    return (
                      <li key={gen} className="flex items-center gap-3 text-xs">
                        <span className="w-14 shrink-0 text-amber-400 font-mono">
                          {gen === 'unknown' ? 'gen ?' : `gen ${gen}`}
                        </span>
                        <div className="flex-1 h-5 bg-black/40 rounded overflow-hidden">
                          <div
                            className="h-full bg-gradient-to-r from-emerald-500/60 to-emerald-300/40 flex items-center px-2"
                            style={{ width: `${Math.max(widthPct, 4)}%` }}
                          >
                            <span className="text-[10px] font-mono text-black/70">{amount.toFixed(2)}</span>
                          </div>
                        </div>
                        <span className="w-20 shrink-0 text-right text-emerald-300 font-mono">
                          {amount.toFixed(2)} CC
                        </span>
                      </li>
                    );
                  })}
                </ol>
              )}

              <div>
                <h3 className="text-[11px] text-gray-400 uppercase tracking-wider mb-1.5">Real payouts, newest first</h3>
                <ol className="space-y-1.5 max-h-64 overflow-y-auto pr-1">
                  {hops.map((h) => (
                    <li
                      key={h.ledgerId}
                      className="flex items-center gap-3 text-xs border-b border-white/5 pb-1.5 last:border-0"
                    >
                      <span className="w-16 shrink-0 text-amber-400 font-mono">
                        {h.generation == null ? 'gen ?' : `gen ${h.generation}`}
                      </span>
                      <span className="flex-1 min-w-0 truncate text-gray-200" title={h.contentTitle || h.contentId || undefined}>
                        {h.contentTitle || (h.contentId ? h.contentId.slice(0, 18) : 'unknown source')}
                      </span>
                      <span className="w-16 shrink-0 text-right text-gray-400 font-mono">
                        {h.royaltyPercent ?? '—'}
                      </span>
                      <span className="w-20 shrink-0 text-right text-emerald-300 font-mono">
                        +{h.amount.toFixed(2)} CC
                      </span>
                      <span className="w-20 shrink-0 text-right text-gray-500 font-mono">
                        {h.createdAt.slice(0, 10)}
                      </span>
                    </li>
                  ))}
                </ol>
              </div>
            </>
          )}

          {lineage.length > 0 && (
            <div>
              <h3 className="text-[11px] text-gray-400 uppercase tracking-wider mb-1.5 inline-flex items-center gap-1">
                <GitBranch className="w-3 h-3" /> Real ancestor chain
                {hops.length === 0 && <span className="normal-case text-gray-500">— no sales of this DTU yet</span>}
              </h3>
              <ol className="space-y-1">
                {lineage.map((a) => (
                  <li key={a.contentId} className="flex items-center gap-3 text-xs">
                    <span className="w-16 shrink-0 text-amber-400 font-mono">gen {a.generation}</span>
                    <span className="flex-1 min-w-0 truncate text-gray-300" title={a.contentTitle || a.contentId}>
                      {a.contentTitle || a.contentId.slice(0, 18)}
                    </span>
                    <span className="w-16 shrink-0 text-right text-gray-400 font-mono">{a.royaltyPercent}</span>
                  </li>
                ))}
              </ol>
              <p className="text-[10px] text-gray-500 mt-1">
                This is the real citation lineage (same chain the royalty payout engine
                itself walks) — it shows who would earn what if this DTU sells, even
                before any sale has happened.
              </p>
            </div>
          )}
        </div>
      )}
    </section>
  );
}
