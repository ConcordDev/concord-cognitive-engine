'use client';

import { useState, useEffect, useCallback } from 'react';
import {
  X, Loader2, TrendingUp, Activity, DollarSign, BarChart3, BellRing, Plus, Trash2, AlertTriangle,
} from 'lucide-react';
import { api } from '@/lib/api/client';
import { cn } from '@/lib/utils';

export interface OptionsRow {
  strike: number;
  call: { mark: number; delta: number; theta: number; rho: number };
  put:  { mark: number; delta: number; theta: number; rho: number };
  gamma: number;
  vega: number;
}

export interface FuturesContract {
  symbol: string;
  frontContract: string;
  name: string;
  last: number;
  change: number;
  changePercent: number;
  tickSize: number;
  tickValue: number;
  multiplier: number;
  initialMargin: number;
}

export interface ForexQuote {
  pair: string;
  name: string;
  bid: number;
  ask: number;
  spread: number;
  spreadPips: number;
  pipValue: number;
}

export interface DepthLevel { price: number; size: number; }

export interface Alert {
  id: string;
  symbol: string;
  condition: string;
  threshold: number;
  status: 'active' | 'cancelled' | 'triggered';
  createdAt: string;
}

interface Props {
  open: boolean;
  onClose: () => void;
}

type Tab = 'options' | 'futures' | 'forex' | 'depth' | 'alerts';

export function MarketsWorkbench({ open, onClose }: Props) {
  const [tab, setTab] = useState<Tab>('options');

  if (!open) return null;

  return (
    <div className="fixed inset-y-0 right-0 w-[680px] max-w-[100vw] z-40 bg-[#0d1117] border-l border-cyan-500/20 shadow-2xl overflow-hidden flex flex-col">
      <header className="px-4 py-3 border-b border-white/10 flex items-center justify-between bg-gradient-to-r from-cyan-950/40 to-transparent">
        <div className="flex items-center gap-2">
          <Activity className="w-4 h-4 text-cyan-400" />
          <span className="text-sm font-semibold text-gray-200">Markets Workbench</span>
          <span className="text-[10px] text-gray-400">derivatives + global markets</span>
        </div>
        <button type="button" onClick={onClose}
          className="p-1 rounded-md hover:bg-white/5 text-gray-400" aria-label="Close">
          <X className="w-4 h-4" />
        </button>
      </header>

      <nav className="px-3 py-2 border-b border-white/10 flex items-center gap-1 overflow-x-auto">
        {([
          { id: 'options', label: 'Options',  icon: TrendingUp },
          { id: 'futures', label: 'Futures',  icon: BarChart3 },
          { id: 'forex',   label: 'FX',       icon: DollarSign },
          { id: 'depth',   label: 'Depth',    icon: Activity },
          { id: 'alerts',  label: 'Alerts',   icon: BellRing },
        ] as const).map((t) => {
          const Icon = t.icon;
          const active = tab === t.id;
          return (
            <button key={t.id} type="button" onClick={() => setTab(t.id)}
              className={cn(
                'inline-flex items-center gap-1.5 px-2.5 py-1 text-xs rounded transition flex-shrink-0',
                active
                  ? 'bg-cyan-500/15 text-cyan-200 border border-cyan-500/40'
                  : 'text-gray-400 hover:text-gray-200 border border-transparent',
              )}>
              <Icon className="w-3 h-3" /> {t.label}
            </button>
          );
        })}
      </nav>

      <div className="flex-1 overflow-y-auto">
        {tab === 'options' && <OptionsTab />}
        {tab === 'futures' && <FuturesTab />}
        {tab === 'forex' && <ForexTab />}
        {tab === 'depth' && <DepthTab />}
        {tab === 'alerts' && <AlertsTab />}
      </div>
    </div>
  );
}

function OptionsTab() {
  const [symbol, setSymbol] = useState('SPY');
  const [spot, setSpot] = useState('450');
  const [iv, setIv] = useState('0.18');
  const [dte, setDte] = useState('30');
  const [chain, setChain] = useState<OptionsRow[]>([]);
  const [loading, setLoading] = useState(false);

  const load = async () => {
    setLoading(true);
    try {
      const r = await api.post('/api/lens/run', {
        domain: 'markets', action: 'options-chain',
        input: { symbol, spot: Number(spot), iv: Number(iv), daysToExpiry: Number(dte) },
      });
      setChain(((r.data as { result?: { chain?: OptionsRow[] } }).result?.chain) || []);
    } catch (e) { console.error(e); }
    finally { setLoading(false); }
  };

  useEffect(() => { load(); }, []);  // eslint-disable-line react-hooks/exhaustive-deps

  return (
    <div className="p-3 space-y-3">
      <div className="grid grid-cols-4 gap-2">
        <input type="text" value={symbol} onChange={(e) => setSymbol(e.target.value.toUpperCase())}
          placeholder="Symbol" className="px-2 py-1.5 text-xs bg-black/40 border border-white/10 rounded text-gray-100 font-mono" />
        <input type="number" value={spot} onChange={(e) => setSpot(e.target.value)}
          placeholder="Spot" className="px-2 py-1.5 text-xs bg-black/40 border border-white/10 rounded text-gray-100 font-mono" />
        <input type="number" step="0.01" value={iv} onChange={(e) => setIv(e.target.value)}
          placeholder="IV" className="px-2 py-1.5 text-xs bg-black/40 border border-white/10 rounded text-gray-100 font-mono" />
        <input type="number" value={dte} onChange={(e) => setDte(e.target.value)}
          placeholder="DTE" className="px-2 py-1.5 text-xs bg-black/40 border border-white/10 rounded text-gray-100 font-mono" />
      </div>
      <button type="button" onClick={load} disabled={loading}
        className="px-3 py-1 rounded-md border border-cyan-500/40 bg-cyan-500/15 text-xs text-cyan-100 disabled:opacity-40">
        {loading ? <Loader2 className="w-3 h-3 animate-spin" /> : 'Compute chain (BSM)'}
      </button>

      {chain.length > 0 && (
        <div className="border border-white/10 rounded overflow-x-auto">
          <table className="w-full text-[11px] font-mono">
            <thead className="bg-black/40 text-gray-400 uppercase">
              <tr>
                <th className="text-right px-2 py-1 text-emerald-400">Call Δ</th>
                <th className="text-right px-2 py-1 text-emerald-400">Call</th>
                <th className="text-center px-2 py-1">Strike</th>
                <th className="text-right px-2 py-1 text-rose-400">Put</th>
                <th className="text-right px-2 py-1 text-rose-400">Put Δ</th>
                <th className="text-right px-2 py-1">Γ</th>
                <th className="text-right px-2 py-1">ν</th>
              </tr>
            </thead>
            <tbody>
              {chain.map((row) => (
                <tr key={row.strike} className="border-t border-white/5">
                  <td className="text-right px-2 py-1 text-emerald-300">{row.call.delta}</td>
                  <td className="text-right px-2 py-1 text-emerald-300">{row.call.mark}</td>
                  <td className="text-center px-2 py-1 text-gray-100">{row.strike}</td>
                  <td className="text-right px-2 py-1 text-rose-300">{row.put.mark}</td>
                  <td className="text-right px-2 py-1 text-rose-300">{row.put.delta}</td>
                  <td className="text-right px-2 py-1 text-gray-400">{row.gamma}</td>
                  <td className="text-right px-2 py-1 text-gray-400">{row.vega}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      <p className="text-[10px] text-gray-400">Greeks via Black-Scholes (Abramowitz-Stegun normCdf). IV is required input.</p>
    </div>
  );
}

function FuturesTab() {
  const [contracts, setContracts] = useState<FuturesContract[]>([]);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const r = await api.post('/api/lens/run', { domain: 'markets', action: 'futures-board', input: {} });
      setContracts(((r.data as { result?: { contracts?: FuturesContract[] } }).result?.contracts) || []);
    } catch (e) { console.error(e); }
    finally { setLoading(false); }
  }, []);

  useEffect(() => { load(); }, [load]);

  if (loading) return <div className="flex items-center justify-center py-8 text-xs text-gray-400"><Loader2 className="w-4 h-4 animate-spin mr-2" />Loading…</div>;

  return (
    <div className="p-3">
      <p className="text-[10px] text-gray-400 mb-2">CME continuous front-month via Yahoo Finance (live, server-side fetch, no key). 15-minute delay during market hours per Yahoo&apos;s ToS.</p>
      <div className="border border-white/10 rounded overflow-x-auto">
        <table className="w-full text-xs">
          <thead className="bg-black/40 text-gray-400 uppercase text-[10px]">
            <tr>
              <th className="text-left px-2 py-1">Symbol</th>
              <th className="text-left px-2 py-1">Contract</th>
              <th className="text-left px-2 py-1">Name</th>
              <th className="text-right px-2 py-1">Last</th>
              <th className="text-right px-2 py-1">Change</th>
              <th className="text-right px-2 py-1">Margin</th>
            </tr>
          </thead>
          <tbody>
            {contracts.map((c) => (
              <tr key={c.symbol} className="border-t border-white/5">
                <td className="px-2 py-1 font-mono text-cyan-300">{c.symbol}</td>
                <td className="px-2 py-1 font-mono text-gray-400">{c.frontContract}</td>
                <td className="px-2 py-1 text-gray-200">{c.name}</td>
                <td className="px-2 py-1 text-right font-mono text-gray-100">{c.last}</td>
                <td className={cn('px-2 py-1 text-right font-mono', c.change >= 0 ? 'text-emerald-300' : 'text-rose-300')}>
                  {c.change >= 0 ? '+' : ''}{c.change} ({c.changePercent}%)
                </td>
                <td className="px-2 py-1 text-right font-mono text-gray-400">${c.initialMargin.toLocaleString()}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function ForexTab() {
  const [quotes, setQuotes] = useState<ForexQuote[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    (async () => {
      try {
        const r = await api.post('/api/lens/run', { domain: 'markets', action: 'forex-quotes', input: {} });
        setQuotes(((r.data as { result?: { quotes?: ForexQuote[] } }).result?.quotes) || []);
      } catch (e) { console.error(e); }
      finally { setLoading(false); }
    })();
  }, []);

  if (loading) return <div className="flex items-center justify-center py-8 text-xs text-gray-400"><Loader2 className="w-4 h-4 animate-spin mr-2" />Loading…</div>;

  return (
    <div className="p-3">
      <div className="border border-white/10 rounded overflow-hidden">
        <table className="w-full text-xs">
          <thead className="bg-black/40 text-gray-400 uppercase text-[10px]">
            <tr><th className="text-left px-2 py-1">Pair</th><th className="text-right px-2 py-1">Bid</th><th className="text-right px-2 py-1">Ask</th><th className="text-right px-2 py-1">Spread</th><th className="text-right px-2 py-1">Pip value</th></tr>
          </thead>
          <tbody>
            {quotes.map((q) => (
              <tr key={q.pair} className="border-t border-white/5">
                <td className="px-2 py-1 font-mono text-cyan-300">{q.pair}<p className="text-[9px] text-gray-400 font-sans">{q.name}</p></td>
                <td className="px-2 py-1 text-right font-mono text-gray-100">{q.bid}</td>
                <td className="px-2 py-1 text-right font-mono text-gray-100">{q.ask}</td>
                <td className="px-2 py-1 text-right text-gray-400">{q.spreadPips}p</td>
                <td className="px-2 py-1 text-right font-mono text-gray-400">${q.pipValue}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function DepthTab() {
  const [symbol, setSymbol] = useState('SPY');
  const [last, setLast] = useState('450');
  const [book, setBook] = useState<{ bids: DepthLevel[]; asks: DepthLevel[]; spread: number } | null>(null);

  const load = async () => {
    try {
      const r = await api.post('/api/lens/run', {
        domain: 'markets', action: 'depth-of-book',
        input: { symbol, last: Number(last) },
      });
      setBook(((r.data as { result?: typeof book }).result) || null);
    } catch (e) { console.error(e); }
  };

  useEffect(() => { load(); }, []);  // eslint-disable-line react-hooks/exhaustive-deps

  return (
    <div className="p-3 space-y-3">
      <div className="flex gap-2">
        <input type="text" value={symbol} onChange={(e) => setSymbol(e.target.value.toUpperCase())}
          className="flex-1 px-2 py-1.5 text-xs bg-black/40 border border-white/10 rounded text-gray-100 font-mono" />
        <input type="number" value={last} onChange={(e) => setLast(e.target.value)}
          placeholder="Last" className="w-24 px-2 py-1.5 text-xs bg-black/40 border border-white/10 rounded text-gray-100 font-mono" />
        <button type="button" onClick={load}
          className="px-3 py-1 rounded-md border border-cyan-500/40 bg-cyan-500/15 text-xs text-cyan-100">Load</button>
      </div>
      <p className="text-[10px] text-amber-300"><AlertTriangle className="w-3 h-3 inline mr-1" />Real inside quote only (Yahoo Finance — single level). Full L2 depth requires a licensed feed (IEX TOPS, NASDAQ TotalView, or Polygon L2).</p>

      {book && (
        <div className="grid grid-cols-2 gap-2">
          <div className="border border-emerald-500/20 rounded overflow-hidden">
            <p className="px-2 py-1 text-[10px] uppercase text-emerald-400 bg-emerald-500/10">Bids</p>
            {book.bids.map((b, i) => (
              <div key={i} className="flex justify-between px-2 py-1 text-[11px] font-mono border-t border-white/5">
                <span className="text-emerald-300">{b.price}</span>
                <span className="text-gray-400">{b.size}</span>
              </div>
            ))}
          </div>
          <div className="border border-rose-500/20 rounded overflow-hidden">
            <p className="px-2 py-1 text-[10px] uppercase text-rose-400 bg-rose-500/10">Asks</p>
            {book.asks.map((a, i) => (
              <div key={i} className="flex justify-between px-2 py-1 text-[11px] font-mono border-t border-white/5">
                <span className="text-rose-300">{a.price}</span>
                <span className="text-gray-400">{a.size}</span>
              </div>
            ))}
          </div>
        </div>
      )}

      {book && (
        <p className="text-center text-[11px] text-gray-400">Spread: <span className="font-mono text-gray-300">{book.spread}</span></p>
      )}
    </div>
  );
}

function AlertsTab() {
  const [alerts, setAlerts] = useState<Alert[]>([]);
  const [loading, setLoading] = useState(true);
  const [creating, setCreating] = useState(false);
  const [draft, setDraft] = useState({ symbol: 'SPY', condition: 'price_above', threshold: 460 });

  const refresh = useCallback(async () => {
    setLoading(true);
    try {
      const r = await api.post('/api/lens/run', { domain: 'markets', action: 'alerts-list', input: {} });
      setAlerts(((r.data as { result?: { alerts?: Alert[] } }).result?.alerts) || []);
    } catch (e) { console.error(e); }
    finally { setLoading(false); }
  }, []);

  useEffect(() => { refresh(); }, [refresh]);

  const save = async () => {
    try {
      await api.post('/api/lens/run', { domain: 'markets', action: 'alert-create', input: draft });
      setCreating(false);
      await refresh();
    } catch (e) { console.error(e); }
  };

  const cancel = async (id: string) => {
    try {
      await api.post('/api/lens/run', { domain: 'markets', action: 'alert-cancel', input: { id } });
      await refresh();
    } catch (e) { console.error(e); }
  };

  return (
    <div className="p-3 space-y-2">
      <button type="button" onClick={() => setCreating((v) => !v)}
        className="inline-flex items-center gap-1 px-2.5 py-1 rounded-md border border-cyan-500/30 bg-cyan-500/10 text-xs text-cyan-200">
        <Plus className="w-3 h-3" /> New alert
      </button>

      {creating && (
        <div className="rounded border border-cyan-500/30 bg-cyan-500/5 p-3 space-y-2">
          <div className="grid grid-cols-3 gap-2">
            <input type="text" value={draft.symbol}
              onChange={(e) => setDraft({ ...draft, symbol: e.target.value.toUpperCase() })}
              placeholder="Symbol"
              className="px-2 py-1.5 text-xs bg-black/40 border border-white/10 rounded text-gray-100 font-mono" />
            <select value={draft.condition} onChange={(e) => setDraft({ ...draft, condition: e.target.value })}
              className="px-2 py-1.5 text-xs bg-black/40 border border-white/10 rounded text-gray-100">
              <option value="price_above">Price &gt;</option>
              <option value="price_below">Price &lt;</option>
              <option value="iv_above">IV &gt;</option>
              <option value="iv_below">IV &lt;</option>
            </select>
            <input type="number" value={draft.threshold}
              onChange={(e) => setDraft({ ...draft, threshold: Number(e.target.value) })}
              placeholder="Threshold"
              className="px-2 py-1.5 text-xs bg-black/40 border border-white/10 rounded text-gray-100 font-mono" />
          </div>
          <button type="button" onClick={save}
            className="px-3 py-1 rounded-md border border-cyan-500/40 bg-cyan-500/15 text-xs text-cyan-100">Save</button>
        </div>
      )}

      {loading ? <div className="text-center py-8 text-xs text-gray-400"><Loader2 className="w-4 h-4 animate-spin inline mr-2" />Loading…</div> :
        alerts.length === 0 ? <p className="text-center text-xs text-gray-400 py-8">No alerts.</p> :
        alerts.map((a) => (
          <div key={a.id} className="rounded border border-white/10 bg-black/20 p-3 group">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm font-mono text-gray-100">{a.symbol} {a.condition.replace('_', ' ')} <span className="text-cyan-300">{a.threshold}</span></p>
                <p className="text-[10px] text-gray-400">{a.status} · {new Date(a.createdAt).toLocaleString()}</p>
              </div>
              {a.status === 'active' && (
                <button aria-label="Delete" type="button" onClick={() => cancel(a.id)}
                  className="p-1 text-gray-600 hover:text-rose-300 opacity-0 group-hover:opacity-100"><Trash2 className="w-3 h-3" /></button>
              )}
            </div>
          </div>
        ))
      }
    </div>
  );
}

export default MarketsWorkbench;
