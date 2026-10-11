'use client';

import { useEffect, useMemo, useState } from 'react';
import { Eye, Plus, Trash2, Loader2, TrendingUp, TrendingDown } from 'lucide-react';
import { api } from '@/lib/api/client';
import { cn } from '@/lib/utils';

export interface Quote {
  symbol: string; name: string; price: number;
  pctChange1d: number; pctChange1y: number;
  volume: number; marketCap: number;
  pe?: number; eps?: number;
}

const STORAGE_KEY = 'concord:market:watchlist:v1';
function loadList(): string[] {
  if (typeof window === 'undefined') return ['AAPL', 'MSFT', 'GOOGL', 'NVDA'];
  try { return JSON.parse(window.localStorage.getItem(STORAGE_KEY) || '[]'); } catch { return []; }
}
function saveList(ids: string[]) {
  if (typeof window === 'undefined') return;
  try { window.localStorage.setItem(STORAGE_KEY, JSON.stringify(ids)); } catch { /* noop */ }
}

export function Watchlist() {
  const [symbols, setSymbols] = useState<string[]>([]);
  const [quotes, setQuotes] = useState<Quote[]>([]);
  const [loading, setLoading] = useState(true);
  const [unavailable, setUnavailable] = useState(false);
  const [newSym, setNewSym] = useState('');

  useEffect(() => {
    const initial = loadList();
    if (initial.length === 0) {
      const def = ['AAPL', 'MSFT', 'GOOGL', 'NVDA', 'TSLA'];
      saveList(def);
      setSymbols(def);
    } else {
      setSymbols(initial);
    }
  }, []);

  useEffect(() => {
    if (symbols.length === 0) { setQuotes([]); setUnavailable(false); setLoading(false); return; }
    setLoading(true);
    (async () => {
      try {
        const res = await api.post('/api/lens/run', { domain: 'market', action: 'quotes-batch', input: { symbols } });
        const payload = res.data as { ok?: boolean; error?: string; result?: { ok?: boolean; quotes?: Quote[]; error?: string } } | undefined;
        const failed = payload?.ok === false || payload?.result?.ok === false || !Array.isArray(payload?.result?.quotes);
        const rows = failed ? [] : (payload!.result!.quotes || []).filter((q) => q && q.price != null && !(q as Quote & { error?: string }).error);
        setQuotes(rows);
        setUnavailable(failed || rows.length === 0);
      } catch {
        setQuotes([]);
        setUnavailable(true);
      }
      finally { setLoading(false); }
    })();
  }, [symbols]);

  function add() {
    const s = newSym.trim().toUpperCase();
    if (!s || symbols.includes(s)) { setNewSym(''); return; }
    const next = [...symbols, s];
    setSymbols(next); saveList(next); setNewSym('');
  }

  function remove(s: string) {
    const next = symbols.filter(x => x !== s);
    setSymbols(next); saveList(next);
  }

  const sorted = useMemo(() => [...quotes].sort((a, b) => (b.marketCap || 0) - (a.marketCap || 0)), [quotes]);

  return (
    <div className="bg-[#0d1117] border border-cyan-500/20 rounded-lg overflow-hidden">
      <header className="px-4 py-2 border-b border-white/10 flex items-center gap-2">
        <Eye className="w-4 h-4 text-cyan-400" />
        <span className="text-xs uppercase font-semibold text-gray-300 tracking-wider">Watchlist</span>
        <span className="ml-auto text-[10px] text-gray-400">{quotes.length} symbols</span>
      </header>
      <div className="p-3 border-b border-white/10 flex items-center gap-2 text-xs">
        <input value={newSym} onChange={e => setNewSym(e.target.value)} onKeyDown={e => { if (e.key === 'Enter') add(); }} placeholder="Add symbol (e.g. AAPL)" className="flex-1 px-2 py-1.5 bg-lattice-deep border border-lattice-border rounded text-white uppercase" />
        <button onClick={add} className="inline-flex items-center gap-1 px-3 py-1.5 rounded bg-cyan-500 text-black font-bold hover:bg-cyan-400">
          <Plus className="w-3.5 h-3.5" /> Add
        </button>
      </div>
      <div className="max-h-96 overflow-y-auto">
        {loading ? (
          <div className="flex items-center justify-center py-6 text-xs text-gray-400"><Loader2 className="w-4 h-4 animate-spin mr-2" /> Loading quotes…</div>
        ) : unavailable ? (
          <div className="px-4 py-6 text-xs text-amber-300">quotes unavailable</div>
        ) : (
          <table className="w-full text-xs">
            <thead className="border-b border-white/10">
              <tr>
                <th className="px-3 py-1.5 text-left text-[10px] uppercase text-gray-400">Symbol</th>
                <th className="px-3 py-1.5 text-right text-[10px] uppercase text-gray-400">Price</th>
                <th className="px-3 py-1.5 text-right text-[10px] uppercase text-gray-400">1D</th>
                <th className="px-3 py-1.5 text-right text-[10px] uppercase text-gray-400">1Y</th>
                <th className="px-3 py-1.5 text-right text-[10px] uppercase text-gray-400">P/E</th>
                <th className="px-3 py-1.5 text-right text-[10px] uppercase text-gray-400">Mkt Cap</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {sorted.map(q => (
                <tr key={q.symbol} className="border-b border-white/5 hover:bg-white/[0.03] group">
                  <td className="px-3 py-1.5">
                    <div className="font-mono font-bold text-white">{q.symbol}</div>
                    <div className="text-[9px] text-gray-400 truncate">{q.name}</div>
                  </td>
                  <td className="px-3 py-1.5 text-right font-mono tabular-nums text-white">{q.price != null ? `$${q.price.toFixed(2)}` : '—'}</td>
                  <td className={cn('px-3 py-1.5 text-right font-mono tabular-nums', (q.pctChange1d ?? 0) >= 0 ? 'text-green-300' : 'text-red-300')}>
                    {q.pctChange1d == null ? '—' : (
                      <>
                        {q.pctChange1d >= 0 ? <TrendingUp className="w-3 h-3 inline" /> : <TrendingDown className="w-3 h-3 inline" />}
                        {q.pctChange1d.toFixed(2)}%
                      </>
                    )}
                  </td>
                  <td className={cn('px-3 py-1.5 text-right font-mono tabular-nums', (q.pctChange1y ?? 0) >= 0 ? 'text-green-300' : 'text-red-300')}>
                    {q.pctChange1y == null ? '—' : `${q.pctChange1y >= 0 ? '+' : ''}${q.pctChange1y.toFixed(1)}%`}
                  </td>
                  <td className="px-3 py-1.5 text-right text-gray-300 tabular-nums">{q.pe != null ? q.pe.toFixed(1) : '—'}</td>
                  <td className="px-3 py-1.5 text-right text-gray-300 tabular-nums">{q.marketCap != null ? `$${(q.marketCap / 1e9).toFixed(0)}B` : '—'}</td>
                  <td className="px-3 py-1.5 text-right">
                    <button aria-label="Delete" onClick={() => remove(q.symbol)} className="opacity-0 group-hover:opacity-100 p-1 text-gray-400 hover:text-red-400">
                      <Trash2 className="w-3.5 h-3.5" />
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}
export default Watchlist;
