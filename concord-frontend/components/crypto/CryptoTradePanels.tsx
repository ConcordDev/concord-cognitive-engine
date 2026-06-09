'use client';

/**
 * CryptoTradePanels — limit-order trade desk, CoinGecko market overview,
 * and the multi-wallet + send surface.
 */

import { useCallback, useEffect, useState } from 'react';
import {
  Loader2, Plus, Trash2, X, CandlestickChart, Globe, TrendingUp, TrendingDown,
  Flame, Wallet, Send, RefreshCw, Check,
} from 'lucide-react';
import { lensRun } from '@/lib/api/client';
import { cn } from '@/lib/utils';

const fmtUsd = (n: number | null | undefined) =>
  n == null ? '—' : `$${Number(n).toLocaleString(undefined, { maximumFractionDigits: 2 })}`;

// ── Trade — limit orders ──────────────────────────────────────

interface Order {
  id: string; symbol: string; ticker: string; side: 'buy' | 'sell';
  qty: number; limitPriceUsd: number; status: string; fillPriceUsd?: number; note?: string;
}

export function TradePanel() {
  const [orders, setOrders] = useState<Order[]>([]);
  const [loading, setLoading] = useState(true);
  const [checking, setChecking] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const [form, setForm] = useState({ symbol: '', side: 'buy', qty: '', limitPriceUsd: '' });

  const refresh = useCallback(async () => {
    setLoading(true);
    try {
      const r = await lensRun({ domain: 'crypto', action: 'order-list', input: {} });
      setOrders((r.data?.result?.orders || []) as Order[]);
    } catch (e) { console.error('[Trade] failed', e); }
    finally { setLoading(false); }
  }, []);

  useEffect(() => { void refresh(); }, [refresh]);

  async function create() {
    if (!form.symbol.trim() || !form.qty || !form.limitPriceUsd) return;
    const r = await lensRun({ domain: 'crypto', action: 'order-create', input: {
      symbol: form.symbol.trim().toLowerCase(), side: form.side,
      qty: Number(form.qty), limitPriceUsd: Number(form.limitPriceUsd),
    } });
    if (r.data?.ok === false) { setNotice(r.data?.error || 'Failed'); return; }
    setForm({ symbol: '', side: 'buy', qty: '', limitPriceUsd: '' });
    setNotice(null);
    await refresh();
  }
  async function cancel(id: string) {
    await lensRun({ domain: 'crypto', action: 'order-cancel', input: { id } });
    await refresh();
  }
  async function checkFills() {
    setChecking(true);
    try {
      const r = await lensRun({ domain: 'crypto', action: 'orders-check', input: {} });
      const res = r.data?.result;
      setNotice(res?.priceSource === 'unavailable'
        ? 'Live prices unavailable — try again shortly.'
        : `${res?.filledCount || 0} order(s) filled · ${res?.stillOpen || 0} still open.`);
      await refresh();
    } finally { setChecking(false); }
  }

  const open = orders.filter((o) => o.status === 'open');
  const closed = orders.filter((o) => o.status !== 'open');

  return (
    <div className="bg-[#0d1117] border border-blue-500/15 rounded-lg overflow-hidden">
      <header className="px-4 py-2.5 border-b border-white/10 flex items-center gap-2">
        <CandlestickChart className="w-4 h-4 text-blue-400" />
        <span className="text-sm font-semibold text-gray-200">Limit orders</span>
        <span className="text-[10px] text-gray-400">{open.length} open</span>
        <button type="button" onClick={checkFills} disabled={checking || open.length === 0}
          className="ml-auto px-2.5 py-1 text-[11px] rounded bg-blue-500 text-white font-bold hover:bg-blue-400 disabled:opacity-40 inline-flex items-center gap-1">
          {checking ? <Loader2 className="w-3 h-3 animate-spin" /> : <RefreshCw className="w-3 h-3" />}Check fills
        </button>
      </header>

      <div className="p-3 border-b border-white/10 grid grid-cols-2 sm:grid-cols-5 gap-2">
        <input value={form.symbol} onChange={(e) => setForm({ ...form, symbol: e.target.value })}
          placeholder="coingecko id" className="px-2 py-1.5 text-xs bg-lattice-deep border border-lattice-border rounded text-white font-mono" />
        <select value={form.side} onChange={(e) => setForm({ ...form, side: e.target.value })}
          className="px-2 py-1.5 text-xs bg-lattice-deep border border-lattice-border rounded text-white">
          <option value="buy">Buy</option>
          <option value="sell">Sell</option>
        </select>
        <input value={form.qty} onChange={(e) => setForm({ ...form, qty: e.target.value })}
          inputMode="decimal" placeholder="qty" className="px-2 py-1.5 text-xs bg-lattice-deep border border-lattice-border rounded text-white" />
        <input value={form.limitPriceUsd} onChange={(e) => setForm({ ...form, limitPriceUsd: e.target.value })}
          inputMode="decimal" placeholder="limit $" className="px-2 py-1.5 text-xs bg-lattice-deep border border-lattice-border rounded text-white" />
        <button type="button" onClick={create}
          className="px-3 py-1.5 text-xs rounded bg-blue-500 text-white font-bold hover:bg-blue-400 inline-flex items-center justify-center gap-1">
          <Plus className="w-3 h-3" />Place
        </button>
      </div>

      {notice && <div className="px-3 py-1.5 text-[11px] text-blue-200 bg-blue-500/10 border-b border-white/5">{notice}</div>}

      {loading ? (
        <div className="flex items-center justify-center py-10 text-xs text-gray-400"><Loader2 className="w-4 h-4 animate-spin mr-2" />Loading…</div>
      ) : orders.length === 0 ? (
        <div className="px-3 py-10 text-center text-xs text-gray-400">No orders yet. Place a limit order above.</div>
      ) : (
        <div className="divide-y divide-white/5">
          {[...open, ...closed].map((o) => (
            <div key={o.id} className="px-3 py-2 flex items-center gap-2">
              <span className={cn('text-[10px] font-bold px-1.5 py-0.5 rounded',
                o.side === 'buy' ? 'bg-emerald-500/20 text-emerald-300' : 'bg-rose-500/20 text-rose-300')}>
                {o.side.toUpperCase()}
              </span>
              <span className="text-xs font-mono text-white">{o.qty} {o.ticker}</span>
              <span className="text-[11px] text-gray-400">@ {fmtUsd(o.limitPriceUsd)}</span>
              <div className="flex-1" />
              <span className={cn('text-[10px] uppercase',
                o.status === 'open' ? 'text-blue-300' : o.status === 'filled' ? 'text-emerald-400' : 'text-gray-400')}>
                {o.status}{o.status === 'filled' && o.fillPriceUsd ? ` @ ${fmtUsd(o.fillPriceUsd)}` : ''}
              </span>
              {o.status === 'open' && (
                <button aria-label="Cancel order" type="button" onClick={() => cancel(o.id)} className="text-gray-400 hover:text-rose-300">
                  <X className="w-3.5 h-3.5" />
                </button>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

// ── Market overview ───────────────────────────────────────────

interface MarketCoin { id: string; symbol: string; name: string; priceUsd: number; change24h: number; iconUrl?: string }
interface TrendCoin { id: string; symbol: string; name: string; rank: number | null }
interface MarketData {
  trending: TrendCoin[]; gainers: MarketCoin[]; losers: MarketCoin[];
  global: { totalMarketCapUsd: number | null; totalVolume24hUsd: number | null; marketCapChange24hPct: number | null; btcDominancePct: number | null; ethDominancePct: number | null };
}

export function MarketPanel() {
  const [data, setData] = useState<MarketData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    setLoading(true); setError(null);
    try {
      const r = await lensRun({ domain: 'crypto', action: 'market-overview', input: {} });
      if (r.data?.ok === false) { setError(r.data?.error || 'Market data unavailable.'); setData(null); }
      else setData(r.data?.result as MarketData);
    } catch { setError('Market data unavailable.'); }
    finally { setLoading(false); }
  }, []);

  useEffect(() => { void refresh(); }, [refresh]);

  return (
    <div className="bg-[#0d1117] border border-blue-500/15 rounded-lg overflow-hidden">
      <header className="px-4 py-2.5 border-b border-white/10 flex items-center gap-2">
        <Globe className="w-4 h-4 text-blue-400" />
        <span className="text-sm font-semibold text-gray-200">Market overview</span>
        <button aria-label="Refresh" type="button" onClick={refresh} className="ml-auto text-gray-400 hover:text-white"><RefreshCw className="w-3.5 h-3.5" /></button>
      </header>

      {loading ? (
        <div className="flex items-center justify-center py-12 text-xs text-gray-400"><Loader2 className="w-4 h-4 animate-spin mr-2" />Loading market…</div>
      ) : error ? (
        <div className="px-3 py-10 text-center text-xs text-rose-300">{error}</div>
      ) : data ? (
        <div className="p-3 space-y-3">
          {data.global && (
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
              <Stat label="Market cap" value={data.global.totalMarketCapUsd ? `$${(data.global.totalMarketCapUsd / 1e12).toFixed(2)}T` : '—'} />
              <Stat label="24h volume" value={data.global.totalVolume24hUsd ? `$${(data.global.totalVolume24hUsd / 1e9).toFixed(1)}B` : '—'} />
              <Stat label="BTC dominance" value={data.global.btcDominancePct != null ? `${data.global.btcDominancePct.toFixed(1)}%` : '—'} />
              <Stat label="ETH dominance" value={data.global.ethDominancePct != null ? `${data.global.ethDominancePct.toFixed(1)}%` : '—'} />
            </div>
          )}
          <div className="grid grid-cols-1 lg:grid-cols-3 gap-3">
            <MarketList title="Trending" icon={<Flame className="w-3.5 h-3.5 text-orange-400" />}>
              {data.trending.map((c) => (
                <li key={c.id} className="flex items-center gap-2 px-2 py-1 text-xs">
                  <span className="text-white font-medium truncate flex-1">{c.name}</span>
                  <span className="text-gray-400 font-mono">{c.symbol}</span>
                  {c.rank && <span className="text-[10px] text-gray-400">#{c.rank}</span>}
                </li>
              ))}
            </MarketList>
            <MarketList title="Top gainers" icon={<TrendingUp className="w-3.5 h-3.5 text-emerald-400" />}>
              {data.gainers.map((c) => <CoinRow key={c.id} c={c} />)}
            </MarketList>
            <MarketList title="Top losers" icon={<TrendingDown className="w-3.5 h-3.5 text-rose-400" />}>
              {data.losers.map((c) => <CoinRow key={c.id} c={c} />)}
            </MarketList>
          </div>
        </div>
      ) : null}
    </div>
  );
}

function CoinRow({ c }: { c: MarketCoin }) {
  return (
    <li className="flex items-center gap-2 px-2 py-1 text-xs">
      <span className="text-white font-medium truncate flex-1">{c.symbol}</span>
      <span className="text-gray-400 font-mono">{fmtUsd(c.priceUsd)}</span>
      <span className={cn('font-mono w-14 text-right', c.change24h >= 0 ? 'text-emerald-400' : 'text-rose-400')}>
        {c.change24h >= 0 ? '+' : ''}{c.change24h.toFixed(1)}%
      </span>
    </li>
  );
}
function MarketList({ title, icon, children }: { title: string; icon: React.ReactNode; children: React.ReactNode }) {
  return (
    <div className="bg-black/30 border border-white/5 rounded">
      <div className="px-2 py-1.5 border-b border-white/5 flex items-center gap-1.5 text-[11px] font-semibold text-gray-300">
        {icon}{title}
      </div>
      <ul className="divide-y divide-white/[0.03] max-h-72 overflow-y-auto">{children}</ul>
    </div>
  );
}
function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="bg-black/30 border border-white/5 rounded px-2 py-1.5 text-center">
      <div className="text-sm font-bold text-white">{value}</div>
      <div className="text-[9px] uppercase tracking-wide text-gray-400">{label}</div>
    </div>
  );
}

// ── Portfolio performance (snapshots over time) ───────────────

interface Snap { date: string; totalValueUsd: number; totalCostUsd: number }
interface History {
  series: Snap[]; points: number; startValueUsd?: number; endValueUsd?: number;
  changeUsd?: number; changePct?: number;
  bestDay?: { date: string; delta: number } | null; worstDay?: { date: string; delta: number } | null;
  message?: string;
}

export function PerformanceCard() {
  const [history, setHistory] = useState<History | null>(null);
  const [loading, setLoading] = useState(true);
  const [capturing, setCapturing] = useState(false);

  const refresh = useCallback(async () => {
    setLoading(true);
    try {
      const r = await lensRun({ domain: 'crypto', action: 'portfolio-history', input: {} });
      setHistory(r.data?.result as History);
    } catch (e) { console.error('[Performance] failed', e); }
    finally { setLoading(false); }
  }, []);

  useEffect(() => { void refresh(); }, [refresh]);

  async function capture() {
    setCapturing(true);
    try {
      await lensRun({ domain: 'crypto', action: 'portfolio-snapshot', input: {} });
      await refresh();
    } finally { setCapturing(false); }
  }

  const series = history?.series || [];
  const max = Math.max(1, ...series.map((s) => s.totalValueUsd));

  return (
    <div className="bg-[#0d1117] border border-blue-500/15 rounded-lg overflow-hidden">
      <header className="px-4 py-2.5 border-b border-white/10 flex items-center gap-2">
        <TrendingUp className="w-4 h-4 text-blue-400" />
        <span className="text-sm font-semibold text-gray-200">Performance</span>
        <button type="button" onClick={capture} disabled={capturing}
          className="ml-auto px-2.5 py-1 text-[11px] rounded bg-blue-500 text-white font-bold hover:bg-blue-400 disabled:opacity-40 inline-flex items-center gap-1">
          {capturing ? <Loader2 className="w-3 h-3 animate-spin" /> : <Plus className="w-3 h-3" />}Capture snapshot
        </button>
      </header>
      {loading ? (
        <div className="flex items-center justify-center py-8 text-xs text-gray-400"><Loader2 className="w-4 h-4 animate-spin mr-2" />Loading…</div>
      ) : series.length < 2 ? (
        <div className="px-3 py-8 text-center text-xs text-gray-400">
          {history?.message || 'Capture snapshots over time to chart performance.'}
        </div>
      ) : (
        <div className="p-3 space-y-3">
          <div className="flex items-end gap-1 h-24">
            {series.map((s) => (
              <div key={s.date} className="flex-1 flex flex-col items-center justify-end" title={`${s.date}: ${fmtUsd(s.totalValueUsd)}`}>
                <div className="w-full bg-blue-500/60 rounded-t" style={{ height: `${Math.max(4, (s.totalValueUsd / max) * 100)}%` }} />
              </div>
            ))}
          </div>
          <div className="grid grid-cols-3 gap-2 text-center">
            <Stat label="Change" value={`${(history?.changeUsd || 0) >= 0 ? '+' : ''}${fmtUsd(history?.changeUsd)}`} />
            <Stat label="Change %" value={`${(history?.changePct || 0) >= 0 ? '+' : ''}${(history?.changePct || 0).toFixed(2)}%`} />
            <Stat label="Snapshots" value={String(history?.points || 0)} />
          </div>
          {history?.bestDay && history?.worstDay && (
            <div className="text-[11px] text-gray-400 flex justify-between">
              <span>Best day: <span className="text-emerald-400">+{fmtUsd(history.bestDay.delta)}</span> ({history.bestDay.date})</span>
              <span>Worst: <span className="text-rose-400">{fmtUsd(history.worstDay.delta)}</span> ({history.worstDay.date})</span>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

// ── Wallets & Send ────────────────────────────────────────────

interface WalletRow { id: string; name: string; kind: string; address: string | null }
const WALLET_KINDS = ['hot', 'hardware', 'exchange', 'watch'];

export function WalletsPanel() {
  const [wallets, setWallets] = useState<WalletRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [wForm, setWForm] = useState({ name: '', kind: 'hot' });
  const [sForm, setSForm] = useState({ symbol: '', qty: '', toAddress: '', networkFeeUsd: '' });
  const [notice, setNotice] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    setLoading(true);
    try {
      const r = await lensRun({ domain: 'crypto', action: 'wallet-list', input: {} });
      setWallets((r.data?.result?.wallets || []) as WalletRow[]);
    } catch (e) { console.error('[Wallets] failed', e); }
    finally { setLoading(false); }
  }, []);

  useEffect(() => { void refresh(); }, [refresh]);

  async function addWallet() {
    if (!wForm.name.trim()) return;
    await lensRun({ domain: 'crypto', action: 'wallet-create', input: { name: wForm.name.trim(), kind: wForm.kind } });
    setWForm({ name: '', kind: 'hot' });
    await refresh();
  }
  async function delWallet(id: string) {
    await lensRun({ domain: 'crypto', action: 'wallet-delete', input: { id } });
    await refresh();
  }
  async function send() {
    if (!sForm.symbol.trim() || !sForm.qty || !sForm.toAddress.trim()) return;
    const r = await lensRun({ domain: 'crypto', action: 'send', input: {
      symbol: sForm.symbol.trim().toLowerCase(), qty: Number(sForm.qty),
      toAddress: sForm.toAddress.trim(), networkFeeUsd: Number(sForm.networkFeeUsd) || 0,
    } });
    if (r.data?.ok === false) { setNotice(r.data?.error || 'Send failed.'); return; }
    setNotice(`Sent ${sForm.qty} ${sForm.symbol.toUpperCase()} to ${sForm.toAddress.slice(0, 10)}…`);
    setSForm({ symbol: '', qty: '', toAddress: '', networkFeeUsd: '' });
  }

  return (
    <div className="space-y-3">
      <div className="bg-[#0d1117] border border-blue-500/15 rounded-lg overflow-hidden">
        <header className="px-4 py-2.5 border-b border-white/10 flex items-center gap-2">
          <Wallet className="w-4 h-4 text-blue-400" />
          <span className="text-sm font-semibold text-gray-200">Wallets</span>
          <span className="text-[10px] text-gray-400">{wallets.length}</span>
        </header>
        <div className="p-3 border-b border-white/10 flex items-center gap-2">
          <input value={wForm.name} onChange={(e) => setWForm({ ...wForm, name: e.target.value })}
            placeholder="Wallet name" className="flex-1 px-2 py-1.5 text-xs bg-lattice-deep border border-lattice-border rounded text-white" />
          <select value={wForm.kind} onChange={(e) => setWForm({ ...wForm, kind: e.target.value })}
            className="px-2 py-1.5 text-xs bg-lattice-deep border border-lattice-border rounded text-white capitalize">
            {WALLET_KINDS.map((k) => <option key={k} value={k}>{k}</option>)}
          </select>
          <button type="button" onClick={addWallet}
            className="px-3 py-1.5 text-xs rounded bg-blue-500 text-white font-bold hover:bg-blue-400 inline-flex items-center gap-1">
            <Plus className="w-3 h-3" />Add
          </button>
        </div>
        {loading ? (
          <div className="flex items-center justify-center py-8 text-xs text-gray-400"><Loader2 className="w-4 h-4 animate-spin mr-2" />Loading…</div>
        ) : wallets.length === 0 ? (
          <div className="px-3 py-8 text-center text-xs text-gray-400">No wallets yet. Add one to organise holdings.</div>
        ) : (
          <div className="divide-y divide-white/5">
            {wallets.map((w) => (
              <div key={w.id} className="px-3 py-2 flex items-center gap-2">
                <Wallet className="w-3.5 h-3.5 text-blue-400" />
                <span className="text-xs text-white font-medium">{w.name}</span>
                <span className="text-[9px] uppercase px-1 rounded bg-white/10 text-gray-400">{w.kind}</span>
                <div className="flex-1" />
                <button aria-label="Delete" type="button" onClick={() => delWallet(w.id)} className="text-gray-400 hover:text-rose-300">
                  <Trash2 className="w-3.5 h-3.5" />
                </button>
              </div>
            ))}
          </div>
        )}
      </div>

      <div className="bg-[#0d1117] border border-blue-500/15 rounded-lg overflow-hidden">
        <header className="px-4 py-2.5 border-b border-white/10 flex items-center gap-2">
          <Send className="w-4 h-4 text-blue-400" />
          <span className="text-sm font-semibold text-gray-200">Send crypto</span>
        </header>
        <div className="p-3 space-y-2">
          <div className="grid grid-cols-2 gap-2">
            <input value={sForm.symbol} onChange={(e) => setSForm({ ...sForm, symbol: e.target.value })}
              placeholder="coingecko id" className="px-2 py-1.5 text-xs bg-lattice-deep border border-lattice-border rounded text-white font-mono" />
            <input value={sForm.qty} onChange={(e) => setSForm({ ...sForm, qty: e.target.value })}
              inputMode="decimal" placeholder="amount" className="px-2 py-1.5 text-xs bg-lattice-deep border border-lattice-border rounded text-white" />
          </div>
          <input value={sForm.toAddress} onChange={(e) => setSForm({ ...sForm, toAddress: e.target.value })}
            placeholder="destination address" className="w-full px-2 py-1.5 text-xs bg-lattice-deep border border-lattice-border rounded text-white font-mono" />
          <div className="flex items-center gap-2">
            <input value={sForm.networkFeeUsd} onChange={(e) => setSForm({ ...sForm, networkFeeUsd: e.target.value })}
              inputMode="decimal" placeholder="network fee $ (optional)"
              className="flex-1 px-2 py-1.5 text-xs bg-lattice-deep border border-lattice-border rounded text-white" />
            <button type="button" onClick={send}
              className="px-3 py-1.5 text-xs rounded bg-blue-500 text-white font-bold hover:bg-blue-400 inline-flex items-center gap-1">
              <Check className="w-3 h-3" />Send
            </button>
          </div>
          {notice && <p className="text-[11px] text-emerald-300">{notice}</p>}
          <p className="text-[10px] text-gray-400">
            Sending FIFO-debits your holdings and records a transfer in Activity. No on-chain broadcast — this is a portfolio-accurate ledger.
          </p>
        </div>
      </div>
    </div>
  );
}
