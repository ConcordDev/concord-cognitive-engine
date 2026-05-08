'use client';

import { useEffect, useState, useCallback } from 'react';

import { LensShell } from '@/components/lens/LensShell';
interface CreatorSummary {
  dtuCount: number;
  listingCount: number;
  totalDownloads: number;
  totalEarnings: number;
  citationsReceived: number;
  citationsMade: number;
  lineageDepth: number;
  reputationScore: number;
}

interface DashboardResponse {
  ok: boolean;
  userId?: string;
  summary?: CreatorSummary;
  recentDTUs?: { id: string; title: string; domain: string; createdAt: string }[];
  recentListings?: { id: string; title: string; price: number; downloads: number; promotionSource: string | null }[];
  topCitedDTUs?: { id: string; title: string; domain: string; citationsReceived: number }[];
  error?: string;
}

interface MyListing {
  id: string;
  title: string;
  description?: string;
  price: number;
  status: 'active' | 'withdrawn' | string;
  downloads: number;
  listedAt: string;
}

interface PendingWithdrawal {
  id: string;
  amount: number;
  status: string;
  createdAt: string;
}

interface WithdrawalStatus {
  ok: boolean;
  balance: number;
  eligibleAmount: number;
  pendingHoldAmount: number;
  nextEligibleAt: string | null;
  pendingWithdrawals: PendingWithdrawal[];
  minWithdraw: number;
  holdHours: number;
  error?: string;
}

interface Leader {
  userId: string;
  dtuCount: number;
  citations: number;
  downloads: number;
  score: number;
}

interface TrendingHit {
  id: string;
  title: string;
  domain: string;
  ownerId: string;
  newCitations24h: number;
}

interface DriftHit {
  userId: string;
  recentCitations: number;
  priorCitations: number;
  change: number;
}

const PANEL = 'rounded-lg border border-white/10 bg-black/60 p-4';
const GRID  = 'grid grid-cols-1 md:grid-cols-2 gap-4';

export default function CreatorDashboardPage() {
  const [me, setMe] = useState<DashboardResponse | null>(null);
  const [leaderboard, setLeaderboard] = useState<Leader[]>([]);
  const [trending, setTrending] = useState<TrendingHit[]>([]);
  const [drift, setDrift] = useState<DriftHit[]>([]);
  const [myListings, setMyListings] = useState<MyListing[]>([]);
  const [withdrawal, setWithdrawal] = useState<WithdrawalStatus | null>(null);
  const [withdrawAmount, setWithdrawAmount] = useState('');
  const [withdrawError, setWithdrawError] = useState<string | null>(null);
  const [withdrawing, setWithdrawing] = useState(false);

  const refreshListings = useCallback(() => {
    fetch('/api/creator/listings', { credentials: 'include' })
      .then(r => r.json())
      .then(d => setMyListings((d?.listings ?? []) as MyListing[]))
      .catch(() => {});
  }, []);

  const refreshWithdrawal = useCallback(() => {
    fetch('/api/creator/withdrawal-status', { credentials: 'include' })
      .then(r => r.json())
      .then(d => setWithdrawal(d as WithdrawalStatus))
      .catch(() => {});
  }, []);

  useEffect(() => {
    Promise.all([
      fetch('/api/creator/dashboard', { credentials: 'include' }).then(r => r.json()).catch(() => null),
      fetch('/api/creator/leaderboard?limit=10', { credentials: 'include' }).then(r => r.json()).catch(() => null),
      fetch('/api/creator/trending-citations', { credentials: 'include' }).then(r => r.json()).catch(() => null),
      fetch('/api/creator/influence-drift', { credentials: 'include' }).then(r => r.json()).catch(() => null),
    ]).then(([m, l, t, d]) => {
      setMe(m as DashboardResponse | null);
      setLeaderboard((l?.creators ?? []) as Leader[]);
      setTrending((t?.trending ?? []) as TrendingHit[]);
      setDrift((d?.drift ?? []) as DriftHit[]);
    });
    refreshListings();
    refreshWithdrawal();
  }, [refreshListings, refreshWithdrawal]);

  const requestWithdrawal = useCallback(async () => {
    setWithdrawError(null);
    const amount = Number(withdrawAmount);
    if (!Number.isFinite(amount) || amount <= 0) {
      setWithdrawError('Enter a positive amount.');
      return;
    }
    setWithdrawing(true);
    try {
      const res = await fetch('/api/economy/withdraw', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({ amount }),
      });
      const body = await res.json().catch(() => null);
      if (!res.ok || body?.ok === false) {
        setWithdrawError(body?.error ?? `Request failed (${res.status}).`);
      } else {
        setWithdrawAmount('');
        refreshWithdrawal();
      }
    } catch (e) {
      setWithdrawError(e instanceof Error ? e.message : 'Request failed.');
    } finally {
      setWithdrawing(false);
    }
  }, [withdrawAmount, refreshWithdrawal]);

  const updateListing = useCallback(async (id: string, patch: Partial<MyListing>) => {
    await fetch(`/api/marketplace/listings/${encodeURIComponent(id)}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      credentials: 'include',
      body: JSON.stringify(patch),
    });
    refreshListings();
  }, [refreshListings]);

  const withdrawListing = useCallback(async (id: string) => {
    await fetch(`/api/marketplace/listings/${encodeURIComponent(id)}/withdraw`, {
      method: 'POST',
      credentials: 'include',
    });
    refreshListings();
  }, [refreshListings]);

  const relistListing = useCallback(async (id: string) => {
    await fetch(`/api/marketplace/listings/${encodeURIComponent(id)}/relist`, {
      method: 'POST',
      credentials: 'include',
    });
    refreshListings();
  }, [refreshListings]);

  return (
    <LensShell lensId="creator" asMain={false}>
    <div className="min-h-screen bg-[#0b0f17] text-gray-100 p-6">
      <header className="mb-6">
        <h1 className="text-3xl font-semibold text-amber-300">Creator Dashboard</h1>
        <p className="text-gray-400 mt-1">
          Earnings, lineage, and influence at a glance. All numbers reflect live state.
        </p>
      </header>

      {/* Personal summary */}
      {me?.ok && me.summary ? (
        <section className={`${PANEL} mb-6`}>
          <h2 className="text-amber-200 font-semibold mb-3">Your stats</h2>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
            <Stat label="DTUs"               value={me.summary.dtuCount} />
            <Stat label="Listings"           value={me.summary.listingCount} />
            <Stat label="Downloads"          value={me.summary.totalDownloads} />
            <Stat label="Earnings (CC)"      value={me.summary.totalEarnings} />
            <Stat label="Citations received" value={me.summary.citationsReceived} />
            <Stat label="Citations made"     value={me.summary.citationsMade} />
            <Stat label="Max lineage depth"  value={me.summary.lineageDepth} />
            <Stat label="Reputation score"   value={me.summary.reputationScore} />
          </div>
        </section>
      ) : (
        <div className={`${PANEL} mb-6 text-gray-500 italic`}>
          {me?.error ? `Sign in to see your dashboard.` : 'Loading your stats...'}
        </div>
      )}

      {/* Withdrawal eligibility — turns the 48h hold into a tangible
          earnings-unlock surface so creators see exactly when their
          royalties become spendable. */}
      {withdrawal?.ok && (
        <section className={`${PANEL} mb-6`}>
          <div className="flex flex-wrap items-baseline justify-between gap-2 mb-3">
            <h2 className="text-emerald-300 font-semibold">Earnings &amp; withdrawal</h2>
            <span className="text-[11px] text-gray-500">
              {withdrawal.holdHours}h hold · min {withdrawal.minWithdraw} CC
            </span>
          </div>
          <div className="grid grid-cols-2 md:grid-cols-3 gap-4 mb-4">
            <div>
              <div className="text-[10px] text-gray-500 uppercase tracking-wider">Total balance</div>
              <div className="text-2xl text-emerald-300 font-mono mt-1">{withdrawal.balance.toFixed(2)} CC</div>
            </div>
            <div>
              <div className="text-[10px] text-gray-500 uppercase tracking-wider">Eligible to withdraw</div>
              <div className="text-2xl text-emerald-200 font-mono mt-1">{withdrawal.eligibleAmount.toFixed(2)} CC</div>
            </div>
            <div>
              <div className="text-[10px] text-gray-500 uppercase tracking-wider">In {withdrawal.holdHours}h hold</div>
              <div className="text-2xl text-amber-300 font-mono mt-1">{withdrawal.pendingHoldAmount.toFixed(2)} CC</div>
              {withdrawal.nextEligibleAt && (
                <div className="text-[11px] text-gray-500 mt-1">
                  next unlock {new Date(withdrawal.nextEligibleAt).toLocaleString()}
                </div>
              )}
            </div>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <input
              value={withdrawAmount}
              onChange={(e) => setWithdrawAmount(e.target.value)}
              inputMode="decimal"
              placeholder={`Amount (max ${withdrawal.eligibleAmount.toFixed(2)})`}
              className="flex-1 min-w-[200px] bg-black/60 border border-white/10 rounded px-3 py-2 text-sm text-gray-200 focus:border-emerald-400/60 focus:outline-none"
            />
            <button
              onClick={requestWithdrawal}
              disabled={withdrawing || withdrawal.eligibleAmount < withdrawal.minWithdraw}
              className="px-4 py-2 text-sm font-medium bg-emerald-700 hover:bg-emerald-600 disabled:bg-stone-800 disabled:text-gray-500 rounded text-white"
            >
              {withdrawing ? 'Requesting…' : 'Request withdrawal'}
            </button>
          </div>
          {withdrawError && (
            <p role="alert" className="mt-2 text-xs text-rose-300">
              {withdrawError}
            </p>
          )}
          {withdrawal.pendingWithdrawals.length > 0 && (
            <div className="mt-4 space-y-1.5">
              <div className="text-[11px] text-gray-500 uppercase tracking-wider">In review</div>
              {withdrawal.pendingWithdrawals.map((w) => (
                <div key={w.id} className="flex items-center justify-between text-sm border-l-2 border-emerald-500/40 pl-3">
                  <span className="text-gray-200 font-mono">{w.amount.toFixed(2)} CC</span>
                  <span className="text-gray-500 capitalize">{w.status}</span>
                  <span className="text-gray-600 text-xs">{new Date(w.createdAt).toLocaleDateString()}</span>
                </div>
              ))}
            </div>
          )}
        </section>
      )}

      {/* My listings — edit / withdraw / relist */}
      <section className={`${PANEL} mb-6`}>
        <h2 className="text-amber-200 font-semibold mb-3">Your listings</h2>
        {myListings.length === 0 ? (
          <div className="text-gray-500 italic">No listings yet.</div>
        ) : (
          <div className="space-y-2">
            {myListings.map((l) => (
              <ListingRow
                key={l.id}
                listing={l}
                onUpdate={updateListing}
                onWithdraw={withdrawListing}
                onRelist={relistListing}
              />
            ))}
          </div>
        )}
      </section>

      {/* Cascade tree — for the top-cited DTU, show downstream lineage
          + projected per-generation royalty share. Makes "your work
          earns forever" a visible compounding shape, not just a number. */}
      {me?.ok && (me.topCitedDTUs?.length ?? 0) > 0 && (
        <CascadePanel topCited={me.topCitedDTUs ?? []} />
      )}

      <div className={GRID}>
        {/* Leaderboard */}
        <section className={PANEL}>
          <h2 className="text-violet-300 font-semibold mb-3">Top creators</h2>
          {leaderboard.length === 0 ? (
            <div className="text-gray-500 italic">No data yet.</div>
          ) : (
            <ol className="space-y-1 text-sm">
              {leaderboard.map((c, i) => (
                <li key={c.userId} className="flex items-center gap-3">
                  <span className="w-6 text-amber-400 font-mono">{i + 1}</span>
                  <span className="flex-1 truncate text-gray-200">{c.userId}</span>
                  <span className="text-violet-300 font-mono">{Math.round(c.score)}</span>
                </li>
              ))}
            </ol>
          )}
        </section>

        {/* Trending citations */}
        <section className={PANEL}>
          <h2 className="text-emerald-300 font-semibold mb-3">Trending citations (24h)</h2>
          {trending.length === 0 ? (
            <div className="text-gray-500 italic">No surge.</div>
          ) : (
            <ul className="space-y-2 text-sm">
              {trending.slice(0, 8).map((t) => (
                <li key={t.id} className="border-l-2 border-emerald-400/40 pl-3">
                  <div className="text-gray-100 font-medium truncate">{t.title}</div>
                  <div className="text-xs text-gray-500">
                    {t.domain} · +{t.newCitations24h} new citations
                  </div>
                </li>
              ))}
            </ul>
          )}
        </section>

        {/* Influence drift */}
        <section className={`${PANEL} md:col-span-2`}>
          <h2 className="text-rose-300 font-semibold mb-3">Influence drift (7d)</h2>
          {drift.length === 0 ? (
            <div className="text-gray-500 italic">No significant drift.</div>
          ) : (
            <table className="w-full text-sm">
              <thead className="text-gray-500 text-xs uppercase tracking-wider">
                <tr>
                  <th className="text-left py-1">Creator</th>
                  <th className="text-right py-1">Recent</th>
                  <th className="text-right py-1">Prior</th>
                  <th className="text-right py-1">Change</th>
                </tr>
              </thead>
              <tbody>
                {drift.map((d) => (
                  <tr key={d.userId} className="border-t border-white/5">
                    <td className="py-1 text-gray-200 truncate">{d.userId}</td>
                    <td className="py-1 text-right text-gray-300">{d.recentCitations}</td>
                    <td className="py-1 text-right text-gray-500">{d.priorCitations}</td>
                    <td className={`py-1 text-right font-mono ${d.change > 0 ? 'text-emerald-400' : d.change < 0 ? 'text-rose-400' : 'text-gray-400'}`}>
                      {d.change > 0 ? '+' : ''}{d.change}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </section>
      </div>
    </div>
    </LensShell>
  );
}

function Stat({ label, value }: { label: string; value: number | string }) {
  return (
    <div>
      <div className="text-[10px] text-gray-500 uppercase tracking-wider">{label}</div>
      <div className="text-2xl text-amber-300 font-mono mt-1">{value}</div>
    </div>
  );
}

interface ListingRowProps {
  listing: MyListing;
  onUpdate: (id: string, patch: Partial<MyListing>) => Promise<void>;
  onWithdraw: (id: string) => Promise<void>;
  onRelist: (id: string) => Promise<void>;
}

function ListingRow({ listing, onUpdate, onWithdraw, onRelist }: ListingRowProps) {
  const [editing, setEditing] = useState(false);
  const [price, setPrice] = useState(String(listing.price));
  const [title, setTitle] = useState(listing.title);
  const isWithdrawn = listing.status === 'withdrawn';

  return (
    <div className="border border-white/10 rounded p-3 flex flex-wrap items-center gap-3">
      {!editing ? (
        <>
          <div className="flex-1 min-w-[200px]">
            <div className="text-gray-100 font-medium truncate">{listing.title}</div>
            <div className="text-xs text-gray-500">
              {listing.price} CC · {listing.downloads} downloads · {listing.status}
            </div>
          </div>
          <button onClick={() => setEditing(true)} className="px-2 py-1 text-xs bg-violet-700 hover:bg-violet-600 rounded text-white">edit</button>
          {!isWithdrawn ? (
            <button onClick={() => onWithdraw(listing.id)} className="px-2 py-1 text-xs bg-rose-700 hover:bg-rose-600 rounded text-white">withdraw</button>
          ) : (
            <button onClick={() => onRelist(listing.id)} className="px-2 py-1 text-xs bg-emerald-700 hover:bg-emerald-600 rounded text-white">re-list</button>
          )}
        </>
      ) : (
        <>
          <input value={title} onChange={(e) => setTitle(e.target.value)} className="flex-1 min-w-[180px] bg-black/60 border border-white/10 rounded px-2 py-1 text-sm text-gray-200" />
          <input
            value={price}
            onChange={(e) => setPrice(e.target.value)}
            inputMode="decimal"
            className="w-24 bg-black/60 border border-white/10 rounded px-2 py-1 text-sm text-gray-200"
          />
          <button
            onClick={async () => {
              await onUpdate(listing.id, { title, price: Number(price) || 0 });
              setEditing(false);
            }}
            className="px-2 py-1 text-xs bg-amber-600 hover:bg-amber-500 rounded text-white"
          >save</button>
          <button onClick={() => { setEditing(false); setPrice(String(listing.price)); setTitle(listing.title); }} className="px-2 py-1 text-xs bg-stone-700 rounded text-gray-200">cancel</button>
        </>
      )}
    </div>
  );
}

// ── Cascade panel ────────────────────────────────────────────────────────────

interface CascadeGeneration {
  depth: number;
  count: number;
  rate: number;
  projectedShare: number;
}

interface CascadeResponse {
  ok: boolean;
  rootId: string;
  generations: CascadeGeneration[];
  totalDownstream: number;
  maxObservedDepth: number;
}

interface CascadePanelProps {
  topCited: { id: string; title: string; domain: string; citationsReceived: number }[];
}

function CascadePanel({ topCited }: CascadePanelProps) {
  const [selected, setSelected] = useState<string>(topCited[0]?.id ?? '');
  const [tree, setTree] = useState<CascadeResponse | null>(null);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (!selected) {
      setTree(null);
      return;
    }
    setLoading(true);
    fetch(`/api/creator/cascade/${encodeURIComponent(selected)}?maxDepth=6`, {
      credentials: 'include',
    })
      .then((r) => r.json())
      .then((d) => setTree(d as CascadeResponse))
      .catch(() => setTree(null))
      .finally(() => setLoading(false));
  }, [selected]);

  // Width-by-count visualization scale.
  const maxCount = tree
    ? Math.max(1, ...tree.generations.map((g) => g.count))
    : 1;

  return (
    <section className={`${PANEL} mb-6`}>
      <div className="flex flex-wrap items-baseline justify-between gap-2 mb-3">
        <h2 className="text-amber-200 font-semibold">Royalty cascade</h2>
        <span className="text-[11px] text-gray-500">
          downstream lineage · projected per-generation share
        </span>
      </div>
      <div className="mb-3">
        <label className="block text-[11px] text-gray-500 mb-1">Top-cited DTU</label>
        <select
          value={selected}
          onChange={(e) => setSelected(e.target.value)}
          className="w-full max-w-md bg-black/60 border border-white/10 rounded px-3 py-2 text-sm text-gray-200"
        >
          {topCited.map((d) => (
            <option key={d.id} value={d.id}>
              {d.title || d.id.slice(0, 16)} · {d.citationsReceived} citations
            </option>
          ))}
        </select>
      </div>
      {loading ? (
        <div className="text-xs text-gray-500 italic">Walking lineage…</div>
      ) : !tree?.ok || tree.generations.length === 0 ? (
        <div className="text-xs text-gray-500 italic">
          No downstream citations yet for this DTU. As other creators cite or remix
          your work, generations appear here — each one paying you a halving share
          forever (floor 0.05%).
        </div>
      ) : (
        <div className="space-y-2">
          <div className="flex items-baseline gap-4 text-xs text-gray-400">
            <span><span className="text-gray-200 font-mono">{tree.totalDownstream}</span> downstream DTUs</span>
            <span><span className="text-gray-200 font-mono">{tree.maxObservedDepth}</span> generations deep</span>
            <span className="text-amber-300/80">
              projected share total:{' '}
              <span className="font-mono">
                {tree.generations.reduce((s, g) => s + g.projectedShare, 0).toFixed(2)}
              </span>
              {' '}× sale
            </span>
          </div>
          <ol className="space-y-1.5 mt-3">
            {tree.generations.map((g) => {
              const widthPct = Math.round((g.count / maxCount) * 100);
              return (
                <li key={g.depth} className="flex items-center gap-3 text-xs">
                  <span className="w-12 shrink-0 text-amber-400 font-mono">gen {g.depth}</span>
                  <div className="flex-1 h-5 bg-black/40 rounded overflow-hidden">
                    <div
                      className="h-full bg-gradient-to-r from-amber-500/60 to-amber-300/40 flex items-center px-2"
                      style={{ width: `${widthPct}%` }}
                    >
                      <span className="text-[10px] font-mono text-black/70">{g.count}</span>
                    </div>
                  </div>
                  <span className="w-20 shrink-0 text-right text-amber-300 font-mono">
                    {(g.rate * 100).toFixed(2)}%
                  </span>
                  <span className="w-24 shrink-0 text-right text-emerald-300 font-mono">
                    +{g.projectedShare.toFixed(2)}× sale
                  </span>
                </li>
              );
            })}
          </ol>
          <p className="text-[10px] text-gray-500 mt-2">
            Projected share = count × generational-rate. Royalties halve per generation
            (initial 21%) with a 0.05% floor — so a 4-deep cascade with 10 / 25 / 60 / 140
            downstream DTUs still pays the original creator on every transaction.
          </p>
        </div>
      )}
    </section>
  );
}
