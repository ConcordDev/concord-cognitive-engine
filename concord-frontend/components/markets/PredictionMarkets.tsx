'use client';

/* eslint-disable @typescript-eslint/no-explicit-any */

/**
 * PredictionMarkets — Polymarket / Kalshi parity surface for the markets lens.
 *
 * SPARKS-only, non-extractive event-prediction substrate. Wires the
 * `markets.*` prediction macros: market-create, market-list (categories +
 * search + trending + closing-soon), market-get, market-odds, market-history
 * (price-history chart), position-open, my-positions (mark-to-market),
 * position-cashout, order-place / order-cancel / order-book (limit orders),
 * market-resolve / market-resolution (evidence + dispute view), leaderboard.
 *
 * Every value rendered comes from a real macro response — no mock data.
 */

import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  TrendingUp, Plus, Loader2, X, Trophy, BarChart3, Tag, Search, Clock,
  Flame, ListOrdered, LogOut, Gavel, ShieldCheck,
} from 'lucide-react';
import { lensRun } from '@/lib/api/client';
import { ChartKit } from '@/components/viz';

// ── Types (prediction-market macro payloads) ──

interface PMMarket {
  id: string;
  question: string;
  description: string;
  category: string;
  resolutionCriteria: string;
  creatorId: string;
  poolYes: number;
  poolNo: number;
  totalPool: number;
  yesProbability: number;
  noProbability: number;
  yesPercent: number;
  noPercent: number;
  status: string;
  outcome: string | null;
  openedAt: number;
  closesAt: number | null;
  resolvedAt: number | null;
  tradeCount: number;
  resolution: PMResolution | null;
}

interface PMResolution {
  outcome: string;
  evidence: string;
  evidenceUrl: string | null;
  resolvedBy: string;
  resolvedAt: number;
}

interface PMPosition {
  id: string;
  marketId: string;
  userId: string;
  side: 'yes' | 'no';
  stakeSparks: number;
  entryPrice: number;
  openedAt: number;
  status: 'open' | 'cashed_out' | 'won' | 'lost';
  payoutSparks: number | null;
  realizedPnl: number | null;
  closedAt: number | null;
  question: string | null;
  marketStatus: string;
  currentValue: number | null;
  unrealizedPnl: number | null;
}

interface PMOrder {
  id: string;
  marketId: string;
  side: 'yes' | 'no';
  limitPrice: number;
  stakeSparks: number;
  status: 'open' | 'filled' | 'cancelled';
  createdAt: number;
}

interface PMOrderBook {
  marketId: string;
  currentYesProbability: number;
  yesBids: Array<{ price: number; size: number }>;
  noBids: Array<{ price: number; size: number }>;
  restingCount: number;
  myOrders: PMOrder[];
}

interface PMHistoryPoint {
  t: number;
  iso: string;
  yesProbability: number;
  yesPercent: number;
  poolYes: number;
  poolNo: number;
}

interface PMLeaderRow {
  rank: number;
  userId: string;
  realizedPnl: number;
  staked: number;
  wins: number;
  losses: number;
  cashouts: number;
  openPositions: number;
  total: number;
  winRate: number | null;
  roi: number | null;
}

interface PMOdds {
  yesPercent: number;
  noPercent: number;
  yesMultiple: number;
  noMultiple: number;
  yesStakePayoutIfWin: number;
  noStakePayoutIfWin: number;
}

type Tab = 'browse' | 'positions' | 'leaderboard';

async function run<T = any>(action: string, input: Record<string, unknown> = {}) {
  const r = await lensRun<T>('markets', action, input);
  return r.data;
}

// ─────────────────────────────────────────────────────────────

export default function PredictionMarkets() {
  const [tab, setTab] = useState<Tab>('browse');
  const [markets, setMarkets] = useState<PMMarket[]>([]);
  const [facets, setFacets] = useState<Record<string, number>>({});
  const [categories, setCategories] = useState<string[]>([]);
  const [positions, setPositions] = useState<PMPosition[]>([]);
  const [leaderboard, setLeaderboard] = useState<PMLeaderRow[]>([]);
  const [loading, setLoading] = useState(false);
  const [status, setStatus] = useState<string | null>(null);
  const [selected, setSelected] = useState<string | null>(null);
  const [showCreate, setShowCreate] = useState(false);

  // browse filters
  const [search, setSearch] = useState('');
  const [category, setCategory] = useState<string>('');
  const [sort, setSort] = useState('newest');

  const flash = useCallback((msg: string) => {
    setStatus(msg);
    window.setTimeout(() => setStatus(null), 4200);
  }, []);

  const loadMarkets = useCallback(async () => {
    setLoading(true);
    const d = await run('market-list', {
      search: search || undefined,
      category: category || undefined,
      sort,
      limit: 100,
    });
    if (d.ok && d.result) {
      const res = d.result as { markets: PMMarket[]; facets: Record<string, number>; categories: string[] };
      setMarkets(res.markets || []);
      setFacets(res.facets || {});
      setCategories(res.categories || []);
    }
    setLoading(false);
  }, [search, category, sort]);

  const loadPositions = useCallback(async () => {
    const d = await run('my-positions', {});
    if (d.ok && d.result) setPositions((d.result as { positions: PMPosition[] }).positions || []);
  }, []);

  const loadLeaderboard = useCallback(async () => {
    const d = await run('leaderboard', { limit: 50 });
    if (d.ok && d.result) setLeaderboard((d.result as { leaderboard: PMLeaderRow[] }).leaderboard || []);
  }, []);

  // initial load
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => { void loadMarkets(); void loadPositions(); void loadLeaderboard(); }, []);

  useEffect(() => {
    if (tab === 'positions') void loadPositions();
    if (tab === 'leaderboard') void loadLeaderboard();
  }, [tab, loadPositions, loadLeaderboard]);

  const refreshAll = useCallback(async () => {
    await Promise.all([loadMarkets(), loadPositions(), loadLeaderboard()]);
  }, [loadMarkets, loadPositions, loadLeaderboard]);

  return (
    <section className="rounded-xl border border-indigo-800/40 bg-indigo-950/20 p-4">
      <header className="mb-3 flex items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <TrendingUp className="h-4 w-4 text-indigo-400" />
          <h2 className="text-sm font-bold uppercase tracking-wider text-indigo-200">Prediction Markets</h2>
          <span className="text-[10px] text-indigo-500">Polymarket-style · SPARKS · non-extractive</span>
        </div>
        <button
          type="button"
          onClick={() => setShowCreate((v) => !v)}
          className="inline-flex items-center gap-1 rounded-md border border-indigo-500/40 bg-indigo-500/15 px-2.5 py-1 text-xs text-indigo-100 hover:bg-indigo-500/25"
        >
          <Plus className="h-3 w-3" /> Propose market
        </button>
      </header>

      {status && (
        <div className="mb-3 rounded-lg border border-indigo-700/50 bg-indigo-950/60 px-3 py-2 text-xs text-indigo-200">
          {status}
        </div>
      )}

      {showCreate && (
        <CreateMarketForm
          categories={categories}
          onClose={() => setShowCreate(false)}
          onCreated={async (q) => { setShowCreate(false); flash(`✓ Market created: "${q}"`); await loadMarkets(); }}
        />
      )}

      <nav className="mb-3 flex items-center gap-1">
        {([
          { id: 'browse', label: 'Browse', icon: BarChart3 },
          { id: 'positions', label: 'My Positions', icon: ListOrdered },
          { id: 'leaderboard', label: 'Leaderboard', icon: Trophy },
        ] as const).map((t) => {
          const Icon = t.icon;
          const active = tab === t.id;
          return (
            <button
              key={t.id}
              type="button"
              onClick={() => setTab(t.id)}
              className={`inline-flex items-center gap-1.5 rounded px-2.5 py-1 text-xs transition ${
                active
                  ? 'border border-indigo-500/40 bg-indigo-500/15 text-indigo-200'
                  : 'border border-transparent text-zinc-400 hover:text-zinc-200'
              }`}
            >
              <Icon className="h-3 w-3" /> {t.label}
            </button>
          );
        })}
      </nav>

      {tab === 'browse' && (
        <BrowseTab
          markets={markets}
          facets={facets}
          categories={categories}
          loading={loading}
          search={search}
          setSearch={setSearch}
          category={category}
          setCategory={setCategory}
          sort={sort}
          setSort={setSort}
          onApply={loadMarkets}
          onOpen={setSelected}
        />
      )}
      {tab === 'positions' && <PositionsTab positions={positions} onChanged={refreshAll} flash={flash} />}
      {tab === 'leaderboard' && <LeaderboardTab rows={leaderboard} />}

      {selected && (
        <MarketDetail
          marketId={selected}
          onClose={() => setSelected(null)}
          onChanged={refreshAll}
          flash={flash}
        />
      )}
    </section>
  );
}

// ── Create market ──

function CreateMarketForm({
  categories, onClose, onCreated,
}: {
  categories: string[];
  onClose: () => void;
  onCreated: (question: string) => void;
}) {
  const [question, setQuestion] = useState('');
  const [resolutionCriteria, setCriteria] = useState('');
  const [description, setDescription] = useState('');
  const [category, setCategory] = useState('other');
  const [closesIn, setClosesIn] = useState('7');
  const [seedSparks, setSeed] = useState('10');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const submit = async () => {
    setBusy(true);
    setErr(null);
    const closesAt = Number(closesIn) > 0 ? Date.now() + Number(closesIn) * 86_400_000 : null;
    const d = await run('market-create', {
      question,
      resolutionCriteria,
      description,
      category,
      closesAt,
      seedSparks: Number(seedSparks) || 10,
    });
    setBusy(false);
    if (d.ok) onCreated(question);
    else setErr(d.error || 'create failed');
  };

  return (
    <div className="mb-3 rounded-lg border border-indigo-500/30 bg-indigo-950/40 p-3">
      <div className="mb-2 flex items-center justify-between">
        <span className="text-xs font-semibold text-indigo-200">Propose a new market</span>
        <button type="button" onClick={onClose} className="text-zinc-500 hover:text-zinc-300" aria-label="Close">
          <X className="h-3.5 w-3.5" />
        </button>
      </div>
      <div className="space-y-2">
        <input
          type="text" value={question} onChange={(e) => setQuestion(e.target.value)}
          placeholder="Question (e.g. Will the raid succeed tonight?)" maxLength={240}
          className="w-full rounded border border-white/10 bg-black/40 px-2 py-1.5 text-xs text-zinc-100"
        />
        <textarea
          value={resolutionCriteria} onChange={(e) => setCriteria(e.target.value)}
          placeholder="Resolution criteria — exactly how this resolves YES vs NO" rows={2}
          className="w-full rounded border border-white/10 bg-black/40 px-2 py-1.5 text-xs text-zinc-100"
        />
        <textarea
          value={description} onChange={(e) => setDescription(e.target.value)}
          placeholder="Description / context (optional)" rows={2}
          className="w-full rounded border border-white/10 bg-black/40 px-2 py-1.5 text-xs text-zinc-100"
        />
        <div className="grid grid-cols-3 gap-2">
          <select
            value={category} onChange={(e) => setCategory(e.target.value)}
            className="rounded border border-white/10 bg-black/40 px-2 py-1.5 text-xs text-zinc-100"
          >
            {categories.map((c) => <option key={c} value={c}>{c}</option>)}
          </select>
          <input
            type="number" min={0} value={closesIn} onChange={(e) => setClosesIn(e.target.value)}
            placeholder="Closes in (days)"
            className="rounded border border-white/10 bg-black/40 px-2 py-1.5 text-xs text-zinc-100"
            title="Days until the market closes (0 = no close)"
          />
          <input
            type="number" min={2} max={200} value={seedSparks} onChange={(e) => setSeed(e.target.value)}
            placeholder="Seed ⚡"
            className="rounded border border-white/10 bg-black/40 px-2 py-1.5 text-xs text-zinc-100"
            title="Creator-funded seed liquidity (SPARKS)"
          />
        </div>
        {err && <p className="text-[11px] text-rose-400">{err}</p>}
        <button
          type="button" onClick={submit} disabled={busy}
          className="rounded-md border border-indigo-500/40 bg-indigo-500/20 px-3 py-1.5 text-xs text-indigo-100 disabled:opacity-50"
        >
          {busy ? <Loader2 className="h-3 w-3 animate-spin" /> : 'Create market'}
        </button>
      </div>
    </div>
  );
}

// ── Browse tab — categories, search, trending, closing-soon ──

function BrowseTab({
  markets, facets, categories, loading, search, setSearch, category, setCategory,
  sort, setSort, onApply, onOpen,
}: {
  markets: PMMarket[];
  facets: Record<string, number>;
  categories: string[];
  loading: boolean;
  search: string;
  setSearch: (v: string) => void;
  category: string;
  setCategory: (v: string) => void;
  sort: string;
  setSort: (v: string) => void;
  onApply: () => void;
  onOpen: (id: string) => void;
}) {
  return (
    <div>
      <div className="mb-3 flex flex-wrap items-center gap-2">
        <div className="relative flex-1 min-w-[160px]">
          <Search className="pointer-events-none absolute left-2 top-1/2 h-3 w-3 -translate-y-1/2 text-zinc-500" />
          <input
            type="text" value={search} onChange={(e) => setSearch(e.target.value)}
            onKeyDown={(e) => { if (e.key === 'Enter') onApply(); }}
            placeholder="Search markets…"
            className="w-full rounded border border-white/10 bg-black/40 py-1.5 pl-7 pr-2 text-xs text-zinc-100"
          />
        </div>
        <select
          value={sort} onChange={(e) => setSort(e.target.value)}
          className="rounded border border-white/10 bg-black/40 px-2 py-1.5 text-xs text-zinc-100"
        >
          <option value="newest">Newest</option>
          <option value="trending">Trending</option>
          <option value="volume">Volume</option>
          <option value="closing">Closing soon</option>
        </select>
        <button
          type="button" onClick={onApply}
          className="rounded-md border border-indigo-500/40 bg-indigo-500/15 px-2.5 py-1.5 text-xs text-indigo-100"
        >
          Apply
        </button>
      </div>

      <div className="mb-3 flex flex-wrap gap-1">
        <button
          type="button" onClick={() => { setCategory(''); onApply(); }}
          className={`rounded-full px-2 py-0.5 text-[10px] ${
            category === '' ? 'bg-indigo-500/25 text-indigo-100' : 'bg-zinc-800/60 text-zinc-400'
          }`}
        >
          all
        </button>
        {categories.map((c) => (
          <button
            key={c} type="button" onClick={() => { setCategory(c); onApply(); }}
            className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[10px] ${
              category === c ? 'bg-indigo-500/25 text-indigo-100' : 'bg-zinc-800/60 text-zinc-400'
            }`}
          >
            <Tag className="h-2.5 w-2.5" />{c}
            <span className="text-zinc-500">{facets[c] ?? 0}</span>
          </button>
        ))}
      </div>

      {loading ? (
        <div className="flex items-center justify-center py-8 text-xs text-zinc-500">
          <Loader2 className="mr-2 h-4 w-4 animate-spin" />Loading markets…
        </div>
      ) : markets.length === 0 ? (
        <div className="rounded-lg border border-zinc-800 py-8 text-center text-xs italic text-zinc-500">
          No markets match. Propose one to start the book.
        </div>
      ) : (
        <ul className="space-y-2">
          {markets.map((m) => (
            <li key={m.id}>
              <button
                type="button" onClick={() => onOpen(m.id)}
                className="w-full rounded-lg border border-zinc-700/50 bg-zinc-900/70 p-3 text-left hover:border-indigo-600/50"
              >
                <div className="mb-1 flex items-start justify-between gap-2">
                  <span className="text-sm font-semibold text-zinc-100">{m.question}</span>
                  <span className={`shrink-0 rounded px-1.5 py-0.5 text-[10px] ${
                    m.status === 'open' ? 'bg-emerald-900/50 text-emerald-300'
                      : m.status === 'resolved' ? 'bg-indigo-900/50 text-indigo-300'
                        : 'bg-zinc-800 text-zinc-400'
                  }`}>{m.status}</span>
                </div>
                <ProbabilityBar yesPercent={m.yesPercent} />
                <p className="mt-1.5 flex flex-wrap items-center gap-x-3 gap-y-0.5 font-mono text-[10px] text-zinc-500">
                  <span className="inline-flex items-center gap-1"><Tag className="h-2.5 w-2.5" />{m.category}</span>
                  <span>pool {m.totalPool} ⚡</span>
                  <span>{m.tradeCount} trades</span>
                  {m.closesAt && (
                    <span className="inline-flex items-center gap-1">
                      <Clock className="h-2.5 w-2.5" />
                      {m.closesAt > Date.now()
                        ? `closes ${new Date(m.closesAt).toLocaleDateString()}`
                        : 'past close'}
                    </span>
                  )}
                  {sort === 'trending' && m.tradeCount > 0 && (
                    <span className="inline-flex items-center gap-1 text-amber-400"><Flame className="h-2.5 w-2.5" />hot</span>
                  )}
                </p>
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function ProbabilityBar({ yesPercent }: { yesPercent: number }) {
  return (
    <div>
      <div className="flex h-2 overflow-hidden rounded-full bg-zinc-800">
        <div className="bg-emerald-600" style={{ width: `${yesPercent}%` }} />
        <div className="bg-rose-600" style={{ width: `${100 - yesPercent}%` }} />
      </div>
      <div className="mt-0.5 flex justify-between text-[10px] font-mono">
        <span className="text-emerald-400">YES {yesPercent}%</span>
        <span className="text-rose-400">NO {100 - yesPercent}%</span>
      </div>
    </div>
  );
}

// ── Market detail — odds, history chart, bet, order book, resolution ──

function MarketDetail({
  marketId, onClose, onChanged, flash,
}: {
  marketId: string;
  onClose: () => void;
  onChanged: () => Promise<void> | void;
  flash: (m: string) => void;
}) {
  const [market, setMarket] = useState<PMMarket | null>(null);
  const [history, setHistory] = useState<PMHistoryPoint[]>([]);
  const [odds, setOdds] = useState<PMOdds | null>(null);
  const [book, setBook] = useState<PMOrderBook | null>(null);
  const [resolution, setResolution] = useState<any | null>(null);
  const [stake, setStake] = useState(10);
  const [side, setSide] = useState<'yes' | 'no'>('yes');
  const [limitPrice, setLimitPrice] = useState('0.50');
  const [busy, setBusy] = useState(false);
  // resolution form (creator)
  const [resolveOutcome, setResolveOutcome] = useState<'yes' | 'no'>('yes');
  const [evidence, setEvidence] = useState('');
  const [evidenceUrl, setEvidenceUrl] = useState('');

  const refresh = useCallback(async () => {
    const [g, h, b, r] = await Promise.all([
      run('market-get', { marketId }),
      run('market-history', { marketId }),
      run('order-book', { marketId }),
      run('market-resolution', { marketId }),
    ]);
    if (g.ok && g.result) setMarket((g.result as { market: PMMarket }).market);
    if (h.ok && h.result) setHistory((h.result as { points: PMHistoryPoint[] }).points || []);
    if (b.ok && b.result) setBook(b.result as PMOrderBook);
    if (r.ok && r.result) setResolution(r.result);
  }, [marketId]);

  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => { void refresh(); }, [marketId]);

  // live odds preview reacts to stake changes
  useEffect(() => {
    let cancelled = false;
    (async () => {
      const d = await run('market-odds', { marketId, stake });
      if (!cancelled && d.ok && d.result) setOdds(d.result as PMOdds);
    })();
    return () => { cancelled = true; };
  }, [marketId, stake, market]);

  const placeBet = async () => {
    setBusy(true);
    const d = await run('position-open', { marketId, side, stakeSparks: stake });
    setBusy(false);
    if (d.ok) { flash(`✓ Staked ${stake} ⚡ ${side.toUpperCase()}`); await refresh(); await onChanged(); }
    else flash(`Failed: ${d.error}`);
  };

  const placeOrder = async () => {
    setBusy(true);
    const d = await run('order-place', { marketId, side, limitPrice: Number(limitPrice), stakeSparks: stake });
    setBusy(false);
    if (d.ok) {
      const res = d.result as { immediatelyFilled: boolean };
      flash(res.immediatelyFilled ? '✓ Limit order filled immediately' : '✓ Limit order resting in book');
      await refresh(); await onChanged();
    } else flash(`Failed: ${d.error}`);
  };

  const cancelOrder = async (orderId: string) => {
    const d = await run('order-cancel', { orderId });
    if (d.ok) { flash('✓ Order cancelled'); await refresh(); }
    else flash(`Failed: ${d.error}`);
  };

  const resolve = async () => {
    setBusy(true);
    const d = await run('market-resolve', {
      marketId, outcome: resolveOutcome, evidence, evidenceUrl: evidenceUrl || undefined,
    });
    setBusy(false);
    if (d.ok) {
      const s = (d.result as { settlement: { winners: number; totalPaidSparks: number } }).settlement;
      flash(`✓ Resolved ${resolveOutcome.toUpperCase()} · ${s.winners} winners paid ${s.totalPaidSparks} ⚡`);
      await refresh(); await onChanged();
    } else flash(`Failed: ${d.error}`);
  };

  const chartData = useMemo(
    () => history.map((p) => ({ time: new Date(p.t).toLocaleString(), yes: p.yesPercent })),
    [history],
  );

  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-black/70 p-4">
      <div className="my-8 w-full max-w-2xl rounded-xl border border-indigo-700/50 bg-[#0d1117] p-5">
        <div className="mb-3 flex items-start justify-between gap-3">
          <h3 className="text-base font-bold text-zinc-100">{market?.question || 'Loading…'}</h3>
          <button type="button" onClick={onClose} className="shrink-0 text-zinc-500 hover:text-zinc-300" aria-label="Close">
            <X className="h-4 w-4" />
          </button>
        </div>

        {!market ? (
          <div className="flex items-center justify-center py-10 text-xs text-zinc-500">
            <Loader2 className="mr-2 h-4 w-4 animate-spin" />Loading market…
          </div>
        ) : (
          <div className="space-y-4">
            <ProbabilityBar yesPercent={market.yesPercent} />
            <p className="text-[11px] text-zinc-400">
              <span className="font-semibold text-zinc-300">Resolution criteria: </span>
              {market.resolutionCriteria}
            </p>
            {market.description && <p className="text-[11px] text-zinc-500">{market.description}</p>}
            <p className="font-mono text-[10px] text-zinc-600">
              {market.category} · pool {market.totalPool} ⚡ · {market.tradeCount} trades · status {market.status}
            </p>

            {/* Price-history chart */}
            <div>
              <p className="mb-1 text-[11px] font-semibold uppercase tracking-wider text-zinc-400">
                Odds over time (YES %)
              </p>
              <ChartKit
                kind="area"
                data={chartData}
                xKey="time"
                series={[{ key: 'yes', label: 'YES %', color: '#22c55e' }]}
                height={160}
                showLegend={false}
              />
            </div>

            {market.status === 'open' && (
              <>
                {/* Live odds + bet */}
                <div className="rounded-lg border border-zinc-800 bg-zinc-950/40 p-3">
                  <div className="mb-2 flex items-center gap-2">
                    <button
                      type="button" onClick={() => setSide('yes')}
                      className={`flex-1 rounded py-1.5 text-xs font-medium ${
                        side === 'yes' ? 'bg-emerald-700 text-white' : 'bg-zinc-800 text-zinc-400'
                      }`}
                    >
                      YES {odds ? `· ${odds.yesMultiple}×` : ''}
                    </button>
                    <button
                      type="button" onClick={() => setSide('no')}
                      className={`flex-1 rounded py-1.5 text-xs font-medium ${
                        side === 'no' ? 'bg-rose-700 text-white' : 'bg-zinc-800 text-zinc-400'
                      }`}
                    >
                      NO {odds ? `· ${odds.noMultiple}×` : ''}
                    </button>
                  </div>
                  <div className="flex items-center gap-2">
                    <label className="text-[10px] text-zinc-500">Stake ⚡</label>
                    <input
                      type="number" min={1} value={stake}
                      onChange={(e) => setStake(Math.max(1, Number(e.target.value) || 1))}
                      className="w-20 rounded border border-zinc-700 bg-zinc-950 px-2 py-1 text-xs text-zinc-100"
                    />
                    {odds && (
                      <span className="text-[10px] text-zinc-500">
                        payout if win:{' '}
                        <span className="text-amber-400">
                          {side === 'yes' ? odds.yesStakePayoutIfWin : odds.noStakePayoutIfWin} ⚡
                        </span>
                      </span>
                    )}
                  </div>
                  <div className="mt-2 grid grid-cols-2 gap-2">
                    <button
                      type="button" onClick={placeBet} disabled={busy}
                      className="rounded bg-indigo-600 py-1.5 text-xs font-medium text-white hover:bg-indigo-500 disabled:opacity-50"
                    >
                      Place pooled bet
                    </button>
                    <div className="flex items-center gap-1">
                      <input
                        type="number" min={0.01} max={0.99} step={0.01} value={limitPrice}
                        onChange={(e) => setLimitPrice(e.target.value)}
                        className="w-16 rounded border border-zinc-700 bg-zinc-950 px-1.5 py-1 text-xs text-zinc-100"
                        title="Limit price (probability 0-1)"
                      />
                      <button
                        type="button" onClick={placeOrder} disabled={busy}
                        className="flex-1 rounded border border-cyan-500/40 bg-cyan-500/15 py-1.5 text-xs text-cyan-100 disabled:opacity-50"
                      >
                        Limit order
                      </button>
                    </div>
                  </div>
                </div>

                {/* Order book */}
                {book && (
                  <div>
                    <p className="mb-1 flex items-center gap-1 text-[11px] font-semibold uppercase tracking-wider text-zinc-400">
                      <ListOrdered className="h-3 w-3" /> Order book · {book.restingCount} resting
                    </p>
                    <div className="grid grid-cols-2 gap-2">
                      <OrderColumn title="YES bids" rows={book.yesBids} color="emerald" />
                      <OrderColumn title="NO bids" rows={book.noBids} color="rose" />
                    </div>
                    {book.myOrders.filter((o) => o.status === 'open').length > 0 && (
                      <div className="mt-2 space-y-1">
                        <p className="text-[10px] uppercase text-zinc-500">My resting orders</p>
                        {book.myOrders.filter((o) => o.status === 'open').map((o) => (
                          <div key={o.id} className="flex items-center justify-between rounded border border-white/5 bg-black/30 px-2 py-1 text-[11px]">
                            <span className="font-mono text-zinc-300">
                              {o.side.toUpperCase()} {o.stakeSparks} ⚡ @ {o.limitPrice}
                            </span>
                            <button
                              type="button" onClick={() => cancelOrder(o.id)}
                              className="text-zinc-500 hover:text-rose-400"
                            >
                              cancel
                            </button>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                )}

                {/* Resolution (creator only — server enforces) */}
                <details className="rounded-lg border border-zinc-800 bg-zinc-950/40 p-3">
                  <summary className="flex cursor-pointer items-center gap-1.5 text-[11px] font-semibold text-zinc-300">
                    <Gavel className="h-3 w-3" /> Resolve market (creator only)
                  </summary>
                  <div className="mt-2 space-y-2">
                    <div className="flex gap-2">
                      <button
                        type="button" onClick={() => setResolveOutcome('yes')}
                        className={`flex-1 rounded py-1 text-xs ${resolveOutcome === 'yes' ? 'bg-emerald-700 text-white' : 'bg-zinc-800 text-zinc-400'}`}
                      >
                        YES
                      </button>
                      <button
                        type="button" onClick={() => setResolveOutcome('no')}
                        className={`flex-1 rounded py-1 text-xs ${resolveOutcome === 'no' ? 'bg-rose-700 text-white' : 'bg-zinc-800 text-zinc-400'}`}
                      >
                        NO
                      </button>
                    </div>
                    <textarea
                      value={evidence} onChange={(e) => setEvidence(e.target.value)}
                      placeholder="Evidence — how was this verified? (>= 8 chars)" rows={2}
                      className="w-full rounded border border-white/10 bg-black/40 px-2 py-1.5 text-xs text-zinc-100"
                    />
                    <input
                      type="text" value={evidenceUrl} onChange={(e) => setEvidenceUrl(e.target.value)}
                      placeholder="Evidence URL (optional)"
                      className="w-full rounded border border-white/10 bg-black/40 px-2 py-1.5 text-xs text-zinc-100"
                    />
                    <button
                      type="button" onClick={resolve} disabled={busy}
                      className="rounded-md border border-amber-500/40 bg-amber-500/15 px-3 py-1.5 text-xs text-amber-100 disabled:opacity-50"
                    >
                      Resolve &amp; settle
                    </button>
                  </div>
                </details>
              </>
            )}

            {/* Resolution / dispute view */}
            {resolution?.resolved && (
              <div className="rounded-lg border border-indigo-700/40 bg-indigo-950/40 p-3">
                <p className="flex items-center gap-1.5 text-[11px] font-semibold text-indigo-200">
                  <ShieldCheck className="h-3.5 w-3.5" /> Resolved {resolution.resolution.outcome?.toUpperCase()}
                </p>
                <p className="mt-1 text-[11px] text-zinc-300">{resolution.resolution.evidence}</p>
                {resolution.resolution.evidenceUrl && (
                  <a
                    href={resolution.resolution.evidenceUrl} target="_blank" rel="noreferrer"
                    className="mt-1 inline-block text-[10px] text-cyan-400 underline"
                  >
                    evidence source
                  </a>
                )}
                <p className="mt-1 font-mono text-[10px] text-zinc-500">
                  {resolution.winners} winners · {resolution.losers} losers · settled {resolution.settledPositions}
                  {' · '}final YES {Math.round((resolution.finalYesProbability || 0) * 100)}%
                </p>
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

function OrderColumn({
  title, rows, color,
}: {
  title: string;
  rows: Array<{ price: number; size: number }>;
  color: 'emerald' | 'rose';
}) {
  const txt = color === 'emerald' ? 'text-emerald-300' : 'text-rose-300';
  const border = color === 'emerald' ? 'border-emerald-500/20' : 'border-rose-500/20';
  return (
    <div className={`overflow-hidden rounded border ${border}`}>
      <p className={`px-2 py-1 text-[10px] uppercase ${txt} bg-white/5`}>{title}</p>
      {rows.length === 0 ? (
        <p className="px-2 py-2 text-[10px] text-zinc-600">no resting orders</p>
      ) : rows.map((r, i) => (
        <div key={i} className="flex justify-between border-t border-white/5 px-2 py-1 font-mono text-[11px]">
          <span className={txt}>{r.price}</span>
          <span className="text-zinc-400">{r.size} ⚡</span>
        </div>
      ))}
    </div>
  );
}

// ── Positions tab — mark-to-market + cash out ──

function PositionsTab({
  positions, onChanged, flash,
}: {
  positions: PMPosition[];
  onChanged: () => Promise<void> | void;
  flash: (m: string) => void;
}) {
  const [busy, setBusy] = useState<string | null>(null);

  const cashOut = async (positionId: string) => {
    setBusy(positionId);
    const d = await run('position-cashout', { positionId });
    setBusy(null);
    if (d.ok) {
      const r = d.result as { cashoutSparks: number; realizedPnl: number };
      flash(`✓ Cashed out for ${r.cashoutSparks} ⚡ (P&L ${r.realizedPnl >= 0 ? '+' : ''}${r.realizedPnl})`);
      await onChanged();
    } else flash(`Failed: ${d.error}`);
  };

  if (positions.length === 0) {
    return (
      <div className="rounded-lg border border-zinc-800 py-8 text-center text-xs italic text-zinc-500">
        No prediction-market positions yet. Open one from Browse.
      </div>
    );
  }

  return (
    <ul className="space-y-2">
      {positions.map((p) => (
        <li key={p.id} className="rounded-lg border border-zinc-800 bg-zinc-900/60 p-3">
          <div className="flex items-start justify-between gap-2">
            <span className="text-xs text-zinc-100">{p.question || `Market ${p.marketId}`}</span>
            <span className={`shrink-0 text-xs font-semibold ${p.side === 'yes' ? 'text-emerald-400' : 'text-rose-400'}`}>
              {p.side.toUpperCase()} · {p.stakeSparks} ⚡
            </span>
          </div>
          <p className="mt-1 font-mono text-[10px] text-zinc-500">
            entry {Math.round(p.entryPrice * 100)}% · status {p.status}
            {p.status === 'open' && p.currentValue != null && (
              <>
                {' · mkt value '}
                <span className="text-zinc-300">{p.currentValue} ⚡</span>
                {' · uPnL '}
                <span className={(p.unrealizedPnl ?? 0) >= 0 ? 'text-emerald-400' : 'text-rose-400'}>
                  {(p.unrealizedPnl ?? 0) >= 0 ? '+' : ''}{p.unrealizedPnl}
                </span>
              </>
            )}
            {p.status !== 'open' && p.realizedPnl != null && (
              <>
                {' · realized '}
                <span className={p.realizedPnl >= 0 ? 'text-emerald-400' : 'text-rose-400'}>
                  {p.realizedPnl >= 0 ? '+' : ''}{p.realizedPnl} ⚡
                </span>
                {p.payoutSparks != null && p.payoutSparks > 0 && (
                  <span className="text-amber-400"> · paid {p.payoutSparks} ⚡</span>
                )}
              </>
            )}
          </p>
          {p.status === 'open' && p.marketStatus === 'open' && (
            <button
              type="button" onClick={() => cashOut(p.id)} disabled={busy === p.id}
              className="mt-2 inline-flex items-center gap-1 rounded border border-amber-500/40 bg-amber-500/15 px-2 py-1 text-[11px] text-amber-100 disabled:opacity-50"
            >
              {busy === p.id ? <Loader2 className="h-3 w-3 animate-spin" /> : <LogOut className="h-3 w-3" />}
              Cash out
            </button>
          )}
        </li>
      ))}
    </ul>
  );
}

// ── Leaderboard tab ──

function LeaderboardTab({ rows }: { rows: PMLeaderRow[] }) {
  if (rows.length === 0) {
    return (
      <div className="rounded-lg border border-zinc-800 py-8 text-center text-xs italic text-zinc-500">
        No forecasters ranked yet. P&amp;L appears after positions settle.
      </div>
    );
  }
  return (
    <div className="overflow-hidden rounded-lg border border-zinc-800">
      <table className="w-full text-xs">
        <thead className="bg-black/40 text-[10px] uppercase text-zinc-500">
          <tr>
            <th className="px-2 py-1.5 text-left">#</th>
            <th className="px-2 py-1.5 text-left">Forecaster</th>
            <th className="px-2 py-1.5 text-right">Realized P&amp;L</th>
            <th className="px-2 py-1.5 text-right">Win rate</th>
            <th className="px-2 py-1.5 text-right">ROI</th>
            <th className="px-2 py-1.5 text-right">W/L</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <tr key={r.userId} className="border-t border-white/5">
              <td className="px-2 py-1.5 font-mono text-zinc-500">{r.rank}</td>
              <td className="px-2 py-1.5 font-mono text-zinc-200">{r.userId}</td>
              <td className={`px-2 py-1.5 text-right font-mono ${r.realizedPnl >= 0 ? 'text-emerald-400' : 'text-rose-400'}`}>
                {r.realizedPnl >= 0 ? '+' : ''}{r.realizedPnl} ⚡
              </td>
              <td className="px-2 py-1.5 text-right font-mono text-zinc-400">
                {r.winRate != null ? `${Math.round(r.winRate * 100)}%` : '—'}
              </td>
              <td className="px-2 py-1.5 text-right font-mono text-zinc-400">
                {r.roi != null ? `${r.roi >= 0 ? '+' : ''}${Math.round(r.roi * 100)}%` : '—'}
              </td>
              <td className="px-2 py-1.5 text-right font-mono text-zinc-500">{r.wins}/{r.losses}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
