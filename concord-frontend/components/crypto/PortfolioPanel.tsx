'use client';

import { useEffect, useState } from 'react';
import { Wallet, Loader2, Plus, ArrowDownCircle } from 'lucide-react';
import { lensRun } from '@/lib/api/client';
import { cn } from '@/lib/utils';
import { PieChart, Pie, Cell, ResponsiveContainer, Tooltip } from 'recharts';

interface Holding {
  symbol: string; ticker: string; chains: string[];
  qty: number; avgCostUsd: number; totalCostUsd: number;
  priceUsd: number | null; marketValueUsd: number | null;
  unrealizedPnlUsd: number | null; unrealizedPnlPct: number | null;
  lotCount: number;
}
interface Summary {
  totalValueUsd: number; totalCostUsd: number;
  unrealizedPnlUsd: number; unrealizedPnlPct: number;
  realizedPnlYtdUsd: number; stakingRewardsYtdUsd: number;
  lotCount: number; symbolCount: number;
  byChain: Array<{ chain: string; valueUsd: number; qtyLots: number }>;
  priceSource: string;
}

const CHAIN_COLOURS: Record<string, string> = {
  ethereum: '#627eea', solana: '#9945ff', bitcoin: '#f7931a', polygon: '#8247e5',
  base: '#0052ff', arbitrum: '#28a0f0', optimism: '#ff0420', sui: '#4ca3ff', avalanche: '#e84142',
};

export function PortfolioPanel() {
  const [holdings, setHoldings] = useState<Holding[]>([]);
  const [summary, setSummary] = useState<Summary | null>(null);
  const [loading, setLoading] = useState(true);
  const [showAddBuy, setShowAddBuy] = useState(false);
  const [showSell, setShowSell] = useState<{ symbol: string; ticker: string } | null>(null);
  const [buyDraft, setBuyDraft] = useState({ symbol: '', ticker: '', qty: '', costBasisUsd: '', chain: 'ethereum', acquiredAt: '' });
  const [sellDraft, setSellDraft] = useState({ qty: '', proceedsUsd: '' });

  useEffect(() => { refresh(); }, []);

  async function refresh() {
    setLoading(true);
    try {
      const [h, s] = await Promise.all([
        lensRun({ domain: 'crypto', action: 'holdings-list', input: {} }),
        lensRun({ domain: 'crypto', action: 'portfolio-summary', input: {} }),
      ]);
      setHoldings((h.data?.result?.holdings || []) as Holding[]);
      setSummary((s.data?.result as Summary) || null);
    } catch (e) { console.error('[Portfolio] failed', e); }
    finally { setLoading(false); }
  }

  async function recordBuy() {
    if (!buyDraft.symbol.trim() || !buyDraft.qty || !buyDraft.costBasisUsd) return;
    try {
      const r = await lensRun({ domain: 'crypto', action: 'holdings-add', input: {
        symbol: buyDraft.symbol.trim().toLowerCase(),
        ticker: buyDraft.ticker.trim() || buyDraft.symbol.trim().toUpperCase(),
        qty: Number(buyDraft.qty),
        costBasisUsd: Number(buyDraft.costBasisUsd),
        chain: buyDraft.chain,
        acquiredAt: buyDraft.acquiredAt || undefined,
      } });
      if (r.data?.ok === false) { alert(r.data?.error); return; }
      setBuyDraft({ symbol: '', ticker: '', qty: '', costBasisUsd: '', chain: 'ethereum', acquiredAt: '' });
      setShowAddBuy(false);
      await refresh();
    } catch (e) { console.error('[Portfolio] buy', e); }
  }

  async function recordSell() {
    if (!showSell || !sellDraft.qty || !sellDraft.proceedsUsd) return;
    try {
      const r = await lensRun({ domain: 'crypto', action: 'holdings-sell', input: {
        symbol: showSell.symbol,
        qty: Number(sellDraft.qty),
        proceedsUsd: Number(sellDraft.proceedsUsd),
      } });
      if (r.data?.ok === false) { alert(r.data?.error); return; }
      const pnl = r.data?.result?.transaction?.realizedPnlUsd;
      alert(`Sold. Realized P&L: ${pnl >= 0 ? '+' : ''}$${pnl?.toFixed(2)} (FIFO cost basis applied).`);
      setSellDraft({ qty: '', proceedsUsd: '' });
      setShowSell(null);
      await refresh();
    } catch (e) { console.error('[Portfolio] sell', e); }
  }

  const chainData = summary?.byChain.map(c => ({ name: c.chain, value: c.valueUsd, fill: CHAIN_COLOURS[c.chain] || '#94a3b8' })) || [];

  return (
    <div className="space-y-3">
      {/* Top KPI tiles */}
      {summary && (
        <div className="grid grid-cols-2 lg:grid-cols-5 gap-3">
          <Tile label="Total value" value={`$${summary.totalValueUsd.toLocaleString()}`} bold />
          <Tile label="Cost basis" value={`$${summary.totalCostUsd.toLocaleString()}`} tone="neutral" />
          <Tile label="Unrealized" value={`${summary.unrealizedPnlUsd >= 0 ? '+' : ''}$${summary.unrealizedPnlUsd.toLocaleString()}`} sub={`${summary.unrealizedPnlPct >= 0 ? '+' : ''}${summary.unrealizedPnlPct.toFixed(2)}%`} tone={summary.unrealizedPnlUsd >= 0 ? 'positive' : 'negative'} />
          <Tile label="Realized YTD" value={`${summary.realizedPnlYtdUsd >= 0 ? '+' : ''}$${summary.realizedPnlYtdUsd.toLocaleString()}`} tone={summary.realizedPnlYtdUsd >= 0 ? 'positive' : 'negative'} />
          <Tile label="Staking YTD" value={`$${summary.stakingRewardsYtdUsd.toLocaleString()}`} tone="amber" />
        </div>
      )}

      {summary && summary.priceSource === 'unavailable' && (
        <div className="text-[11px] text-amber-300 px-3 py-1.5 rounded border border-amber-500/30 bg-amber-500/[0.04]">
          ⚠ Live prices unavailable (CoinGecko didn't respond). Market values shown as null. Holdings list still reflects your real cost basis.
        </div>
      )}

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-3">
        {/* Holdings table */}
        <div className="lg:col-span-2 bg-[#0d1117] border border-blue-500/15 rounded-lg overflow-hidden">
          <header className="px-4 py-2.5 border-b border-white/10 flex items-center gap-2">
            <Wallet className="w-4 h-4 text-blue-400" />
            <span className="text-sm font-semibold text-gray-200">Holdings</span>
            <span className="text-[10px] text-gray-400">{holdings.length} asset(s)</span>
            <button onClick={() => setShowAddBuy(v => !v)} className="ml-auto px-2.5 py-1 text-xs rounded bg-blue-500 text-white font-semibold hover:bg-blue-400 inline-flex items-center gap-1">
              <Plus className="w-3 h-3" />Record buy
            </button>
          </header>

          {showAddBuy && (
            <div className="p-3 border-b border-white/10 grid grid-cols-12 gap-2 bg-blue-500/[0.04]">
              <input value={buyDraft.symbol} onChange={e => setBuyDraft({ ...buyDraft, symbol: e.target.value, ticker: buyDraft.ticker || e.target.value.toUpperCase() })} placeholder="CoinGecko id (e.g. bitcoin) *" className="col-span-4 px-2 py-1.5 text-xs bg-lattice-deep border border-lattice-border rounded text-white font-mono" />
              <input value={buyDraft.ticker} onChange={e => setBuyDraft({ ...buyDraft, ticker: e.target.value.toUpperCase() })} placeholder="Ticker" className="col-span-2 px-2 py-1.5 text-xs bg-lattice-deep border border-lattice-border rounded text-white font-mono" />
              <input type="number" step="0.00000001" value={buyDraft.qty} onChange={e => setBuyDraft({ ...buyDraft, qty: e.target.value })} placeholder="Qty *" className="col-span-3 px-2 py-1.5 text-xs bg-lattice-deep border border-lattice-border rounded text-white font-mono" />
              <input type="number" step="0.01" value={buyDraft.costBasisUsd} onChange={e => setBuyDraft({ ...buyDraft, costBasisUsd: e.target.value })} placeholder="Total cost USD *" className="col-span-3 px-2 py-1.5 text-xs bg-lattice-deep border border-lattice-border rounded text-white font-mono" />
              <select value={buyDraft.chain} onChange={e => setBuyDraft({ ...buyDraft, chain: e.target.value })} className="col-span-3 px-2 py-1.5 text-xs bg-lattice-deep border border-lattice-border rounded text-white">
                {['ethereum','solana','bitcoin','polygon','base','arbitrum','optimism','sui','avalanche'].map(c => <option key={c} value={c}>{c}</option>)}
              </select>
              <input type="date" value={buyDraft.acquiredAt} onChange={e => setBuyDraft({ ...buyDraft, acquiredAt: e.target.value })} className="col-span-3 px-2 py-1.5 text-xs bg-lattice-deep border border-lattice-border rounded text-white font-mono" />
              <button onClick={recordBuy} className="col-span-6 px-3 py-1.5 text-xs rounded bg-blue-500 text-white font-bold hover:bg-blue-400">Save lot</button>
            </div>
          )}

          {showSell && (
            <div className="p-3 border-b border-white/10 grid grid-cols-12 gap-2 bg-rose-500/[0.04]">
              <div className="col-span-12 text-[11px] text-rose-200">Sell {showSell.ticker} (FIFO cost basis applied)</div>
              <input type="number" step="0.00000001" value={sellDraft.qty} onChange={e => setSellDraft({ ...sellDraft, qty: e.target.value })} placeholder="Qty to sell *" className="col-span-4 px-2 py-1.5 text-xs bg-lattice-deep border border-lattice-border rounded text-white font-mono" />
              <input type="number" step="0.01" value={sellDraft.proceedsUsd} onChange={e => setSellDraft({ ...sellDraft, proceedsUsd: e.target.value })} placeholder="Proceeds USD *" className="col-span-4 px-2 py-1.5 text-xs bg-lattice-deep border border-lattice-border rounded text-white font-mono" />
              <button onClick={recordSell} className="col-span-2 px-3 py-1.5 text-xs rounded bg-rose-500 text-white font-bold hover:bg-rose-400">Sell</button>
              <button onClick={() => setShowSell(null)} className="col-span-2 px-3 py-1.5 text-xs rounded text-gray-300 hover:bg-white/[0.05]">Cancel</button>
            </div>
          )}

          <div className="max-h-[28rem] overflow-y-auto">
            {loading ? (
              <div className="flex items-center justify-center py-10 text-xs text-gray-400"><Loader2 className="w-4 h-4 animate-spin mr-2" /> Loading…</div>
            ) : holdings.length === 0 ? (
              <div className="px-3 py-10 text-center text-xs text-gray-400"><Wallet className="w-6 h-6 mx-auto mb-2 opacity-30" />No holdings yet. Record your first buy.</div>
            ) : (
              <table className="w-full text-xs">
                <thead className="text-[10px] uppercase text-gray-400 border-b border-white/5">
                  <tr><th className="text-left py-1.5 pl-3">Asset</th><th className="text-right">Qty</th><th className="text-right">Avg cost</th><th className="text-right">Price</th><th className="text-right">Value</th><th className="text-right">PnL</th><th className="pr-3 text-right"></th></tr>
                </thead>
                <tbody className="divide-y divide-white/5">
                  {holdings.map(h => (
                    <tr key={h.symbol} className="hover:bg-white/[0.03]">
                      <td className="py-1.5 pl-3">
                        <div className="text-white font-semibold">{h.ticker}</div>
                        <div className="text-[10px] text-gray-400">{h.chains.join(', ')} · {h.lotCount} lot{h.lotCount === 1 ? '' : 's'}</div>
                      </td>
                      <td className="text-right font-mono text-gray-300">{h.qty.toFixed(h.qty < 1 ? 6 : 4)}</td>
                      <td className="text-right font-mono text-gray-400">${h.avgCostUsd.toFixed(2)}</td>
                      <td className="text-right font-mono text-white">{h.priceUsd !== null ? `$${h.priceUsd.toFixed(2)}` : '—'}</td>
                      <td className="text-right font-mono text-white">{h.marketValueUsd !== null ? `$${h.marketValueUsd.toLocaleString()}` : '—'}</td>
                      <td className={cn('text-right font-mono', h.unrealizedPnlUsd === null ? 'text-gray-400' : h.unrealizedPnlUsd >= 0 ? 'text-emerald-300' : 'text-rose-300')}>
                        {h.unrealizedPnlUsd !== null && h.unrealizedPnlPct !== null ? `${h.unrealizedPnlUsd >= 0 ? '+' : ''}${h.unrealizedPnlPct.toFixed(2)}%` : '—'}
                      </td>
                      <td className="pr-3 text-right">
                        <button onClick={() => setShowSell({ symbol: h.symbol, ticker: h.ticker })} className="px-1.5 py-0.5 text-[10px] rounded border border-white/15 text-rose-300 hover:bg-rose-500/10 inline-flex items-center gap-1">
                          <ArrowDownCircle className="w-3 h-3" />Sell
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>
        </div>

        {/* Chain allocation pie */}
        <div className="bg-[#0d1117] border border-blue-500/15 rounded-lg p-3">
          <div className="text-[10px] uppercase tracking-wider text-gray-400 mb-2">By chain</div>
          {chainData.length === 0 ? (
            <div className="py-10 text-center text-xs text-gray-400">No data yet.</div>
          ) : (
            <div className="h-56">
              <ResponsiveContainer width="100%" height="100%">
                <PieChart>
                  <Pie data={chainData} dataKey="value" nameKey="name" innerRadius={36} outerRadius={70} paddingAngle={1} stroke="#0d1117" strokeWidth={1.5}>
                    {chainData.map(d => <Cell key={d.name} fill={d.fill} />)}
                  </Pie>
                  <Tooltip contentStyle={{ background: '#0d1117', border: '1px solid #ffffff20', fontSize: 11 }} formatter={(v) => `$${Number(v).toLocaleString()}`} />
                </PieChart>
              </ResponsiveContainer>
            </div>
          )}
          <ul className="space-y-0.5 mt-2">
            {chainData.map(c => (
              <li key={c.name} className="flex items-center gap-2 text-[11px]">
                <span className="w-2 h-2 rounded-full" style={{ background: c.fill }} />
                <span className="capitalize text-gray-300 flex-1">{c.name}</span>
                <span className="font-mono text-white">${c.value.toLocaleString()}</span>
              </li>
            ))}
          </ul>
        </div>
      </div>
    </div>
  );
}

function Tile({ label, value, sub, tone = 'neutral', bold }: { label: string; value: string; sub?: string; tone?: 'positive' | 'negative' | 'amber' | 'neutral'; bold?: boolean }) {
  const colour = tone === 'positive' ? 'text-emerald-300' : tone === 'negative' ? 'text-rose-300' : tone === 'amber' ? 'text-amber-300' : 'text-white';
  return (
    <div className={cn('p-3 rounded-lg border bg-black/30', bold ? 'border-blue-500/30' : 'border-white/10')}>
      <div className="text-[10px] uppercase tracking-wider text-gray-400">{label}</div>
      <div className={cn('text-xl font-mono tabular-nums', colour, bold && 'text-2xl font-bold')}>{value}</div>
      {sub && <div className={cn('text-[10px] mt-0.5', tone === 'positive' ? 'text-emerald-400' : tone === 'negative' ? 'text-rose-400' : 'text-gray-400')}>{sub}</div>}
    </div>
  );
}

export default PortfolioPanel;
