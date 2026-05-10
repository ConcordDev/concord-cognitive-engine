'use client';

// Creator lens — production-grade creator dashboard.
//
// Surfaces every existing creator surface in the codebase plus the
// social profile + follower flows that previously lived only in the
// social lens.
//
// Tabs: Overview | Listings | Profile | Followers | Cascade
//
// Reads:
//   /api/creator/dashboard, /api/creator/leaderboard,
//   /api/creator/trending-citations, /api/creator/influence-drift,
//   /api/creator/listings, /api/creator/withdrawal-status,
//   /api/creator/cascade/:dtuId,
//   /api/social/profile, /api/social/followers/:id, /api/social/following/:id,
//   /api/lens/creator (useArtifacts).
// Writes:
//   /api/economy/withdraw,
//   /api/marketplace/listings/:id (PATCH / withdraw / relist),
//   /api/social/profile (upsert), /api/lens/creator (POST broadcast).

import { useEffect, useState, useCallback, useMemo } from 'react';
import { LensShell } from '@/components/lens/LensShell';
import { ManifestActionBar } from '@/components/lens/ManifestActionBar';
import { useLensCommand } from '@/hooks/useLensCommand';
import {
  useArtifacts,
  useCreateArtifact,
} from '@/lib/hooks/use-lens-artifacts';
import {
  Coins, TrendingUp, TrendingDown, Users, Trophy, RefreshCw,
  ListChecks, Settings, MessageSquare, Activity, GitBranch,
  UserPlus, X, Save, Loader2, Sparkles,
} from 'lucide-react';

// ── Types ───────────────────────────────────────────────────────────

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
  tierPrices?: { usage?: number; remix?: number; commercial?: number };
  totalEarnings?: number;
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

interface SocialProfile {
  userId: string;
  displayName: string;
  bio: string;
  avatar: string;
  isPublic: boolean;
  specialization: string[];
  website: string;
  stats: {
    dtuCount: number;
    publicDtuCount: number;
    citationCount: number;
    followerCount: number;
    followingCount: number;
  };
}

interface FollowerRow { userId: string; displayName?: string }

const PANEL = 'rounded-lg border border-white/10 bg-black/60 p-4';
const GRID  = 'grid grid-cols-1 md:grid-cols-2 gap-4';

type Tab = 'overview' | 'listings' | 'profile' | 'followers' | 'cascade';

// ── Page ────────────────────────────────────────────────────────────

export default function CreatorDashboardPage() {
  const [tab, setTab] = useState<Tab>('overview');

  useLensCommand(
    [
      { id: 'tab-overview',  keys: 'o', description: 'Overview',  category: 'navigation', action: () => setTab('overview') },
      { id: 'tab-listings',  keys: 'l', description: 'Listings',  category: 'navigation', action: () => setTab('listings') },
      { id: 'tab-profile',   keys: 'p', description: 'Profile',   category: 'navigation', action: () => setTab('profile') },
      { id: 'tab-followers', keys: 'f', description: 'Followers', category: 'navigation', action: () => setTab('followers') },
      { id: 'tab-cascade',   keys: 'c', description: 'Cascade',   category: 'navigation', action: () => setTab('cascade') },
    ],
    { lensId: 'creator' }
  );

  // ── Shared dashboard ──────────────────────────────────────────────
  const [me, setMe] = useState<DashboardResponse | null>(null);
  const [leaderboard, setLeaderboard] = useState<Leader[]>([]);
  const [trending, setTrending] = useState<TrendingHit[]>([]);
  const [drift, setDrift] = useState<DriftHit[]>([]);
  const [myListings, setMyListings] = useState<MyListing[]>([]);
  const [withdrawal, setWithdrawal] = useState<WithdrawalStatus | null>(null);
  const [profile, setProfile] = useState<SocialProfile | null>(null);

  const refreshDashboard = useCallback(async () => {
    const [m, l, t, d, p] = await Promise.all([
      fetch('/api/creator/dashboard',          { credentials: 'include' }).then((r) => r.json()).catch(() => null),
      fetch('/api/creator/leaderboard?limit=10', { credentials: 'include' }).then((r) => r.json()).catch(() => null),
      fetch('/api/creator/trending-citations',  { credentials: 'include' }).then((r) => r.json()).catch(() => null),
      fetch('/api/creator/influence-drift',     { credentials: 'include' }).then((r) => r.json()).catch(() => null),
      fetch('/api/social/profile',              { credentials: 'include' }).then((r) => r.json()).catch(() => null),
    ]);
    setMe(m as DashboardResponse | null);
    setLeaderboard((l?.creators ?? []) as Leader[]);
    setTrending((t?.trending ?? []) as TrendingHit[]);
    setDrift((d?.drift ?? []) as DriftHit[]);
    setProfile(p?.ok && p.profile ? (p.profile as SocialProfile) : null);
  }, []);

  const refreshListings = useCallback(() => {
    fetch('/api/creator/listings', { credentials: 'include' })
      .then((r) => r.json())
      .then((d) => setMyListings((d?.listings ?? []) as MyListing[]))
      .catch(() => {});
  }, []);

  const refreshWithdrawal = useCallback(() => {
    fetch('/api/creator/withdrawal-status', { credentials: 'include' })
      .then((r) => r.json())
      .then((d) => setWithdrawal(d as WithdrawalStatus))
      .catch(() => {});
  }, []);

  useEffect(() => {
    refreshDashboard();
    refreshListings();
    refreshWithdrawal();
  }, [refreshDashboard, refreshListings, refreshWithdrawal]);

  return (
    <LensShell lensId="creator" asMain={false}>
      <ManifestActionBar />
      <div className="min-h-screen bg-[#0b0f17] text-gray-100 p-6">
        <header className="mb-5 flex items-start justify-between gap-3 flex-wrap">
          <div>
            <h1 className="text-3xl font-semibold text-amber-300">Creator</h1>
            <p className="text-gray-400 mt-1">
              Earnings, lineage, profile, followers — one workspace.
            </p>
          </div>
          <button
            onClick={() => { refreshDashboard(); refreshListings(); refreshWithdrawal(); }}
            className="text-white/40 hover:text-white text-xs inline-flex items-center gap-1"
          >
            <RefreshCw className="w-3 h-3" /> Refresh
          </button>
        </header>

        {/* Tabs */}
        <nav className="flex gap-2 mb-5 border-b border-white/10 pb-3 overflow-x-auto">
          <TabButton current={tab} value="overview"  label="Overview"  onClick={() => setTab('overview')}  icon={<Activity className="w-3.5 h-3.5" />} />
          <TabButton current={tab} value="listings"  label="Listings"  onClick={() => setTab('listings')}  icon={<ListChecks className="w-3.5 h-3.5" />} />
          <TabButton current={tab} value="profile"   label="Profile"   onClick={() => setTab('profile')}   icon={<Settings className="w-3.5 h-3.5" />} />
          <TabButton current={tab} value="followers" label="Followers" onClick={() => setTab('followers')} icon={<Users className="w-3.5 h-3.5" />} />
          <TabButton current={tab} value="cascade"   label="Cascade"   onClick={() => setTab('cascade')}   icon={<GitBranch className="w-3.5 h-3.5" />} />
        </nav>

        {tab === 'overview' && (
          <OverviewTab
            me={me}
            leaderboard={leaderboard}
            trending={trending}
            drift={drift}
            withdrawal={withdrawal}
            profile={profile}
            onWithdrawalDone={refreshWithdrawal}
          />
        )}
        {tab === 'listings'  && <ListingsTab listings={myListings} onChanged={() => { refreshListings(); refreshDashboard(); refreshWithdrawal(); }} />}
        {tab === 'profile'   && <ProfileTab profile={profile} onSaved={refreshDashboard} />}
        {tab === 'followers' && <FollowersTab profile={profile} />}
        {tab === 'cascade'   && <CascadePanel topCited={me?.topCitedDTUs ?? []} />}
      </div>
    </LensShell>
  );
}

// ── Overview tab (existing dashboard, repacked) ─────────────────────

function OverviewTab({
  me, leaderboard, trending, drift, withdrawal, profile, onWithdrawalDone,
}: {
  me: DashboardResponse | null;
  leaderboard: Leader[];
  trending: TrendingHit[];
  drift: DriftHit[];
  withdrawal: WithdrawalStatus | null;
  profile: SocialProfile | null;
  onWithdrawalDone: () => void;
}) {
  return (
    <>
      {/* Profile chip — quick visual identity at the top of overview */}
      {profile && (
        <section className={`${PANEL} mb-6 flex items-center gap-3`}>
          <div className="w-10 h-10 rounded-full bg-amber-500/20 border border-amber-500/40 flex items-center justify-center text-amber-300 font-bold">
            {(profile.displayName || profile.userId).slice(0, 1).toUpperCase()}
          </div>
          <div className="min-w-0 flex-1">
            <div className="text-white font-semibold truncate">{profile.displayName || profile.userId}</div>
            <div className="text-xs text-gray-500 truncate">{profile.bio || 'No bio yet — set one in Profile.'}</div>
          </div>
          <div className="flex items-center gap-3 text-xs text-gray-400">
            <span><span className="text-amber-300 font-mono">{profile.stats.followerCount}</span> followers</span>
            <span><span className="text-amber-300 font-mono">{profile.stats.followingCount}</span> following</span>
          </div>
        </section>
      )}

      {me?.ok && me.summary ? (
        <section className={`${PANEL} mb-6`}>
          <h2 className="text-amber-200 font-semibold mb-3 inline-flex items-center gap-1.5">
            <Trophy className="w-4 h-4" /> Your stats
          </h2>
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
          {me?.error ? 'Sign in to see your dashboard.' : 'Loading your stats...'}
        </div>
      )}

      {/* Withdrawal */}
      {withdrawal?.ok && (
        <WithdrawalSection withdrawal={withdrawal} onDone={onWithdrawalDone} />
      )}

      <div className={GRID}>
        <section className={PANEL}>
          <h2 className="text-violet-300 font-semibold mb-3 inline-flex items-center gap-1.5">
            <Trophy className="w-4 h-4" /> Top creators
          </h2>
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

        <section className={PANEL}>
          <h2 className="text-emerald-300 font-semibold mb-3 inline-flex items-center gap-1.5">
            <TrendingUp className="w-4 h-4" /> Trending citations (24h)
          </h2>
          {trending.length === 0 ? (
            <div className="text-gray-500 italic">No surge.</div>
          ) : (
            <ul className="space-y-2 text-sm">
              {trending.slice(0, 8).map((t) => (
                <li key={t.id} className="border-l-2 border-emerald-400/40 pl-3">
                  <div className="text-gray-100 font-medium truncate">{t.title}</div>
                  <div className="text-xs text-gray-500">{t.domain} · +{t.newCitations24h} new citations</div>
                </li>
              ))}
            </ul>
          )}
        </section>

        <section className={`${PANEL} md:col-span-2`}>
          <h2 className="text-rose-300 font-semibold mb-3 inline-flex items-center gap-1.5">
            <TrendingDown className="w-4 h-4" /> Influence drift (7d)
          </h2>
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
                    <td className={`py-1 text-right font-mono ${
                      d.change > 0 ? 'text-emerald-400' : d.change < 0 ? 'text-rose-400' : 'text-gray-400'
                    }`}>
                      {d.change > 0 ? '+' : ''}{d.change}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </section>
      </div>
    </>
  );
}

function WithdrawalSection({
  withdrawal, onDone,
}: { withdrawal: WithdrawalStatus; onDone: () => void }) {
  const [withdrawAmount, setWithdrawAmount] = useState('');
  const [withdrawError, setWithdrawError] = useState<string | null>(null);
  const [withdrawing, setWithdrawing] = useState(false);

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
        onDone();
      }
    } catch (e) {
      setWithdrawError(e instanceof Error ? e.message : 'Request failed.');
    } finally {
      setWithdrawing(false);
    }
  }, [withdrawAmount, onDone]);

  return (
    <section className={`${PANEL} mb-6`}>
      <div className="flex flex-wrap items-baseline justify-between gap-2 mb-3">
        <h2 className="text-emerald-300 font-semibold inline-flex items-center gap-1.5">
          <Coins className="w-4 h-4" /> Earnings &amp; withdrawal
        </h2>
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
        <p role="alert" className="mt-2 text-xs text-rose-300">{withdrawError}</p>
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
  );
}

// ── Listings tab ────────────────────────────────────────────────────

function ListingsTab({
  listings, onChanged,
}: { listings: MyListing[]; onChanged: () => void }) {
  const [sort, setSort] = useState<'newest' | 'price-desc' | 'downloads' | 'earnings'>('newest');
  const [filter, setFilter] = useState<'all' | 'active' | 'withdrawn'>('all');
  const [search, setSearch] = useState('');

  // CSV export of every listing — creators need this for tax / accounting
  // workflows.  Same shape as the wallet CSV: receipt-friendly headers
  // and properly-escaped fields so titles with commas don't break it.
  const exportListingsCSV = useCallback(() => {
    const headers = ['id', 'title', 'status', 'price', 'downloads', 'totalEarnings', 'listedAt'];
    const escape = (v: unknown) => {
      if (v === null || v === undefined) return '';
      const s = String(v);
      return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
    };
    const rows = listings.map((l) => [
      l.id, l.title || '', l.status, l.price,
      l.downloads ?? 0,
      l.totalEarnings ?? (l.downloads * l.price),
      l.listedAt,
    ].map(escape).join(','));
    const csv = [headers.join(','), ...rows].join('\n');
    const blob = new Blob([csv], { type: 'text/csv' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `creator-listings-${new Date().toISOString().slice(0, 10)}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  }, [listings]);

  const updateListing = useCallback(async (id: string, patch: Partial<MyListing>) => {
    await fetch(`/api/marketplace/listings/${encodeURIComponent(id)}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      credentials: 'include',
      body: JSON.stringify(patch),
    });
    onChanged();
  }, [onChanged]);

  const withdrawListing = useCallback(async (id: string) => {
    await fetch(`/api/marketplace/listings/${encodeURIComponent(id)}/withdraw`, {
      method: 'POST', credentials: 'include',
    });
    onChanged();
  }, [onChanged]);

  const relistListing = useCallback(async (id: string) => {
    await fetch(`/api/marketplace/listings/${encodeURIComponent(id)}/relist`, {
      method: 'POST', credentials: 'include',
    });
    onChanged();
  }, [onChanged]);

  const visible = useMemo(() => {
    let arr = listings.slice();
    if (filter !== 'all') arr = arr.filter((l) => l.status === filter);
    const q = search.trim().toLowerCase();
    if (q) arr = arr.filter((l) => (l.title || '').toLowerCase().includes(q) || l.id.toLowerCase().includes(q));
    if (sort === 'price-desc') arr.sort((a, b) => b.price - a.price);
    if (sort === 'downloads')  arr.sort((a, b) => (b.downloads ?? 0) - (a.downloads ?? 0));
    if (sort === 'earnings')   arr.sort((a, b) => (b.totalEarnings ?? b.downloads * b.price) - (a.totalEarnings ?? a.downloads * a.price));
    if (sort === 'newest')     arr.sort((a, b) => new Date(b.listedAt).getTime() - new Date(a.listedAt).getTime());
    return arr;
  }, [listings, sort, filter, search]);

  // Top-3 earners summary strip.
  const topEarners = useMemo(() => {
    return [...listings]
      .map((l) => ({ ...l, computedEarnings: l.totalEarnings ?? (l.downloads * l.price) }))
      .sort((a, b) => b.computedEarnings - a.computedEarnings)
      .slice(0, 3);
  }, [listings]);

  return (
    <section className={PANEL}>
      <div className="flex flex-wrap items-center justify-between gap-2 mb-3">
        <h2 className="text-amber-200 font-semibold inline-flex items-center gap-1.5">
          <ListChecks className="w-4 h-4" /> Your listings
          {search && (
            <span className="text-xs text-gray-500 font-normal ml-1">
              ({visible.length} of {listings.length})
            </span>
          )}
        </h2>
        <div className="flex items-center gap-2 text-xs flex-wrap">
          <input
            type="text"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Filter by title or id…"
            className="bg-black/60 border border-white/10 rounded px-2 py-1 text-gray-200 w-44 focus:outline-none focus:border-amber-400/40"
          />
          <select
            value={filter}
            onChange={(e) => setFilter(e.target.value as typeof filter)}
            className="bg-black/60 border border-white/10 rounded px-2 py-1 text-gray-200"
          >
            <option value="all">All</option>
            <option value="active">Active</option>
            <option value="withdrawn">Withdrawn</option>
          </select>
          <select
            value={sort}
            onChange={(e) => setSort(e.target.value as typeof sort)}
            className="bg-black/60 border border-white/10 rounded px-2 py-1 text-gray-200"
          >
            <option value="newest">Newest</option>
            <option value="price-desc">Price ↓</option>
            <option value="downloads">Downloads ↓</option>
            <option value="earnings">Earnings ↓</option>
          </select>
          <button
            onClick={exportListingsCSV}
            disabled={listings.length === 0}
            className="bg-black/60 border border-white/10 rounded px-2 py-1 text-gray-200 hover:bg-white/5 hover:border-white/20 disabled:opacity-40"
            title="Export every listing to CSV (for tax / accounting)"
          >
            CSV ↓
          </button>
        </div>
      </div>

      {topEarners.length > 0 && (
        <div className="mb-3 grid grid-cols-1 md:grid-cols-3 gap-2">
          {topEarners.map((l, i) => (
            <div key={l.id} className="bg-amber-500/5 border border-amber-500/20 rounded-md p-2">
              <div className="text-[10px] uppercase tracking-wide text-amber-300 mb-0.5">
                {['#1 earner', '#2 earner', '#3 earner'][i]}
              </div>
              <div className="text-sm text-white truncate">{l.title}</div>
              <div className="text-xs text-amber-200 font-mono">{l.computedEarnings.toFixed(0)} CC</div>
            </div>
          ))}
        </div>
      )}

      {visible.length === 0 ? (
        <div className="text-gray-500 italic">No listings match.</div>
      ) : (
        <div className="space-y-2">
          {visible.map((l) => (
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
  const [useTiers, setUseTiers] = useState(!!listing.tierPrices);
  const [tierUsage, setTierUsage] = useState(String(listing.tierPrices?.usage ?? 5));
  const [tierRemix, setTierRemix] = useState(String(listing.tierPrices?.remix ?? 15));
  const [tierCommercial, setTierCommercial] = useState(String(listing.tierPrices?.commercial ?? 60));
  const isWithdrawn = listing.status === 'withdrawn';

  async function save() {
    const patch: Partial<MyListing> = { title, price: Number(price) || 0 };
    if (useTiers) {
      patch.tierPrices = {
        usage:      Number(tierUsage)      || 0,
        remix:      Number(tierRemix)      || 0,
        commercial: Number(tierCommercial) || 0,
      };
    }
    await onUpdate(listing.id, patch);
    setEditing(false);
  }

  return (
    <div className="border border-white/10 rounded p-3">
      {!editing ? (
        <div className="flex flex-wrap items-center gap-3">
          <div className="flex-1 min-w-[200px]">
            <div className="text-gray-100 font-medium truncate">{listing.title}</div>
            <div className="text-xs text-gray-500">
              {listing.price} CC · {listing.downloads} downloads · {listing.status}
              {listing.totalEarnings != null && (
                <span className="text-amber-300/80"> · {listing.totalEarnings.toFixed(0)} CC earned</span>
              )}
            </div>
            {listing.tierPrices && (
              <div className="flex flex-wrap gap-1 mt-1 text-[10px]">
                {Object.entries(listing.tierPrices).map(([t, p]) => (
                  <span key={t} className="bg-white/5 border border-white/10 rounded px-1.5 py-0.5 text-white/70">
                    {t}: {p}
                  </span>
                ))}
              </div>
            )}
          </div>
          <button onClick={() => setEditing(true)} className="px-2 py-1 text-xs bg-violet-700 hover:bg-violet-600 rounded text-white">edit</button>
          {!isWithdrawn ? (
            <button onClick={() => onWithdraw(listing.id)} className="px-2 py-1 text-xs bg-rose-700 hover:bg-rose-600 rounded text-white">withdraw</button>
          ) : (
            <button onClick={() => onRelist(listing.id)} className="px-2 py-1 text-xs bg-emerald-700 hover:bg-emerald-600 rounded text-white">re-list</button>
          )}
        </div>
      ) : (
        <div className="space-y-2">
          <div className="flex items-center gap-2">
            <input value={title} onChange={(e) => setTitle(e.target.value)} className="flex-1 min-w-[180px] bg-black/60 border border-white/10 rounded px-2 py-1 text-sm text-gray-200" />
            <input
              value={price}
              onChange={(e) => setPrice(e.target.value)}
              inputMode="decimal"
              className="w-24 bg-black/60 border border-white/10 rounded px-2 py-1 text-sm text-gray-200"
              placeholder="price"
            />
          </div>
          <label className="flex items-center gap-2 text-xs text-gray-400">
            <input type="checkbox" checked={useTiers} onChange={(e) => setUseTiers(e.target.checked)} />
            Tier pricing (usage / remix / commercial)
          </label>
          {useTiers && (
            <div className="grid grid-cols-3 gap-2">
              <input value={tierUsage}      onChange={(e) => setTierUsage(e.target.value)}      placeholder="usage"      className="bg-black/60 border border-white/10 rounded px-2 py-1 text-xs text-gray-200" />
              <input value={tierRemix}      onChange={(e) => setTierRemix(e.target.value)}      placeholder="remix"      className="bg-black/60 border border-white/10 rounded px-2 py-1 text-xs text-gray-200" />
              <input value={tierCommercial} onChange={(e) => setTierCommercial(e.target.value)} placeholder="commercial" className="bg-black/60 border border-white/10 rounded px-2 py-1 text-xs text-gray-200" />
            </div>
          )}
          <div className="flex items-center gap-2 justify-end">
            <button onClick={() => { setEditing(false); setPrice(String(listing.price)); setTitle(listing.title); }} className="px-2 py-1 text-xs bg-stone-700 rounded text-gray-200">cancel</button>
            <button onClick={save} className="px-2 py-1 text-xs bg-amber-600 hover:bg-amber-500 rounded text-white inline-flex items-center gap-1">
              <Save className="w-3 h-3" /> save
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

// ── Profile tab ─────────────────────────────────────────────────────

function ProfileTab({
  profile, onSaved,
}: { profile: SocialProfile | null; onSaved: () => void }) {
  const [displayName, setDisplayName]   = useState(profile?.displayName ?? '');
  const [bio,         setBio]           = useState(profile?.bio ?? '');
  const [avatar,      setAvatar]        = useState(profile?.avatar ?? '');
  const [website,     setWebsite]       = useState(profile?.website ?? '');
  const [specs,       setSpecs]         = useState((profile?.specialization ?? []).join(', '));
  const [isPublic,    setIsPublic]      = useState(profile?.isPublic ?? true);
  const [saving,      setSaving]        = useState(false);
  const [savedAt,     setSavedAt]       = useState<string | null>(null);
  const [err,         setErr]           = useState<string | null>(null);

  // Resync when profile updates from outside this component.
  useEffect(() => {
    if (profile) {
      setDisplayName(profile.displayName);
      setBio(profile.bio);
      setAvatar(profile.avatar);
      setWebsite(profile.website);
      setSpecs(profile.specialization.join(', '));
      setIsPublic(profile.isPublic);
    }
  }, [profile?.userId]); // eslint-disable-line react-hooks/exhaustive-deps

  // Persist a "broadcast" lens artifact each time the creator publishes
  // an update — gives the lens persistence credit and feeds cross-lens
  // discovery (followers' feeds can pick it up).
  const broadcasts = useArtifacts<{ kind: string; message: string; at: string }>('creator', {
    type: 'broadcast', limit: 5,
  });
  const createBroadcast = useCreateArtifact<{ kind: string; message: string; at: string }>('creator');

  async function save() {
    setSaving(true); setErr(null); setSavedAt(null);
    try {
      const r = await fetch('/api/social/profile', {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          displayName, bio, avatar, website, isPublic,
          specialization: specs.split(',').map((s) => s.trim()).filter(Boolean),
        }),
      });
      const body = await r.json().catch(() => null);
      if (!r.ok || body?.ok === false) {
        setErr(body?.error ?? `Save failed (${r.status})`);
        return;
      }
      // Best-effort broadcast announcement.
      createBroadcast.mutate({
        type: 'broadcast',
        title: `Profile update: ${displayName || 'creator'}`,
        data: { kind: 'profile_update', message: bio.slice(0, 120), at: new Date().toISOString() },
        meta: { tags: ['creator', 'profile'], status: 'completed', visibility: 'public' },
      });
      setSavedAt(new Date().toLocaleTimeString());
      onSaved();
    } catch (e) {
      setErr(e instanceof Error ? e.message : 'Save failed');
    } finally {
      setSaving(false);
    }
  }

  return (
    <section className={PANEL}>
      <h2 className="text-amber-200 font-semibold mb-4 inline-flex items-center gap-1.5">
        <Settings className="w-4 h-4" /> Public profile
      </h2>

      {!profile && (
        <div className="text-xs text-gray-500 italic mb-3">
          You don&apos;t have a profile yet. Save below to create one — it&apos;s how
          followers see you across lenses.
        </div>
      )}

      <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
        <Field label="Display name">
          <input value={displayName} onChange={(e) => setDisplayName(e.target.value)}
            placeholder="What followers should see"
            className="w-full bg-black/60 border border-white/10 rounded px-3 py-2 text-sm" />
        </Field>
        <Field label="Avatar URL">
          <input value={avatar} onChange={(e) => setAvatar(e.target.value)}
            placeholder="https://…"
            className="w-full bg-black/60 border border-white/10 rounded px-3 py-2 text-sm" />
        </Field>
        <Field label="Website">
          <input value={website} onChange={(e) => setWebsite(e.target.value)}
            placeholder="https://…"
            className="w-full bg-black/60 border border-white/10 rounded px-3 py-2 text-sm" />
        </Field>
        <Field label="Specialization (comma-separated)">
          <input value={specs} onChange={(e) => setSpecs(e.target.value)}
            placeholder="ml, music, governance"
            className="w-full bg-black/60 border border-white/10 rounded px-3 py-2 text-sm" />
        </Field>
        <Field label="Bio" className="md:col-span-2">
          <textarea value={bio} onChange={(e) => setBio(e.target.value)}
            rows={3} placeholder="One paragraph followers will see."
            className="w-full bg-black/60 border border-white/10 rounded px-3 py-2 text-sm" />
        </Field>
      </div>

      <label className="mt-3 flex items-center gap-2 text-xs text-gray-400">
        <input type="checkbox" checked={isPublic} onChange={(e) => setIsPublic(e.target.checked)} />
        Public — discoverable in /api/social/profiles
      </label>

      <div className="mt-4 flex items-center gap-3">
        <button onClick={save} disabled={saving}
          className="px-4 py-2 text-sm font-medium bg-amber-600 hover:bg-amber-500 disabled:bg-stone-800 disabled:text-gray-500 rounded text-white inline-flex items-center gap-1">
          {saving ? <Loader2 className="w-4 h-4 animate-spin" /> : <Save className="w-4 h-4" />}
          Save profile
        </button>
        {savedAt && <span className="text-xs text-emerald-300 inline-flex items-center gap-1"><Sparkles className="w-3 h-3" /> Saved {savedAt}</span>}
        {err && <span className="text-xs text-rose-300">{err}</span>}
      </div>

      {broadcasts.data?.artifacts && broadcasts.data.artifacts.length > 0 && (
        <div className="mt-5 border-t border-white/10 pt-3">
          <div className="text-[10px] uppercase tracking-wide text-gray-500 mb-1.5 inline-flex items-center gap-1">
            <MessageSquare className="w-3 h-3" /> Recent broadcasts
          </div>
          <ul className="space-y-1 text-xs">
            {broadcasts.data.artifacts.slice(0, 5).map((a) => (
              <li key={a.id} className="text-gray-400">
                <span className="text-gray-200">{a.title}</span>
                <span className="text-gray-600 ml-2">
                  {new Date((a.data as { at?: string })?.at ?? a.createdAt).toLocaleString()}
                </span>
              </li>
            ))}
          </ul>
        </div>
      )}
    </section>
  );
}

function Field({ label, className, children }: { label: string; className?: string; children: React.ReactNode }) {
  return (
    <div className={className}>
      <div className="text-[10px] text-gray-500 uppercase tracking-wider mb-1">{label}</div>
      {children}
    </div>
  );
}

// ── Followers tab ───────────────────────────────────────────────────

function FollowersTab({ profile }: { profile: SocialProfile | null }) {
  const [followers, setFollowers] = useState<FollowerRow[]>([]);
  const [following, setFollowing] = useState<FollowerRow[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError]     = useState<string | null>(null);

  const refresh = useCallback(async () => {
    if (!profile?.userId) return;
    setLoading(true); setError(null);
    try {
      const [fRes, gRes] = await Promise.all([
        fetch(`/api/social/followers/${encodeURIComponent(profile.userId)}`, { credentials: 'include' }).then((r) => r.json()),
        fetch(`/api/social/following/${encodeURIComponent(profile.userId)}`, { credentials: 'include' }).then((r) => r.json()),
      ]);
      const fArr = Array.isArray(fRes?.followers) ? fRes.followers : [];
      const gArr = Array.isArray(gRes?.following) ? gRes.following : [];
      setFollowers(
        fArr.map((id: string | { userId?: string; displayName?: string }) =>
          typeof id === 'string' ? { userId: id } : { userId: id.userId ?? '', displayName: id.displayName }
        )
      );
      setFollowing(
        gArr.map((id: string | { userId?: string; displayName?: string }) =>
          typeof id === 'string' ? { userId: id } : { userId: id.userId ?? '', displayName: id.displayName }
        )
      );
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to load');
    } finally {
      setLoading(false);
    }
  }, [profile?.userId]);

  useEffect(() => { refresh(); }, [refresh]);

  async function unfollow(targetId: string) {
    await fetch('/api/social/unfollow', {
      method: 'POST',
      credentials: 'include',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ followedId: targetId }),
    });
    refresh();
  }

  if (!profile) {
    return (
      <section className={`${PANEL} text-gray-500 italic`}>
        Set up a profile first to see your followers.
      </section>
    );
  }

  return (
    <div className={GRID}>
      <section className={PANEL}>
        <h2 className="text-emerald-300 font-semibold mb-3 inline-flex items-center gap-1.5">
          <UserPlus className="w-4 h-4" /> Followers <span className="text-gray-500 text-xs">({followers.length})</span>
        </h2>
        {loading ? (
          <div className="text-gray-500 italic text-sm">Loading…</div>
        ) : error ? (
          <p className="text-xs text-rose-300">{error}</p>
        ) : followers.length === 0 ? (
          <div className="text-gray-500 italic text-sm">No followers yet.</div>
        ) : (
          <ul className="space-y-1 text-sm">
            {followers.map((f) => (
              <li key={f.userId} className="flex items-center gap-2 px-2 py-1 rounded hover:bg-white/5">
                <div className="w-6 h-6 rounded-full bg-emerald-500/20 border border-emerald-500/40 flex items-center justify-center text-emerald-300 text-xs">
                  {(f.displayName || f.userId).slice(0, 1).toUpperCase()}
                </div>
                <span className="flex-1 truncate text-gray-200">{f.displayName || f.userId}</span>
              </li>
            ))}
          </ul>
        )}
      </section>

      <section className={PANEL}>
        <h2 className="text-violet-300 font-semibold mb-3 inline-flex items-center gap-1.5">
          <Users className="w-4 h-4" /> Following <span className="text-gray-500 text-xs">({following.length})</span>
        </h2>
        {loading ? (
          <div className="text-gray-500 italic text-sm">Loading…</div>
        ) : following.length === 0 ? (
          <div className="text-gray-500 italic text-sm">Not following anyone yet.</div>
        ) : (
          <ul className="space-y-1 text-sm">
            {following.map((f) => (
              <li key={f.userId} className="flex items-center gap-2 px-2 py-1 rounded hover:bg-white/5">
                <div className="w-6 h-6 rounded-full bg-violet-500/20 border border-violet-500/40 flex items-center justify-center text-violet-300 text-xs">
                  {(f.displayName || f.userId).slice(0, 1).toUpperCase()}
                </div>
                <span className="flex-1 truncate text-gray-200">{f.displayName || f.userId}</span>
                <button
                  onClick={() => unfollow(f.userId)}
                  className="text-[11px] text-rose-300 hover:text-rose-200 inline-flex items-center gap-0.5"
                  title="Unfollow"
                >
                  <X className="w-3 h-3" /> unfollow
                </button>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}

// ── Cascade panel ───────────────────────────────────────────────────

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

  // Pick first item once topCited materializes.
  useEffect(() => {
    if (!selected && topCited.length > 0) setSelected(topCited[0].id);
  }, [topCited, selected]);

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

  const maxCount = tree
    ? Math.max(1, ...tree.generations.map((g) => g.count))
    : 1;

  if (topCited.length === 0) {
    return (
      <section className={`${PANEL} text-gray-500 italic`}>
        No top-cited DTUs yet. As your work earns citations, they appear here with the per-generation cascade.
      </section>
    );
  }

  return (
    <section className={PANEL}>
      <div className="flex flex-wrap items-baseline justify-between gap-2 mb-3">
        <h2 className="text-amber-200 font-semibold inline-flex items-center gap-1.5">
          <GitBranch className="w-4 h-4" /> Royalty cascade
        </h2>
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

// ── Helpers ─────────────────────────────────────────────────────────

function Stat({ label, value }: { label: string; value: number | string }) {
  return (
    <div>
      <div className="text-[10px] text-gray-500 uppercase tracking-wider">{label}</div>
      <div className="text-2xl text-amber-300 font-mono mt-1">{value}</div>
    </div>
  );
}

function TabButton({
  current, value, label, onClick, icon,
}: { current: Tab; value: Tab; label: string; onClick: () => void; icon: React.ReactNode }) {
  const active = current === value;
  return (
    <button
      onClick={onClick}
      className={`flex items-center gap-1.5 px-3 py-1.5 rounded-md text-xs font-semibold whitespace-nowrap transition-all ${
        active
          ? 'bg-amber-500/20 border border-amber-500/40 text-amber-300'
          : 'bg-white/5 border border-transparent hover:bg-white/10 text-white/70'
      }`}
    >
      {icon}{label}
    </button>
  );
}
