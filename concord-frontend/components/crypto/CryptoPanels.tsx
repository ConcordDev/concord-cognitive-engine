'use client';

import { useEffect, useState } from 'react';
import { Loader2, Plus, Trash2, Pause, Play, Sparkles, Activity, Repeat, Coins, ImageIcon, Eye, Receipt, Zap } from 'lucide-react';
import { lensRun } from '@/lib/api/client';
import { cn } from '@/lib/utils';

const CHAINS = ['ethereum','solana','bitcoin','polygon','base','arbitrum','optimism','sui','avalanche'];

// ── Watchlist ─────────────────────────────────────────────────

interface Watch { symbol: string; ticker: string; priceUsd: number | null }

export function WatchlistPanel() {
  const [list, setList] = useState<Watch[]>([]);
  const [loading, setLoading] = useState(true);
  const [draft, setDraft] = useState('');

  useEffect(() => { refresh(); }, []);

  async function refresh() {
    setLoading(true);
    try {
      const r = await lensRun({ domain: 'crypto', action: 'watchlist-list', input: {} });
      setList((r.data?.result?.watchlist || []) as Watch[]);
    } catch (e) { console.error('[Watchlist] failed', e); }
    finally { setLoading(false); }
  }

  async function add() {
    if (!draft.trim()) return;
    try {
      await lensRun({ domain: 'crypto', action: 'watchlist-add', input: { symbol: draft.trim().toLowerCase() } });
      setDraft('');
      await refresh();
    } catch (e) { console.error('[Watchlist] add', e); }
  }

  async function remove(symbol: string) {
    try {
      await lensRun({ domain: 'crypto', action: 'watchlist-remove', input: { symbol } });
      await refresh();
    } catch (e) { console.error('[Watchlist] remove', e); }
  }

  return (
    <div className="bg-[#0d1117] border border-blue-500/15 rounded-lg overflow-hidden">
      <header className="px-4 py-2.5 border-b border-white/10 flex items-center gap-2">
        <Eye className="w-4 h-4 text-blue-400" />
        <span className="text-sm font-semibold text-gray-200">Watchlist</span>
        <span className="text-[10px] text-gray-400">{list.length}</span>
      </header>
      <form onSubmit={(e) => { e.preventDefault(); add(); }} className="p-3 border-b border-white/10 flex items-center gap-2">
        <input value={draft} onChange={e => setDraft(e.target.value)} placeholder="CoinGecko id (e.g. bitcoin, ethereum, solana)" className="flex-1 px-2 py-1.5 text-xs bg-lattice-deep border border-lattice-border rounded text-white font-mono" />
        <button type="submit" disabled={!draft.trim()} className="px-3 py-1.5 text-xs rounded bg-blue-500 text-white font-bold hover:bg-blue-400 disabled:opacity-40 inline-flex items-center gap-1"><Plus className="w-3 h-3" />Add</button>
      </form>
      {loading ? (
        <div className="flex items-center justify-center py-10 text-xs text-gray-400"><Loader2 className="w-4 h-4 animate-spin mr-2" /> Loading…</div>
      ) : list.length === 0 ? (
        <div className="px-3 py-10 text-center text-xs text-gray-400">No tokens watched yet.</div>
      ) : (
        <ul className="divide-y divide-white/5">
          {list.map(w => (
            <li key={w.symbol} className="px-4 py-2 hover:bg-white/[0.02] flex items-center gap-3 group">
              <span className="text-sm font-semibold text-white w-20">{w.ticker}</span>
              <span className="text-[11px] font-mono text-gray-400 flex-1">{w.symbol}</span>
              <span className="text-sm font-mono text-white w-24 text-right">{w.priceUsd !== null ? `$${w.priceUsd.toLocaleString()}` : '—'}</span>
              <button aria-label="Delete" onClick={() => remove(w.symbol)} className="opacity-0 group-hover:opacity-100 p-1 rounded hover:bg-rose-500/20 text-rose-300"><Trash2 className="w-3 h-3" /></button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

// ── Recurring Buys (DCA) ──────────────────────────────────────

interface Recurring { id: string; number: string; symbol: string; ticker: string; chain: string; amountUsd: number; cadence: 'daily' | 'weekly' | 'biweekly' | 'monthly'; startAt: string; nextRunAt: string; active: boolean; lastRunAt: string | null; runCount: number }

export function RecurringBuysPanel() {
  const [list, setList] = useState<Recurring[]>([]);
  const [loading, setLoading] = useState(true);
  const [showCreate, setShowCreate] = useState(false);
  const [draft, setDraft] = useState({ symbol: '', ticker: '', amountUsd: '', cadence: 'monthly' as Recurring['cadence'], chain: 'ethereum' });
  const [running, setRunning] = useState(false);

  useEffect(() => { refresh(); }, []);

  async function refresh() {
    setLoading(true);
    try {
      const r = await lensRun({ domain: 'crypto', action: 'recurring-buys-list', input: {} });
      setList((r.data?.result?.recurringBuys || []) as Recurring[]);
    } catch (e) { console.error('[DCA] failed', e); }
    finally { setLoading(false); }
  }

  async function create() {
    if (!draft.symbol.trim() || !draft.amountUsd) return;
    try {
      const r = await lensRun({ domain: 'crypto', action: 'recurring-buys-create', input: {
        symbol: draft.symbol.trim().toLowerCase(),
        ticker: draft.ticker.trim() || draft.symbol.trim().toUpperCase(),
        amountUsd: Number(draft.amountUsd),
        cadence: draft.cadence,
        chain: draft.chain,
      } });
      if (r.data?.ok === false) { alert(r.data?.error); return; }
      setDraft({ symbol: '', ticker: '', amountUsd: '', cadence: 'monthly', chain: 'ethereum' });
      setShowCreate(false);
      await refresh();
    } catch (e) { console.error('[DCA] create', e); }
  }

  async function toggle(id: string) {
    try { await lensRun({ domain: 'crypto', action: 'recurring-buys-toggle', input: { id } }); await refresh(); }
    catch (e) { console.error('[DCA] toggle', e); }
  }

  async function runDue() {
    setRunning(true);
    try {
      const r = await lensRun({ domain: 'crypto', action: 'recurring-buys-run-due', input: {} });
      const n = r.data?.result?.ran || 0;
      alert(`Ran ${n} DCA buy${n === 1 ? '' : 's'} at live CoinGecko prices.`);
      await refresh();
    } catch (e) { console.error('[DCA] run-due', e); }
    finally { setRunning(false); }
  }

  return (
    <div className="bg-[#0d1117] border border-blue-500/15 rounded-lg overflow-hidden">
      <header className="px-4 py-2.5 border-b border-white/10 flex items-center gap-2">
        <Repeat className="w-4 h-4 text-blue-400" />
        <span className="text-sm font-semibold text-gray-200">Recurring buys (DCA)</span>
        <span className="text-[10px] text-gray-400">{list.filter(r => r.active).length} active</span>
        <button onClick={runDue} disabled={running} className="ml-auto px-2.5 py-1 text-xs rounded border border-amber-500/30 text-amber-300 hover:bg-amber-500/10 disabled:opacity-40 inline-flex items-center gap-1">
          {running ? <Loader2 className="w-3 h-3 animate-spin" /> : <Zap className="w-3 h-3" />}Run due
        </button>
        <button onClick={() => setShowCreate(v => !v)} className="px-2.5 py-1 text-xs rounded bg-blue-500 text-white font-semibold hover:bg-blue-400 inline-flex items-center gap-1"><Plus className="w-3 h-3" />New</button>
      </header>
      {showCreate && (
        <div className="p-3 border-b border-white/10 grid grid-cols-12 gap-2">
          <input value={draft.symbol} onChange={e => setDraft({ ...draft, symbol: e.target.value, ticker: draft.ticker || e.target.value.toUpperCase() })} placeholder="CoinGecko id *" className="col-span-3 px-2 py-1.5 text-xs bg-lattice-deep border border-lattice-border rounded text-white font-mono" />
          <input value={draft.ticker} onChange={e => setDraft({ ...draft, ticker: e.target.value.toUpperCase() })} placeholder="Ticker" className="col-span-2 px-2 py-1.5 text-xs bg-lattice-deep border border-lattice-border rounded text-white font-mono" />
          <input type="number" step="0.01" value={draft.amountUsd} onChange={e => setDraft({ ...draft, amountUsd: e.target.value })} placeholder="$/buy *" className="col-span-2 px-2 py-1.5 text-xs bg-lattice-deep border border-lattice-border rounded text-white font-mono" />
          <select value={draft.cadence} onChange={e => setDraft({ ...draft, cadence: e.target.value as Recurring['cadence'] })} className="col-span-2 px-2 py-1.5 text-xs bg-lattice-deep border border-lattice-border rounded text-white">
            <option value="daily">Daily</option><option value="weekly">Weekly</option><option value="biweekly">Biweekly</option><option value="monthly">Monthly</option>
          </select>
          <select value={draft.chain} onChange={e => setDraft({ ...draft, chain: e.target.value })} className="col-span-3 px-2 py-1.5 text-xs bg-lattice-deep border border-lattice-border rounded text-white">
            {CHAINS.map(c => <option key={c} value={c}>{c}</option>)}
          </select>
          <button onClick={create} className="col-span-12 px-3 py-1.5 text-xs rounded bg-blue-500 text-white font-bold hover:bg-blue-400">Save DCA plan</button>
        </div>
      )}
      {loading ? <Loading /> : list.length === 0 ? <Empty label="No DCA plans set up. Run-due uses live CoinGecko prices to mint a lot at each cadence." /> : (
        <ul className="divide-y divide-white/5">
          {list.map(r => (
            <li key={r.id} className="px-4 py-2.5 hover:bg-white/[0.02] flex items-center gap-3">
              <button onClick={() => toggle(r.id)} className={cn('p-1 rounded', r.active ? 'text-emerald-300' : 'text-gray-400')}>{r.active ? <Pause className="w-4 h-4" /> : <Play className="w-4 h-4" />}</button>
              <span className="text-sm font-semibold text-white w-16">{r.ticker}</span>
              <div className="flex-1 min-w-0">
                <div className="text-xs text-white">${r.amountUsd.toFixed(2)} {r.cadence}</div>
                <div className="text-[10px] text-gray-400">Next: {r.nextRunAt} · {r.runCount} run(s){r.lastRunAt && ` · last ${r.lastRunAt}`}</div>
              </div>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

// ── Staking ───────────────────────────────────────────────────

interface StakingPos { id: string; number: string; symbol: string; ticker: string; chain: string; qty: number; validator: string; aprPct: number | null; stakedAt: string; unstakedAt: string | null; cumulativeRewardsUsd: number; active: boolean }

export function StakingPanel() {
  const [list, setList] = useState<StakingPos[]>([]);
  const [loading, setLoading] = useState(true);
  const [show, setShow] = useState(false);
  const [draft, setDraft] = useState({ symbol: 'solana', ticker: 'SOL', qty: '', validator: '', aprPct: '', chain: 'solana' });
  const [rewardFor, setRewardFor] = useState<{ id: string; ticker: string } | null>(null);
  const [rewardDraft, setRewardDraft] = useState({ rewardQty: '', rewardUsd: '' });

  useEffect(() => { refresh(); }, []);

  async function refresh() {
    setLoading(true);
    try {
      const r = await lensRun({ domain: 'crypto', action: 'staking-positions-list', input: {} });
      setList((r.data?.result?.positions || []) as StakingPos[]);
    } catch (e) { console.error('[Staking] failed', e); }
    finally { setLoading(false); }
  }

  async function stake() {
    if (!draft.symbol || !draft.qty) return;
    try {
      await lensRun({ domain: 'crypto', action: 'staking-stake', input: { ...draft, qty: Number(draft.qty), aprPct: Number(draft.aprPct) || undefined } });
      setDraft({ symbol: 'solana', ticker: 'SOL', qty: '', validator: '', aprPct: '', chain: 'solana' });
      setShow(false);
      await refresh();
    } catch (e) { console.error('[Staking] stake', e); }
  }

  async function unstake(id: string) {
    if (!confirm('Unstake this position?')) return;
    try { await lensRun({ domain: 'crypto', action: 'staking-unstake', input: { id } }); await refresh(); }
    catch (e) { console.error('[Staking] unstake', e); }
  }

  async function recordReward() {
    if (!rewardFor || !rewardDraft.rewardQty || !rewardDraft.rewardUsd) return;
    try {
      await lensRun({ domain: 'crypto', action: 'staking-rewards-record', input: { positionId: rewardFor.id, rewardQty: Number(rewardDraft.rewardQty), rewardUsd: Number(rewardDraft.rewardUsd) } });
      setRewardFor(null);
      setRewardDraft({ rewardQty: '', rewardUsd: '' });
      await refresh();
    } catch (e) { console.error('[Staking] reward', e); }
  }

  return (
    <div className="bg-[#0d1117] border border-blue-500/15 rounded-lg overflow-hidden">
      <header className="px-4 py-2.5 border-b border-white/10 flex items-center gap-2">
        <Coins className="w-4 h-4 text-blue-400" />
        <span className="text-sm font-semibold text-gray-200">Staking</span>
        <span className="text-[10px] text-gray-400">{list.filter(p => p.active).length} active</span>
        <button onClick={() => setShow(v => !v)} className="ml-auto px-2.5 py-1 text-xs rounded bg-blue-500 text-white font-semibold hover:bg-blue-400 inline-flex items-center gap-1"><Plus className="w-3 h-3" />Stake</button>
      </header>
      {show && (
        <div className="p-3 border-b border-white/10 grid grid-cols-12 gap-2">
          <input value={draft.symbol} onChange={e => setDraft({ ...draft, symbol: e.target.value.toLowerCase() })} placeholder="symbol" className="col-span-3 px-2 py-1.5 text-xs bg-lattice-deep border border-lattice-border rounded text-white font-mono" />
          <input value={draft.ticker} onChange={e => setDraft({ ...draft, ticker: e.target.value.toUpperCase() })} placeholder="ticker" className="col-span-2 px-2 py-1.5 text-xs bg-lattice-deep border border-lattice-border rounded text-white font-mono" />
          <input type="number" step="0.00000001" value={draft.qty} onChange={e => setDraft({ ...draft, qty: e.target.value })} placeholder="Qty *" className="col-span-3 px-2 py-1.5 text-xs bg-lattice-deep border border-lattice-border rounded text-white font-mono" />
          <input value={draft.validator} onChange={e => setDraft({ ...draft, validator: e.target.value })} placeholder="Validator" className="col-span-3 px-2 py-1.5 text-xs bg-lattice-deep border border-lattice-border rounded text-white" />
          <input type="number" step="0.1" value={draft.aprPct} onChange={e => setDraft({ ...draft, aprPct: e.target.value })} placeholder="APR %" className="col-span-1 px-2 py-1.5 text-xs bg-lattice-deep border border-lattice-border rounded text-white font-mono" />
          <button onClick={stake} className="col-span-12 px-3 py-1.5 text-xs rounded bg-blue-500 text-white font-bold hover:bg-blue-400">Stake</button>
        </div>
      )}
      {rewardFor && (
        <div className="p-3 border-b border-white/10 grid grid-cols-12 gap-2 bg-emerald-500/[0.04]">
          <div className="col-span-12 text-[11px] text-emerald-200">Record reward for {rewardFor.ticker}</div>
          <input type="number" step="0.00000001" value={rewardDraft.rewardQty} onChange={e => setRewardDraft({ ...rewardDraft, rewardQty: e.target.value })} placeholder="Reward qty" className="col-span-4 px-2 py-1.5 text-xs bg-lattice-deep border border-lattice-border rounded text-white font-mono" />
          <input type="number" step="0.01" value={rewardDraft.rewardUsd} onChange={e => setRewardDraft({ ...rewardDraft, rewardUsd: e.target.value })} placeholder="Reward USD" className="col-span-4 px-2 py-1.5 text-xs bg-lattice-deep border border-lattice-border rounded text-white font-mono" />
          <button onClick={recordReward} className="col-span-2 px-2 py-1.5 text-xs rounded bg-emerald-500 text-black font-bold hover:bg-emerald-400">Save</button>
          <button onClick={() => setRewardFor(null)} className="col-span-2 px-2 py-1.5 text-xs rounded text-gray-300 hover:bg-white/[0.05]">Cancel</button>
        </div>
      )}
      {loading ? <Loading /> : list.length === 0 ? <Empty label="No staking positions. SOL ~5-7% APR, ETH ~3-4% APR via Phantom 2026." /> : (
        <ul className="divide-y divide-white/5">
          {list.map(p => (
            <li key={p.id} className="px-4 py-2.5 hover:bg-white/[0.02] flex items-center gap-3">
              <span className={cn('text-[9px] uppercase px-1.5 py-0.5 rounded font-mono', p.active ? 'bg-emerald-500/20 text-emerald-300' : 'bg-gray-500/20 text-gray-400')}>{p.active ? 'staked' : 'unstaked'}</span>
              <span className="text-sm font-semibold text-white w-16">{p.ticker}</span>
              <div className="flex-1 min-w-0">
                <div className="text-xs text-white">{p.qty.toFixed(4)} on {p.chain}{p.aprPct !== null && ` · ~${p.aprPct}% APR`}</div>
                <div className="text-[10px] text-gray-400">{p.validator || 'no validator'} · since {p.stakedAt} · rewards $${p.cumulativeRewardsUsd.toFixed(2)}</div>
              </div>
              {p.active && (
                <>
                  <button onClick={() => setRewardFor({ id: p.id, ticker: p.ticker })} className="px-2 py-0.5 text-[10px] rounded border border-emerald-500/30 text-emerald-300 hover:bg-emerald-500/10">+ reward</button>
                  <button onClick={() => unstake(p.id)} className="px-2 py-0.5 text-[10px] rounded border border-rose-500/30 text-rose-300 hover:bg-rose-500/10">Unstake</button>
                </>
              )}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

// ── NFTs ──────────────────────────────────────────────────────

interface NFT { id: string; number: string; name: string; collection: string; chain: string; contractAddress: string; tokenId: string; imageUrl: string; acquiredAt: string; costBasisUsd: number; floorPriceUsd: number | null; notes: string }

export function NFTsPanel() {
  const [list, setList] = useState<NFT[]>([]);
  const [loading, setLoading] = useState(true);
  const [show, setShow] = useState(false);
  const [draft, setDraft] = useState({ name: '', collection: '', chain: 'ethereum', contractAddress: '', tokenId: '', imageUrl: '', costBasisUsd: '' });

  useEffect(() => { refresh(); }, []);

  async function refresh() {
    setLoading(true);
    try {
      const r = await lensRun({ domain: 'crypto', action: 'nfts-list', input: {} });
      setList((r.data?.result?.nfts || []) as NFT[]);
    } catch (e) { console.error('[NFT] failed', e); }
    finally { setLoading(false); }
  }

  async function add() {
    if (!draft.name.trim()) return;
    try {
      await lensRun({ domain: 'crypto', action: 'nfts-add', input: { ...draft, costBasisUsd: Number(draft.costBasisUsd) || 0 } });
      setDraft({ name: '', collection: '', chain: 'ethereum', contractAddress: '', tokenId: '', imageUrl: '', costBasisUsd: '' });
      setShow(false);
      await refresh();
    } catch (e) { console.error('[NFT] add', e); }
  }

  async function remove(id: string) {
    if (!confirm('Remove this NFT from your tracker?')) return;
    try { await lensRun({ domain: 'crypto', action: 'nfts-delete', input: { id } }); await refresh(); }
    catch (e) { console.error('[NFT] delete', e); }
  }

  return (
    <div className="bg-[#0d1117] border border-blue-500/15 rounded-lg overflow-hidden">
      <header className="px-4 py-2.5 border-b border-white/10 flex items-center gap-2">
        <ImageIcon className="w-4 h-4 text-blue-400" />
        <span className="text-sm font-semibold text-gray-200">NFTs</span>
        <span className="text-[10px] text-gray-400">{list.length}</span>
        <button onClick={() => setShow(v => !v)} className="ml-auto px-2.5 py-1 text-xs rounded bg-blue-500 text-white font-semibold hover:bg-blue-400 inline-flex items-center gap-1"><Plus className="w-3 h-3" />Add</button>
      </header>
      {show && (
        <div className="p-3 border-b border-white/10 grid grid-cols-12 gap-2">
          <input value={draft.name} onChange={e => setDraft({ ...draft, name: e.target.value })} placeholder="Name *" className="col-span-5 px-2 py-1.5 text-xs bg-lattice-deep border border-lattice-border rounded text-white" />
          <input value={draft.collection} onChange={e => setDraft({ ...draft, collection: e.target.value })} placeholder="Collection" className="col-span-4 px-2 py-1.5 text-xs bg-lattice-deep border border-lattice-border rounded text-white" />
          <select value={draft.chain} onChange={e => setDraft({ ...draft, chain: e.target.value })} className="col-span-3 px-2 py-1.5 text-xs bg-lattice-deep border border-lattice-border rounded text-white">{CHAINS.map(c => <option key={c} value={c}>{c}</option>)}</select>
          <input value={draft.contractAddress} onChange={e => setDraft({ ...draft, contractAddress: e.target.value })} placeholder="Contract 0x…" className="col-span-5 px-2 py-1.5 text-xs bg-lattice-deep border border-lattice-border rounded text-white font-mono" />
          <input value={draft.tokenId} onChange={e => setDraft({ ...draft, tokenId: e.target.value })} placeholder="Token ID" className="col-span-2 px-2 py-1.5 text-xs bg-lattice-deep border border-lattice-border rounded text-white font-mono" />
          <input type="number" step="0.01" value={draft.costBasisUsd} onChange={e => setDraft({ ...draft, costBasisUsd: e.target.value })} placeholder="Cost USD" className="col-span-2 px-2 py-1.5 text-xs bg-lattice-deep border border-lattice-border rounded text-white font-mono" />
          <input value={draft.imageUrl} onChange={e => setDraft({ ...draft, imageUrl: e.target.value })} placeholder="Image URL" className="col-span-3 px-2 py-1.5 text-xs bg-lattice-deep border border-lattice-border rounded text-white" />
          <button onClick={add} className="col-span-12 px-3 py-1.5 text-xs rounded bg-blue-500 text-white font-bold hover:bg-blue-400">Add NFT</button>
        </div>
      )}
      {loading ? <Loading /> : list.length === 0 ? <Empty label="No NFTs tracked. Add real NFTs you own with contract + token ID." /> : (
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 p-3">
          {list.map(n => (
            <div key={n.id} className="rounded border border-white/10 bg-black/30 overflow-hidden group">
              <div className="aspect-square bg-black/40 overflow-hidden">
                {/* eslint-disable-next-line @next/next/no-img-element -- NFT art served from arbitrary external/IPFS hosts; next/image allowlist is impractical */}
                {n.imageUrl ? <img src={n.imageUrl} alt="" className="w-full h-full object-cover" /> : <div className="w-full h-full flex items-center justify-center"><ImageIcon className="w-8 h-8 text-gray-700" /></div>}
              </div>
              <div className="p-2">
                <div className="text-xs text-white truncate">{n.name}</div>
                <div className="text-[10px] text-gray-400 truncate">{n.collection || n.chain}</div>
                <div className="text-[10px] text-gray-400 font-mono">{n.tokenId ? `#${n.tokenId}` : ''}{n.costBasisUsd > 0 && ` · $${n.costBasisUsd.toFixed(0)} cost`}</div>
                <button onClick={() => remove(n.id)} className="mt-1 opacity-0 group-hover:opacity-100 px-1.5 py-0.5 text-[10px] rounded text-rose-300 hover:bg-rose-500/20">Remove</button>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

// ── Activity (transactions log) ─────────────────────────────

interface Tx { id: string; number: string; kind: string; symbol: string; ticker: string; chain: string; qty: number; priceUsd: number; totalUsd: number; at: string; realizedPnlUsd?: number; notes?: string }

const KIND_COLOUR: Record<string, string> = {
  buy: 'bg-emerald-500/20 text-emerald-300',
  sell: 'bg-rose-500/20 text-rose-300',
  receive: 'bg-cyan-500/20 text-cyan-300',
  send: 'bg-amber-500/20 text-amber-300',
  swap: 'bg-violet-500/20 text-violet-300',
  stake: 'bg-blue-500/20 text-blue-300',
  unstake: 'bg-gray-500/20 text-gray-300',
  reward: 'bg-emerald-500/20 text-emerald-300',
  fee: 'bg-gray-500/20 text-gray-400',
};

export function ActivityPanel() {
  const [list, setList] = useState<Tx[]>([]);
  const [loading, setLoading] = useState(true);
  const [kind, setKind] = useState<string>('all');

  // eslint-disable-next-line react-hooks/exhaustive-deps -- refresh is a stable closure; only kind should retrigger
  useEffect(() => { refresh(); }, [kind]);

  async function refresh() {
    setLoading(true);
    try {
      const r = await lensRun({ domain: 'crypto', action: 'transactions-list', input: kind === 'all' ? { limit: 200 } : { kind, limit: 200 } });
      setList((r.data?.result?.transactions || []) as Tx[]);
    } catch (e) { console.error('[Activity] failed', e); }
    finally { setLoading(false); }
  }

  return (
    <div className="bg-[#0d1117] border border-blue-500/15 rounded-lg overflow-hidden">
      <header className="px-4 py-2.5 border-b border-white/10 flex items-center gap-2">
        <Activity className="w-4 h-4 text-blue-400" />
        <span className="text-sm font-semibold text-gray-200">Activity</span>
        <span className="text-[10px] text-gray-400">{list.length}</span>
        <select value={kind} onChange={e => setKind(e.target.value)} className="ml-2 text-[10px] px-1.5 py-0.5 bg-lattice-deep border border-lattice-border rounded text-white">
          <option value="all">All</option>
          {['buy','sell','receive','send','swap','stake','unstake','reward','fee'].map(k => <option key={k} value={k}>{k}</option>)}
        </select>
      </header>
      {loading ? <Loading /> : list.length === 0 ? <Empty label="No activity yet." /> : (
        <ul className="divide-y divide-white/5 max-h-[36rem] overflow-y-auto">
          {list.map(t => (
            <li key={t.id} className="px-4 py-2 hover:bg-white/[0.02] flex items-center gap-3">
              <span className={cn('text-[9px] uppercase px-1.5 py-0.5 rounded font-mono', KIND_COLOUR[t.kind] || 'bg-white/5 text-gray-400')}>{t.kind}</span>
              <span className="text-xs font-mono text-gray-400 w-20">{t.at}</span>
              <div className="flex-1 min-w-0">
                <div className="text-xs text-white"><span className="font-semibold">{t.ticker}</span> · {t.qty.toFixed(6)} on {t.chain}</div>
                {t.notes && <div className="text-[10px] text-gray-400 truncate">{t.notes}</div>}
              </div>
              <div className="text-sm font-mono text-white w-24 text-right">{t.totalUsd > 0 ? `$${t.totalUsd.toFixed(2)}` : '—'}</div>
              {t.realizedPnlUsd !== undefined && (
                <div className={cn('text-[10px] font-mono w-20 text-right', t.realizedPnlUsd >= 0 ? 'text-emerald-300' : 'text-rose-300')}>
                  {t.realizedPnlUsd >= 0 ? '+' : ''}${t.realizedPnlUsd.toFixed(2)}
                </div>
              )}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

// ── Tax report ────────────────────────────────────────────────

interface TaxReport {
  year: number;
  realizedShortTerm: Array<{ ticker: string; qty: number; acquiredAt: string; soldAt: string; heldDays: number; costUsd: number; proceedsUsd: number; gainUsd: number }>;
  realizedLongTerm: Array<{ ticker: string; qty: number; acquiredAt: string; soldAt: string; heldDays: number; costUsd: number; proceedsUsd: number; gainUsd: number }>;
  shortTermGainUsd: number; longTermGainUsd: number; totalRealizedUsd: number;
  stakingIncomeUsd: number; stakingRewardEvents: number;
  form: string;
}

export function TaxPanel() {
  const [year, setYear] = useState(new Date().getFullYear());
  const [report, setReport] = useState<TaxReport | null>(null);
  const [loading, setLoading] = useState(true);

  // eslint-disable-next-line react-hooks/exhaustive-deps -- refresh is a stable closure; only year should retrigger
  useEffect(() => { refresh(); }, [year]);

  async function refresh() {
    setLoading(true);
    try {
      const r = await lensRun({ domain: 'crypto', action: 'tax-report', input: { year } });
      setReport((r.data?.result as TaxReport) || null);
    } catch (e) { console.error('[Tax] failed', e); }
    finally { setLoading(false); }
  }

  function downloadCsv() {
    if (!report) return;
    const rows = [
      ['Type', 'Symbol', 'Qty', 'Acquired', 'Sold', 'Held days', 'Cost USD', 'Proceeds USD', 'Gain USD'],
      ...report.realizedShortTerm.map(r => ['short-term', r.ticker, r.qty, r.acquiredAt, r.soldAt, r.heldDays, r.costUsd, r.proceedsUsd, r.gainUsd]),
      ...report.realizedLongTerm.map(r => ['long-term', r.ticker, r.qty, r.acquiredAt, r.soldAt, r.heldDays, r.costUsd, r.proceedsUsd, r.gainUsd]),
    ];
    const csv = rows.map(r => r.join(',')).join('\n');
    const blob = new Blob([csv], { type: 'text/csv' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `crypto-tax-${report.year}.csv`;
    a.click();
  }

  const years = Array.from({ length: 5 }, (_, i) => new Date().getFullYear() - i);

  return (
    <div className="bg-[#0d1117] border border-blue-500/15 rounded-lg overflow-hidden">
      <header className="px-4 py-2.5 border-b border-white/10 flex items-center gap-2">
        <Receipt className="w-4 h-4 text-blue-400" />
        <span className="text-sm font-semibold text-gray-200">Tax report</span>
        {report && <span className="text-[10px] text-gray-400">{report.form}</span>}
        <select value={year} onChange={e => setYear(Number(e.target.value))} className="ml-auto text-[10px] px-1.5 py-0.5 bg-lattice-deep border border-lattice-border rounded text-white font-mono">
          {years.map(y => <option key={y} value={y}>{y}</option>)}
        </select>
        {report && <button onClick={downloadCsv} className="px-2 py-1 text-xs rounded border border-white/15 text-gray-300 hover:bg-white/[0.05]">Download CSV</button>}
      </header>
      {loading ? <Loading /> : !report ? <Empty label="No data." /> : (
        <div className="p-4 space-y-3">
          <div className="grid grid-cols-4 gap-2">
            <Tile label="Short-term" value={`$${report.shortTermGainUsd.toLocaleString()}`} sub={`${report.realizedShortTerm.length} sale(s)`} tone={report.shortTermGainUsd >= 0 ? 'positive' : 'negative'} />
            <Tile label="Long-term" value={`$${report.longTermGainUsd.toLocaleString()}`} sub={`${report.realizedLongTerm.length} sale(s)`} tone={report.longTermGainUsd >= 0 ? 'positive' : 'negative'} />
            <Tile label="Total realized" value={`$${report.totalRealizedUsd.toLocaleString()}`} bold tone={report.totalRealizedUsd >= 0 ? 'positive' : 'negative'} />
            <Tile label="Staking income" value={`$${report.stakingIncomeUsd.toLocaleString()}`} sub={`${report.stakingRewardEvents} event(s)`} tone="amber" />
          </div>
          {(report.realizedShortTerm.length + report.realizedLongTerm.length) > 0 && (
            <div className="rounded border border-white/10 bg-black/30 overflow-hidden">
              <table className="w-full text-xs">
                <thead className="text-[10px] uppercase text-gray-400 border-b border-white/5">
                  <tr><th scope="col" className="text-left py-1.5 pl-3">Term</th><th scope="col">Symbol</th><th scope="col" className="text-right">Qty</th><th scope="col" className="text-right">Held days</th><th scope="col" className="text-right">Cost</th><th scope="col" className="text-right">Proceeds</th><th scope="col" className="text-right pr-3">Gain</th></tr>
                </thead>
                <tbody className="divide-y divide-white/5">
                  {[...report.realizedLongTerm.map(r => ({ ...r, term: 'long' })), ...report.realizedShortTerm.map(r => ({ ...r, term: 'short' }))].sort((a, b) => b.soldAt.localeCompare(a.soldAt)).map((r, i) => (
                    <tr key={i}>
                      <td className="py-1.5 pl-3"><span className={cn('text-[9px] uppercase px-1.5 py-0.5 rounded font-mono', r.term === 'long' ? 'bg-emerald-500/20 text-emerald-300' : 'bg-amber-500/20 text-amber-300')}>{r.term}</span></td>
                      <td className="text-white">{r.ticker}</td>
                      <td className="text-right font-mono text-gray-400">{r.qty.toFixed(6)}</td>
                      <td className="text-right font-mono text-gray-400">{r.heldDays}</td>
                      <td className="text-right font-mono text-white">${r.costUsd.toFixed(2)}</td>
                      <td className="text-right font-mono text-white">${r.proceedsUsd.toFixed(2)}</td>
                      <td className={cn('text-right font-mono pr-3', r.gainUsd >= 0 ? 'text-emerald-300' : 'text-rose-300')}>{r.gainUsd >= 0 ? '+' : ''}${r.gainUsd.toFixed(2)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
          <div className="text-[10px] text-gray-400 italic">NOT tax advice. Cost basis is FIFO. Reconcile with a tax professional before filing.</div>
        </div>
      )}
    </div>
  );
}

// ── AI Insight ────────────────────────────────────────────────

interface Insight { insight: string; source: string; stats?: { totalValueUsd: number; totalCostUsd: number; concentrationPct: number } }

export function InsightsPanel() {
  const [data, setData] = useState<Insight | null>(null);
  const [loading, setLoading] = useState(false);

  async function run() {
    setLoading(true);
    setData(null);
    try {
      const r = await lensRun({ domain: 'crypto', action: 'ai-portfolio-insight', input: {} });
      setData((r.data?.result as Insight) || null);
    } catch (e) { console.error('[Insight] failed', e); }
    finally { setLoading(false); }
  }

  return (
    <div className="bg-[#0d1117] border border-blue-500/15 rounded-lg overflow-hidden">
      <header className="px-4 py-2.5 border-b border-white/10 flex items-center gap-2">
        <Sparkles className="w-4 h-4 text-blue-400" />
        <span className="text-sm font-semibold text-gray-200">AI portfolio insight</span>
        <button onClick={run} disabled={loading} className="ml-auto px-2.5 py-1 text-xs rounded bg-blue-500 text-white font-bold hover:bg-blue-400 disabled:opacity-40 inline-flex items-center gap-1">
          {loading ? <Loader2 className="w-3 h-3 animate-spin" /> : <Sparkles className="w-3 h-3" />}Analyze
        </button>
      </header>
      <div className="p-4">
        {!data ? (
          <div className="text-xs text-gray-400">Click Analyze to get a deterministic + optional brain-enhanced read on your portfolio: concentration risk, biggest winner/loser, factual observations. NOT financial advice.</div>
        ) : (
          <>
            <div className="rounded border border-blue-500/30 bg-blue-500/[0.04] p-3 text-sm text-blue-100">{data.insight}</div>
            <div className="mt-2 text-[10px] text-gray-400">source: {data.source}{data.stats && ` · concentration ${data.stats.concentrationPct.toFixed(1)}%`}</div>
            <div className="mt-2 text-[10px] text-gray-400 italic">NOT financial advice.</div>
          </>
        )}
      </div>
    </div>
  );
}

// ── Helpers ───────────────────────────────────────────────────

function Loading() { return <div className="flex items-center justify-center py-10 text-xs text-gray-400"><Loader2 className="w-4 h-4 animate-spin mr-2" />Loading…</div>; }
function Empty({ label }: { label: string }) { return <div className="px-3 py-10 text-center text-xs text-gray-400">{label}</div>; }
function Tile({ label, value, sub, tone = 'neutral', bold }: { label: string; value: string; sub?: string; tone?: 'positive' | 'negative' | 'amber' | 'neutral'; bold?: boolean }) {
  const colour = tone === 'positive' ? 'text-emerald-300' : tone === 'negative' ? 'text-rose-300' : tone === 'amber' ? 'text-amber-300' : 'text-white';
  return (
    <div className={cn('p-3 rounded border bg-black/30', bold ? 'border-blue-500/30' : 'border-white/10')}>
      <div className="text-[10px] uppercase tracking-wider text-gray-400">{label}</div>
      <div className={cn('text-lg font-mono tabular-nums', colour, bold && 'text-xl font-bold')}>{value}</div>
      {sub && <div className="text-[10px] text-gray-400 mt-0.5">{sub}</div>}
    </div>
  );
}
