'use client';

/**
 * PortfolioWorkbench — the FIFO-cost-basis portfolio surface for the crypto
 * lens. Wires up the 2026 parity backlog front-to-back against the real
 * `crypto` domain macros:
 *
 *  - On-chain balance sync (read-only public RPC)        → onchain-sync
 *  - Real-time price stream + live P&L ticker            → price-stream
 *  - Staking / yield position tracking                   → staking-*
 *  - Allocation breakdown + rebalancing suggestions      → allocation-breakdown
 *  - Transaction CSV import (cost-basis accuracy)         → import-csv
 *  - Cross-chain filtering on holdings                   → holdings-list (chain)
 *  - Push price-alert delivery                           → alert-deliver
 *
 * No mock data — every value is real user input or computed from live
 * CoinGecko prices / public RPC reads.
 */

import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  Loader2, Plus, RefreshCw, Radio, Link2, PiggyBank, Upload,
  Scale, BellRing, TrendingUp, TrendingDown,
} from 'lucide-react';
import { lensRun } from '@/lib/api/client';
import { ChartKit } from '@/components/viz/ChartKit';
import { cn } from '@/lib/utils';

// ── Types ───────────────────────────────────────────────────────────────────

interface Holding {
  symbol: string;
  ticker: string;
  chains: string[];
  qty: number;
  avgCostUsd: number;
  totalCostUsd: number;
  priceUsd: number | null;
  marketValueUsd: number | null;
  unrealizedPnlUsd: number | null;
  unrealizedPnlPct: number | null;
  lotCount: number;
}

interface PriceTick {
  symbol: string;
  ticker: string;
  priceUsd: number | null;
  qty: number;
  valueUsd: number | null;
  unrealizedPnlUsd: number | null;
}

interface StreamResult {
  ticks: PriceTick[];
  totalValueUsd: number;
  totalCostUsd: number;
  unrealizedPnlUsd: number;
  unrealizedPnlPct: number;
  at: string;
  priceSource?: string;
}

interface StakingPosition {
  id: string;
  number: string;
  symbol: string;
  ticker: string;
  chain: string;
  qty: number;
  validator: string;
  aprPct: number | null;
  stakedAt: string;
  unstakedAt: string | null;
  cumulativeRewardsUsd: number;
  active: boolean;
}

interface OnchainSync {
  address: string;
  chain: string;
  nativeTicker: string;
  balance: number;
  syncedAt: string;
}

interface RebalanceRow {
  symbol: string;
  ticker: string;
  action: 'buy' | 'sell';
  deltaUsd: number;
  deltaQty: number;
  currentPct: number;
  targetPct: number;
}

interface BreakdownRow {
  symbol: string;
  ticker: string;
  qty: number;
  priceUsd: number;
  valueUsd: number;
  currentPct: number;
  targetPct: number;
  driftPct: number;
}

interface AlertDelivery {
  id: string;
  symbol: string;
  direction: string;
  threshold: number;
  currentPrice: number;
  message: string;
  deliveredAt: string;
  read: boolean;
}

interface ImportResult {
  importedCount: number;
  buyCount: number;
  sellCount: number;
  errorCount: number;
  errors: Array<{ row: number; reason: string }>;
}

const EVM_CHAINS = ['ethereum', 'polygon', 'base', 'arbitrum', 'optimism', 'avalanche'];

const fmtUsd = (n: number | null | undefined) =>
  n == null ? '—' : `$${n.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

const ALLOC_HEX = ['#22c55e', '#06b6d4', '#a855f7', '#f59e0b', '#ec4899', '#ef4444', '#6366f1'];

// ── Component ───────────────────────────────────────────────────────────────

export function PortfolioWorkbench() {
  const [holdings, setHoldings] = useState<Holding[]>([]);
  const [holdingsLoading, setHoldingsLoading] = useState(false);
  const [chainFilter, setChainFilter] = useState<string>('all');

  // Live price stream
  const [stream, setStream] = useState<StreamResult | null>(null);
  const [streaming, setStreaming] = useState(false);

  // Add-holding form
  const [showAdd, setShowAdd] = useState(false);
  const [addSymbol, setAddSymbol] = useState('');
  const [addTicker, setAddTicker] = useState('');
  const [addQty, setAddQty] = useState('');
  const [addCost, setAddCost] = useState('');
  const [addChain, setAddChain] = useState('ethereum');
  const [busy, setBusy] = useState(false);

  // On-chain sync
  const [syncAddress, setSyncAddress] = useState('');
  const [syncChain, setSyncChain] = useState('ethereum');
  const [syncing, setSyncing] = useState(false);
  const [syncs, setSyncs] = useState<OnchainSync[]>([]);
  const [syncError, setSyncError] = useState<string | null>(null);

  // Staking
  const [positions, setPositions] = useState<StakingPosition[]>([]);
  const [stakeSymbol, setStakeSymbol] = useState('');
  const [stakeQty, setStakeQty] = useState('');
  const [stakeValidator, setStakeValidator] = useState('');
  const [stakeApr, setStakeApr] = useState('');

  // Allocation / rebalance
  const [breakdown, setBreakdown] = useState<BreakdownRow[]>([]);
  const [rebalance, setRebalance] = useState<RebalanceRow[]>([]);
  const [allocLoading, setAllocLoading] = useState(false);
  const [targetMode, setTargetMode] = useState<string>('equal-weight');

  // CSV import
  const [csvText, setCsvText] = useState('');
  const [importResult, setImportResult] = useState<ImportResult | null>(null);
  const [importing, setImporting] = useState(false);

  // Alert delivery
  const [deliveries, setDeliveries] = useState<AlertDelivery[]>([]);
  const [deliveryUnread, setDeliveryUnread] = useState(0);
  const [delivering, setDelivering] = useState(false);

  // ── Loaders ────────────────────────────────────────────────────────────────

  const loadHoldings = useCallback(async () => {
    setHoldingsLoading(true);
    try {
      const r = await lensRun<{ holdings: Holding[] }>('crypto', 'holdings-list', {});
      if (r.data?.ok) setHoldings(r.data.result?.holdings || []);
    } finally {
      setHoldingsLoading(false);
    }
  }, []);

  const loadStaking = useCallback(async () => {
    const r = await lensRun<{ positions: StakingPosition[] }>('crypto', 'staking-positions-list', {});
    if (r.data?.ok) setPositions(r.data.result?.positions || []);
  }, []);

  const loadSyncs = useCallback(async () => {
    const r = await lensRun<{ syncs: OnchainSync[] }>('crypto', 'onchain-syncs-list', {});
    if (r.data?.ok) setSyncs(r.data.result?.syncs || []);
  }, []);

  const loadDeliveries = useCallback(async () => {
    const r = await lensRun<{ deliveries: AlertDelivery[]; unreadCount: number }>(
      'crypto', 'alert-deliveries-list', {},
    );
    if (r.data?.ok) {
      setDeliveries(r.data.result?.deliveries || []);
      setDeliveryUnread(r.data.result?.unreadCount || 0);
    }
  }, []);

  useEffect(() => {
    loadHoldings();
    loadStaking();
    loadSyncs();
    loadDeliveries();
  }, [loadHoldings, loadStaking, loadSyncs, loadDeliveries]);

  // Live price stream — polls price-stream every 30s while enabled.
  useEffect(() => {
    if (!streaming) return;
    let cancelled = false;
    const tick = async () => {
      const r = await lensRun<StreamResult>('crypto', 'price-stream', {});
      if (!cancelled && r.data?.ok && r.data.result) setStream(r.data.result);
    };
    tick();
    const iv = setInterval(tick, 30_000);
    return () => { cancelled = true; clearInterval(iv); };
  }, [streaming]);

  // ── Actions ────────────────────────────────────────────────────────────────

  const addHolding = useCallback(async () => {
    const qty = Number(addQty);
    const cost = Number(addCost);
    if (!addSymbol.trim() || !(qty > 0) || !(cost >= 0)) return;
    setBusy(true);
    try {
      const r = await lensRun('crypto', 'holdings-add', {
        symbol: addSymbol.trim().toLowerCase(),
        ticker: addTicker.trim() || addSymbol.trim(),
        qty, costBasisUsd: cost, chain: addChain,
      });
      if (r.data?.ok) {
        setShowAdd(false);
        setAddSymbol(''); setAddTicker(''); setAddQty(''); setAddCost('');
        await loadHoldings();
      }
    } finally {
      setBusy(false);
    }
  }, [addSymbol, addTicker, addQty, addCost, addChain, loadHoldings]);

  const runSync = useCallback(async () => {
    if (!/^0x[0-9a-fA-F]{40}$/.test(syncAddress.trim())) {
      setSyncError('Enter a valid 0x EVM address (42 chars).');
      return;
    }
    setSyncing(true);
    setSyncError(null);
    try {
      const r = await lensRun<{ balance: number; nativeTicker: string }>(
        'crypto', 'onchain-sync', { address: syncAddress.trim(), chain: syncChain },
      );
      if (r.data?.ok) {
        await Promise.all([loadHoldings(), loadSyncs()]);
      } else {
        setSyncError(r.data?.error || 'Sync failed.');
      }
    } finally {
      setSyncing(false);
    }
  }, [syncAddress, syncChain, loadHoldings, loadSyncs]);

  const openStake = useCallback(async () => {
    const qty = Number(stakeQty);
    if (!stakeSymbol.trim() || !(qty > 0)) return;
    setBusy(true);
    try {
      const apr = Number(stakeApr);
      const r = await lensRun('crypto', 'staking-stake', {
        symbol: stakeSymbol.trim().toLowerCase(),
        ticker: stakeSymbol.trim(),
        qty,
        validator: stakeValidator.trim(),
        aprPct: Number.isFinite(apr) && apr > 0 ? apr : undefined,
      });
      if (r.data?.ok) {
        setStakeSymbol(''); setStakeQty(''); setStakeValidator(''); setStakeApr('');
        await loadStaking();
      }
    } finally {
      setBusy(false);
    }
  }, [stakeSymbol, stakeQty, stakeValidator, stakeApr, loadStaking]);

  const unstake = useCallback(async (id: string) => {
    const r = await lensRun('crypto', 'staking-unstake', { id });
    if (r.data?.ok) await loadStaking();
  }, [loadStaking]);

  const computeAllocation = useCallback(async () => {
    setAllocLoading(true);
    try {
      const r = await lensRun<{
        breakdown: BreakdownRow[]; rebalance: RebalanceRow[]; targetMode: string;
      }>('crypto', 'allocation-breakdown', {});
      if (r.data?.ok) {
        setBreakdown(r.data.result?.breakdown || []);
        setRebalance(r.data.result?.rebalance || []);
        setTargetMode(r.data.result?.targetMode || 'equal-weight');
      }
    } finally {
      setAllocLoading(false);
    }
  }, []);

  const runImport = useCallback(async () => {
    if (!csvText.trim()) return;
    setImporting(true);
    setImportResult(null);
    try {
      const r = await lensRun<ImportResult>('crypto', 'import-csv', { csv: csvText });
      if (r.data?.ok && r.data.result) {
        setImportResult(r.data.result);
        setCsvText('');
        await loadHoldings();
      }
    } finally {
      setImporting(false);
    }
  }, [csvText, loadHoldings]);

  const deliverAlerts = useCallback(async () => {
    setDelivering(true);
    try {
      await lensRun('crypto', 'alert-deliver', {});
      await loadDeliveries();
    } finally {
      setDelivering(false);
    }
  }, [loadDeliveries]);

  const markDeliveriesRead = useCallback(async () => {
    await lensRun('crypto', 'alert-deliveries-mark-read', {});
    await loadDeliveries();
  }, [loadDeliveries]);

  // ── Derived ────────────────────────────────────────────────────────────────

  const allChains = useMemo(() => {
    const set = new Set<string>();
    for (const h of holdings) for (const c of h.chains) set.add(c);
    return Array.from(set).sort();
  }, [holdings]);

  const filteredHoldings = useMemo(
    () => holdings.filter(h => chainFilter === 'all' || h.chains.includes(chainFilter)),
    [holdings, chainFilter],
  );

  const filteredTotal = useMemo(
    () => filteredHoldings.reduce((s, h) => s + (h.marketValueUsd || 0), 0),
    [filteredHoldings],
  );

  const allocChartData = useMemo(
    () => breakdown.map(b => ({ symbol: b.ticker, Current: b.currentPct, Target: b.targetPct })),
    [breakdown],
  );

  // ── Render ─────────────────────────────────────────────────────────────────

  return (
    <div className="space-y-5">
      {/* Live P&L ticker */}
      <section className="panel p-4">
        <div className="flex items-center justify-between mb-3">
          <h3 className="font-semibold flex items-center gap-2 text-sm">
            <Radio className={cn('w-4 h-4', streaming ? 'text-neon-green animate-pulse' : 'text-gray-400')} />
            Live P&amp;L Ticker
          </h3>
          <button
            onClick={() => setStreaming(v => !v)}
            className={cn(
              'px-3 py-1.5 rounded-lg text-xs font-medium transition-colors',
              streaming
                ? 'bg-neon-green/20 text-neon-green border border-neon-green/30'
                : 'bg-lattice-surface text-gray-400 hover:text-white border border-lattice-border',
            )}
          >
            {streaming ? 'Streaming · 30s' : 'Start live stream'}
          </button>
        </div>
        {!streaming && (
          <p className="text-xs text-gray-400">
            Streaming polls real CoinGecko prices every 30s and re-totals against your FIFO cost basis.
          </p>
        )}
        {streaming && !stream && (
          <div className="flex items-center gap-2 text-xs text-gray-400">
            <Loader2 className="w-4 h-4 animate-spin" /> Fetching live prices...
          </div>
        )}
        {streaming && stream && (
          <div className="space-y-3">
            <div className="grid grid-cols-2 md:grid-cols-3 gap-3">
              <div className="p-3 bg-lattice-deep rounded-lg">
                <p className="text-lg font-bold">{fmtUsd(stream.totalValueUsd)}</p>
                <p className="text-[11px] text-gray-400">Live Portfolio Value</p>
              </div>
              <div className="p-3 bg-lattice-deep rounded-lg">
                <p className={cn('text-lg font-bold flex items-center gap-1',
                  stream.unrealizedPnlUsd >= 0 ? 'text-neon-green' : 'text-neon-pink')}>
                  {stream.unrealizedPnlUsd >= 0
                    ? <TrendingUp className="w-4 h-4" /> : <TrendingDown className="w-4 h-4" />}
                  {stream.unrealizedPnlUsd >= 0 ? '+' : ''}{fmtUsd(stream.unrealizedPnlUsd)}
                </p>
                <p className="text-[11px] text-gray-400">Unrealized P&amp;L ({stream.unrealizedPnlPct}%)</p>
              </div>
              <div className="p-3 bg-lattice-deep rounded-lg">
                <p className="text-lg font-bold">{stream.ticks.length}</p>
                <p className="text-[11px] text-gray-400">
                  Tracked · {new Date(stream.at).toLocaleTimeString()}
                </p>
              </div>
            </div>
            <div className="space-y-1.5">
              {stream.ticks.map(t => (
                <div key={t.symbol} className="flex items-center justify-between text-xs px-3 py-1.5 bg-lattice-deep rounded">
                  <span className="font-mono font-semibold text-gray-200">{t.ticker}</span>
                  <span className="text-gray-400">{fmtUsd(t.priceUsd)}</span>
                  <span className="text-gray-400">{t.qty} held</span>
                  <span className={cn('font-mono',
                    (t.unrealizedPnlUsd ?? 0) >= 0 ? 'text-neon-green' : 'text-neon-pink')}>
                    {t.unrealizedPnlUsd != null
                      ? `${t.unrealizedPnlUsd >= 0 ? '+' : ''}${fmtUsd(t.unrealizedPnlUsd)}`
                      : '—'}
                  </span>
                </div>
              ))}
            </div>
          </div>
        )}
      </section>

      {/* Holdings + cross-chain filter */}
      <section className="panel p-4">
        <div className="flex items-center justify-between mb-3">
          <h3 className="font-semibold flex items-center gap-2 text-sm">
            <RefreshCw className={cn('w-4 h-4 text-neon-blue', holdingsLoading && 'animate-spin')} />
            Holdings (FIFO cost basis)
          </h3>
          <div className="flex items-center gap-2">
            <button aria-label="Refresh" onClick={loadHoldings} className="p-1.5 text-gray-400 hover:text-white rounded hover:bg-white/5">
              <RefreshCw className="w-4 h-4" />
            </button>
            <button
              onClick={() => setShowAdd(v => !v)}
              className="flex items-center gap-1 px-3 py-1.5 text-xs bg-neon-green/20 text-neon-green rounded-lg hover:bg-neon-green/30"
            >
              <Plus className="w-3.5 h-3.5" /> Add Holding
            </button>
          </div>
        </div>

        {/* Cross-chain / multi-network filter */}
        {allChains.length > 0 && (
          <div className="flex flex-wrap gap-1.5 mb-3">
            <button
              onClick={() => setChainFilter('all')}
              className={cn('px-2.5 py-1 rounded text-[11px] capitalize transition-colors',
                chainFilter === 'all'
                  ? 'bg-neon-blue/20 text-neon-blue border border-neon-blue/30'
                  : 'bg-lattice-surface text-gray-400 hover:text-white')}
            >
              All networks
            </button>
            {allChains.map(c => (
              <button
                key={c}
                onClick={() => setChainFilter(c)}
                className={cn('px-2.5 py-1 rounded text-[11px] capitalize transition-colors',
                  chainFilter === c
                    ? 'bg-neon-blue/20 text-neon-blue border border-neon-blue/30'
                    : 'bg-lattice-surface text-gray-400 hover:text-white')}
              >
                {c}
              </button>
            ))}
          </div>
        )}

        {showAdd && (
          <div className="grid grid-cols-2 md:grid-cols-5 gap-2 mb-3 p-3 bg-lattice-deep rounded-lg">
            <input value={addSymbol} onChange={e => setAddSymbol(e.target.value)}
              placeholder="CoinGecko id (bitcoin)"
              className="px-2 py-1.5 bg-lattice-surface border border-lattice-border rounded text-xs" />
            <input value={addTicker} onChange={e => setAddTicker(e.target.value)}
              placeholder="Ticker (BTC)"
              className="px-2 py-1.5 bg-lattice-surface border border-lattice-border rounded text-xs" />
            <input value={addQty} onChange={e => setAddQty(e.target.value)} type="number" min={0} step="any"
              placeholder="Quantity"
              className="px-2 py-1.5 bg-lattice-surface border border-lattice-border rounded text-xs" />
            <input value={addCost} onChange={e => setAddCost(e.target.value)} type="number" min={0} step="any"
              placeholder="Total cost (USD)"
              className="px-2 py-1.5 bg-lattice-surface border border-lattice-border rounded text-xs" />
            <select value={addChain} onChange={e => setAddChain(e.target.value)}
              className="px-2 py-1.5 bg-lattice-surface border border-lattice-border rounded text-xs text-white">
              {['ethereum', 'solana', 'bitcoin', 'polygon', 'base', 'arbitrum', 'optimism', 'sui', 'avalanche']
                .map(c => <option key={c} value={c}>{c}</option>)}
            </select>
            <button onClick={addHolding} disabled={busy}
              className="col-span-2 md:col-span-5 px-3 py-1.5 bg-neon-green text-black rounded text-xs font-bold disabled:opacity-50">
              {busy ? 'Saving...' : 'Save lot'}
            </button>
          </div>
        )}

        {filteredHoldings.length === 0 ? (
          <p className="text-xs text-gray-400 py-4 text-center">
            {holdings.length === 0
              ? 'No holdings yet. Add a lot or sync an on-chain wallet below.'
              : 'No holdings on this network.'}
          </p>
        ) : (
          <>
            <div className="text-xs text-gray-400 mb-2">
              {chainFilter === 'all' ? 'All networks' : chainFilter} total:{' '}
              <span className="text-neon-green font-mono font-semibold">{fmtUsd(filteredTotal)}</span>
            </div>
            <div className="space-y-1.5">
              {filteredHoldings.map(h => (
                <div key={h.symbol} className="flex items-center justify-between px-3 py-2 bg-lattice-deep rounded-lg text-xs">
                  <div className="flex items-center gap-2">
                    <span className="font-mono font-bold text-gray-100 w-14">{h.ticker}</span>
                    <span className="flex gap-1">
                      {h.chains.map(c => (
                        <span key={c} className="px-1.5 py-0.5 rounded bg-lattice-surface text-[9px] text-gray-400 capitalize">
                          {c}
                        </span>
                      ))}
                    </span>
                  </div>
                  <span className="text-gray-400">{h.qty} @ {fmtUsd(h.avgCostUsd)}</span>
                  <span className="text-gray-200 font-mono">{fmtUsd(h.marketValueUsd)}</span>
                  <span className={cn('font-mono w-24 text-right',
                    (h.unrealizedPnlUsd ?? 0) >= 0 ? 'text-neon-green' : 'text-neon-pink')}>
                    {h.unrealizedPnlUsd != null
                      ? `${h.unrealizedPnlUsd >= 0 ? '+' : ''}${fmtUsd(h.unrealizedPnlUsd)}`
                      : '—'}
                    {h.unrealizedPnlPct != null && (
                      <span className="text-[10px] ml-1">({h.unrealizedPnlPct}%)</span>
                    )}
                  </span>
                </div>
              ))}
            </div>
          </>
        )}
      </section>

      {/* On-chain sync */}
      <section className="panel p-4">
        <h3 className="font-semibold flex items-center gap-2 text-sm mb-3">
          <Link2 className="w-4 h-4 text-neon-purple" />
          On-chain Balance Sync
        </h3>
        <p className="text-[11px] text-gray-400 mb-3">
          Read-only native-balance import via public RPC. The balance lands as a zero-cost
          observation lot — set a cost basis with Add Holding to track realized P&amp;L.
        </p>
        <div className="grid grid-cols-1 md:grid-cols-[1fr_auto_auto] gap-2">
          <input
            value={syncAddress}
            onChange={e => setSyncAddress(e.target.value)}
            placeholder="0x… wallet address"
            className="px-2.5 py-1.5 bg-lattice-surface border border-lattice-border rounded text-xs font-mono"
          />
          <select
            value={syncChain}
            onChange={e => setSyncChain(e.target.value)}
            className="px-2.5 py-1.5 bg-lattice-surface border border-lattice-border rounded text-xs text-white"
          >
            {EVM_CHAINS.map(c => <option key={c} value={c}>{c}</option>)}
          </select>
          <button
            onClick={runSync}
            disabled={syncing}
            className="px-3 py-1.5 bg-neon-purple/20 text-neon-purple border border-neon-purple/30 rounded text-xs font-medium hover:bg-neon-purple/30 disabled:opacity-50 flex items-center gap-1.5"
          >
            {syncing ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <RefreshCw className="w-3.5 h-3.5" />}
            Sync
          </button>
        </div>
        {syncError && <p className="text-[11px] text-neon-pink mt-2">{syncError}</p>}
        {syncs.length > 0 && (
          <div className="mt-3 space-y-1">
            {syncs.map(s => (
              <div key={`${s.chain}:${s.address}`} className="flex items-center justify-between text-[11px] px-2.5 py-1.5 bg-lattice-deep rounded">
                <span className="font-mono text-gray-400">
                  {s.address.slice(0, 8)}…{s.address.slice(-6)}
                </span>
                <span className="capitalize text-gray-400">{s.chain}</span>
                <span className="font-mono text-gray-200">{s.balance} {s.nativeTicker}</span>
                <span className="text-gray-600">{new Date(s.syncedAt).toLocaleString()}</span>
              </div>
            ))}
          </div>
        )}
      </section>

      {/* Staking / yield positions */}
      <section className="panel p-4">
        <h3 className="font-semibold flex items-center gap-2 text-sm mb-3">
          <PiggyBank className="w-4 h-4 text-neon-cyan" />
          Staking &amp; Yield Positions
        </h3>
        <div className="grid grid-cols-2 md:grid-cols-5 gap-2 mb-3 p-3 bg-lattice-deep rounded-lg">
          <input value={stakeSymbol} onChange={e => setStakeSymbol(e.target.value)}
            placeholder="Asset (solana)"
            className="px-2 py-1.5 bg-lattice-surface border border-lattice-border rounded text-xs" />
          <input value={stakeQty} onChange={e => setStakeQty(e.target.value)} type="number" min={0} step="any"
            placeholder="Quantity"
            className="px-2 py-1.5 bg-lattice-surface border border-lattice-border rounded text-xs" />
          <input value={stakeValidator} onChange={e => setStakeValidator(e.target.value)}
            placeholder="Validator (optional)"
            className="px-2 py-1.5 bg-lattice-surface border border-lattice-border rounded text-xs" />
          <input value={stakeApr} onChange={e => setStakeApr(e.target.value)} type="number" min={0} step="any"
            placeholder="APR %"
            className="px-2 py-1.5 bg-lattice-surface border border-lattice-border rounded text-xs" />
          <button onClick={openStake} disabled={busy}
            className="px-3 py-1.5 bg-neon-cyan/20 text-neon-cyan border border-neon-cyan/30 rounded text-xs font-medium hover:bg-neon-cyan/30 disabled:opacity-50">
            Open position
          </button>
        </div>
        {positions.length === 0 ? (
          <p className="text-xs text-gray-400 py-2 text-center">No staking positions yet.</p>
        ) : (
          <div className="space-y-1.5">
            {positions.map(p => (
              <div key={p.id} className="flex items-center justify-between px-3 py-2 bg-lattice-deep rounded-lg text-xs">
                <span className="font-mono font-bold text-gray-100 w-16">{p.ticker}</span>
                <span className="text-gray-400">{p.qty} staked</span>
                <span className="text-gray-400">{p.aprPct != null ? `${p.aprPct}% APR` : 'APR n/a'}</span>
                <span className="text-gray-400 truncate max-w-[120px]">{p.validator || 'no validator'}</span>
                <span className="text-neon-green font-mono">
                  +{fmtUsd(p.cumulativeRewardsUsd)} rewards
                </span>
                {p.active ? (
                  <button
                    onClick={() => unstake(p.id)}
                    className="px-2 py-0.5 rounded bg-neon-pink/15 text-neon-pink text-[10px] hover:bg-neon-pink/25"
                  >
                    Unstake
                  </button>
                ) : (
                  <span className="px-2 py-0.5 rounded bg-lattice-surface text-gray-400 text-[10px]">Unstaked</span>
                )}
              </div>
            ))}
          </div>
        )}
      </section>

      {/* Allocation breakdown + rebalancing */}
      <section className="panel p-4">
        <div className="flex items-center justify-between mb-3">
          <h3 className="font-semibold flex items-center gap-2 text-sm">
            <Scale className="w-4 h-4 text-neon-green" />
            Allocation &amp; Rebalancing
          </h3>
          <button
            onClick={computeAllocation}
            disabled={allocLoading}
            className="flex items-center gap-1.5 px-3 py-1.5 text-xs bg-neon-green/20 text-neon-green border border-neon-green/30 rounded-lg hover:bg-neon-green/30 disabled:opacity-50"
          >
            {allocLoading ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Scale className="w-3.5 h-3.5" />}
            Compute
          </button>
        </div>
        {breakdown.length === 0 ? (
          <p className="text-xs text-gray-400 py-2 text-center">
            Run Compute to see current vs equal-weight target allocation and rebalancing trades.
          </p>
        ) : (
          <div className="space-y-3">
            <p className="text-[11px] text-gray-400">Target mode: {targetMode}</p>
            <ChartKit
              kind="bar"
              data={allocChartData}
              xKey="symbol"
              series={[
                { key: 'Current', label: 'Current %', color: ALLOC_HEX[0] },
                { key: 'Target', label: 'Target %', color: ALLOC_HEX[1] },
              ]}
              height={200}
            />
            {rebalance.length > 0 ? (
              <div className="space-y-1.5">
                <p className="text-[11px] text-gray-400 font-semibold uppercase tracking-wide">
                  Suggested rebalancing trades
                </p>
                {rebalance.map(r => (
                  <div key={r.symbol} className="flex items-center justify-between px-3 py-1.5 bg-lattice-deep rounded text-xs">
                    <span className={cn('px-2 py-0.5 rounded text-[10px] font-bold uppercase',
                      r.action === 'buy'
                        ? 'bg-neon-green/20 text-neon-green'
                        : 'bg-neon-pink/20 text-neon-pink')}>
                      {r.action}
                    </span>
                    <span className="font-mono font-bold text-gray-100">{r.ticker}</span>
                    <span className="text-gray-400">{fmtUsd(r.deltaUsd)}</span>
                    <span className="text-gray-400">{r.deltaQty} units</span>
                    <span className="text-gray-600">{r.currentPct}% → {r.targetPct}%</span>
                  </div>
                ))}
              </div>
            ) : (
              <p className="text-[11px] text-neon-green">Portfolio is within drift tolerance — no rebalancing needed.</p>
            )}
          </div>
        )}
      </section>

      {/* CSV import */}
      <section className="panel p-4">
        <h3 className="font-semibold flex items-center gap-2 text-sm mb-3">
          <Upload className="w-4 h-4 text-neon-blue" />
          Transaction CSV Import
        </h3>
        <p className="text-[11px] text-gray-400 mb-2">
          Paste an exchange export. Required columns: type (buy/sell), symbol, qty. Optional: date, price, total, fee.
          Buys create cost-basis lots; sells close lots FIFO with realized G/L.
        </p>
        <textarea
          value={csvText}
          onChange={e => setCsvText(e.target.value)}
          rows={4}
          placeholder={'Date,Type,Symbol,Quantity,Total,Fee\n2024-01-10,Buy,BTC,1,40000,10'}
          className="w-full px-2.5 py-2 bg-lattice-surface border border-lattice-border rounded text-xs font-mono"
        />
        <button
          onClick={runImport}
          disabled={importing || !csvText.trim()}
          className="mt-2 flex items-center gap-1.5 px-3 py-1.5 text-xs bg-neon-blue/20 text-neon-blue border border-neon-blue/30 rounded-lg hover:bg-neon-blue/30 disabled:opacity-50"
        >
          {importing ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Upload className="w-3.5 h-3.5" />}
          Import CSV
        </button>
        {importResult && (
          <div className="mt-3 p-3 bg-lattice-deep rounded-lg text-xs space-y-1.5">
            <div className="flex gap-4">
              <span className="text-neon-green">{importResult.buyCount} buys</span>
              <span className="text-neon-pink">{importResult.sellCount} sells</span>
              <span className="text-gray-400">{importResult.importedCount} imported</span>
              {importResult.errorCount > 0 && (
                <span className="text-yellow-400">{importResult.errorCount} errors</span>
              )}
            </div>
            {importResult.errors.length > 0 && (
              <div className="space-y-0.5">
                {importResult.errors.map((e, i) => (
                  <p key={i} className="text-[10px] text-yellow-400">Row {e.row}: {e.reason}</p>
                ))}
              </div>
            )}
          </div>
        )}
      </section>

      {/* Push alert delivery */}
      <section className="panel p-4">
        <div className="flex items-center justify-between mb-3">
          <h3 className="font-semibold flex items-center gap-2 text-sm">
            <BellRing className={cn('w-4 h-4', deliveryUnread > 0 ? 'text-yellow-400' : 'text-gray-400')} />
            Price-alert Delivery
            {deliveryUnread > 0 && (
              <span className="px-1.5 py-0.5 rounded-full bg-yellow-500/20 text-yellow-400 text-[10px]">
                {deliveryUnread} new
              </span>
            )}
          </h3>
          <div className="flex items-center gap-2">
            {deliveryUnread > 0 && (
              <button
                onClick={markDeliveriesRead}
                className="px-2.5 py-1 text-[11px] bg-lattice-surface text-gray-400 hover:text-white rounded"
              >
                Mark all read
              </button>
            )}
            <button
              onClick={deliverAlerts}
              disabled={delivering}
              className="flex items-center gap-1.5 px-3 py-1.5 text-xs bg-yellow-500/20 text-yellow-400 border border-yellow-500/30 rounded-lg hover:bg-yellow-500/30 disabled:opacity-50"
            >
              {delivering ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <BellRing className="w-3.5 h-3.5" />}
              Check &amp; deliver
            </button>
          </div>
        </div>
        <p className="text-[11px] text-gray-400 mb-2">
          Runs your armed price alerts against live CoinGecko prices and pushes any crossings as
          delivered notifications (also emitted on the <code>crypto:alert</code> socket channel).
        </p>
        {deliveries.length === 0 ? (
          <p className="text-xs text-gray-400 py-2 text-center">No alert deliveries yet.</p>
        ) : (
          <div className="space-y-1.5">
            {deliveries.map(d => (
              <div
                key={d.id}
                className={cn('flex items-center justify-between px-3 py-2 rounded-lg text-xs',
                  d.read ? 'bg-lattice-deep' : 'bg-yellow-500/10 border border-yellow-500/20')}
              >
                <span className="text-gray-200">{d.message}</span>
                <span className="text-gray-600">{new Date(d.deliveredAt).toLocaleString()}</span>
              </div>
            ))}
          </div>
        )}
      </section>
    </div>
  );
}
