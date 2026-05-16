'use client';

import { useEffect, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Coins, Loader2, TrendingUp, Wallet, Percent } from 'lucide-react';
import { api, apiHelpers } from '@/lib/api/client';
import { SaveAsDtuButton } from '@/components/dtu/SaveAsDtuButton';

interface Balance { balance?: number; currency?: string; pendingHold?: number; [k: string]: unknown }
interface EconomyStatus { status?: string; totalSupply?: number; circulatingSupply?: number; [k: string]: unknown }
interface FeeSchedule { creatorShare?: number; royaltyShare?: number; platformFee?: number; treasuryShare?: number; [k: string]: unknown }
interface EconCurrent { period?: string; gmv?: number; royaltiesPaid?: number; tokensMinted?: number; activeBuyers?: number; [k: string]: unknown }

export function EconomyDashboard() {
  const [tick, setTick] = useState(0);
  useEffect(() => { const id = setInterval(() => setTick((t) => t + 1), 10000); return () => clearInterval(id); }, []);
  useEffect(() => { void tick; }, [tick]);

  const balance = useQuery({
    queryKey: ['economy-balance'],
    queryFn: async () => (await api.get('/api/economy/balance')).data as Balance,
    refetchInterval: 10000,
  });
  const status = useQuery({
    queryKey: ['economy-status'],
    queryFn: async () => (await api.get('/api/economy/status')).data as EconomyStatus,
    refetchInterval: 30000,
  });
  const fees = useQuery({
    queryKey: ['economy-fees'],
    queryFn: async () => (await api.get('/api/economy/fees')).data as FeeSchedule,
    staleTime: 5 * 60 * 1000,
  });
  const current = useQuery({
    queryKey: ['economics-current'],
    queryFn: async () => (await apiHelpers.economics.current(24)).data as EconCurrent,
    refetchInterval: 30000,
  });

  const b = balance.data || {};
  const s = status.data || {};
  const f = fees.data || {};
  const c = current.data || {};
  const fmtPct = (v?: number) => v != null ? `${(v * 100).toFixed(2)}%` : '—';

  return (
    <div className="space-y-4">
      <header className="flex items-center justify-between gap-3 border-b border-cyan-500/15 pb-3">
        <div className="flex items-center gap-2">
          <Coins className="h-5 w-5 text-cyan-400" />
          <h2 className="text-sm font-semibold text-white">Live economy</h2>
          <span className="rounded bg-zinc-800 px-1.5 py-0.5 font-mono text-[10px] uppercase tracking-wider text-zinc-400">/api/economy + /api/economics · 10-30s poll</span>
        </div>
        {balance.data && (
          <SaveAsDtuButton
            compact
            apiSource="concord-economy"
            title={`Economy snapshot — ${new Date().toISOString().slice(0, 10)}`}
            content={`Wallet:\n  Balance: ${b.balance ?? '—'} ${b.currency || 'CC'}\n  Pending hold: ${b.pendingHold ?? '—'}\n\nEconomy:\n  Status: ${s.status || '—'}\n  Total supply: ${s.totalSupply ?? '—'}\n  Circulating: ${s.circulatingSupply ?? '—'}\n\nFees:\n  Creator: ${fmtPct(f.creatorShare)}\n  Royalty: ${fmtPct(f.royaltyShare)}\n  Platform: ${fmtPct(f.platformFee)}\n  Treasury: ${fmtPct(f.treasuryShare)}\n\n24h Economics:\n  GMV: ${c.gmv ?? '—'}\n  Royalties paid: ${c.royaltiesPaid ?? '—'}\n  Tokens minted: ${c.tokensMinted ?? '—'}\n  Active buyers: ${c.activeBuyers ?? '—'}`}
            extraTags={['billing', 'economy', 'concord']}
            rawData={{ balance: b, status: s, fees: f, current: c }}
          />
        )}
      </header>
      {(balance.isError || status.isError) && <div className="rounded border border-red-500/20 bg-red-500/5 px-3 py-2 text-xs text-red-300">Economy backend unreachable.</div>}
      <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
        <Cell label="Balance" value={b.balance != null ? `${b.balance.toLocaleString()} ${b.currency || 'CC'}` : '—'} icon={Wallet} />
        <Cell label="Pending hold" value={b.pendingHold != null ? `${b.pendingHold.toLocaleString()}` : '—'} />
        <Cell label="24h GMV" value={c.gmv?.toLocaleString() || '—'} icon={TrendingUp} />
        <Cell label="Royalties paid" value={c.royaltiesPaid?.toLocaleString() || '—'} />
      </div>
      <div className="rounded-md border border-zinc-800 bg-zinc-950/40 p-3">
        <div className="mb-2 flex items-center gap-1 text-xs font-semibold text-zinc-200"><Percent className="h-3.5 w-3.5 text-cyan-400" /> Fee schedule (constitutional invariant)</div>
        <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
          <Cell label="Creator" value={fmtPct(f.creatorShare)} />
          <Cell label="Royalty" value={fmtPct(f.royaltyShare)} />
          <Cell label="Platform" value={fmtPct(f.platformFee)} />
          <Cell label="Treasury" value={fmtPct(f.treasuryShare)} />
        </div>
        <p className="mt-2 text-[10px] text-zinc-500">Marketplace fees are CLAUDE.md-frozen and cannot be modified without governance approval.</p>
      </div>
      <div className="rounded-md border border-zinc-800 bg-zinc-950/40 p-3">
        <div className="mb-2 text-xs font-semibold text-zinc-200">Supply</div>
        <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
          <Cell label="Status" value={s.status || '—'} />
          <Cell label="Total supply" value={s.totalSupply?.toLocaleString() || '—'} />
          <Cell label="Circulating" value={s.circulatingSupply?.toLocaleString() || '—'} />
        </div>
      </div>
      {(balance.isPending || status.isPending) && <div className="flex items-center gap-2 text-xs text-zinc-500"><Loader2 className="h-4 w-4 animate-spin" /> Polling…</div>}
    </div>
  );
}

function Cell({ label, value, icon: Icon }: { label: string; value: string; icon?: React.ComponentType<{ className?: string }> }) {
  return (
    <div className="rounded border border-zinc-800 bg-zinc-950 px-2.5 py-1.5">
      <div className="flex items-center gap-1 text-[10px] uppercase tracking-wider text-zinc-500">{Icon && <Icon className="h-3 w-3" />}{label}</div>
      <div className="mt-0.5 font-mono text-lg text-cyan-300">{value}</div>
    </div>
  );
}
