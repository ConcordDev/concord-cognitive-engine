/* eslint-disable @typescript-eslint/no-explicit-any */
'use client';

import { useCallback, useEffect, useState } from 'react';
import { lensRun } from '@/lib/api/client';
import {
  Wallet, Lock, Coins, Swords, ShieldCheck, Users, Loader2,
} from 'lucide-react';

interface Wallet { balance: number; escrowed: number }
interface LedgerEntry { ts: string; type: string; amount: number; questId?: string }
interface Stats {
  totalQuests: number;
  openCount: number;
  inProgress: number;
  resolved: number;
  totalClaims: number;
  verifiedClaims: number;
  pendingVerification: number;
  totalEscrowed: number;
  totalPaidOut: number;
  guildCount: number;
  adventurerCount: number;
  recentLedger: LedgerEntry[];
}

export function MarketHeader({ refreshKey }: { refreshKey?: number }) {
  const [wallet, setWallet] = useState<Wallet | null>(null);
  const [stats, setStats] = useState<Stats | null>(null);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    const [w, s] = await Promise.all([
      lensRun<any>('questmarket', 'walletGet', {}),
      lensRun<any>('questmarket', 'marketStats', {}),
    ]);
    if (w.data?.ok && w.data.result) setWallet(w.data.result);
    if (s.data?.ok && s.data.result) setStats(s.data.result);
    if (!w.data?.ok && !s.data?.ok) setErr('failed to load market state');
    else setErr(null);
    setLoading(false);
  }, []);

  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => { load(); }, [refreshKey]);

  if (loading) {
    return (
      <div className="flex items-center gap-2 rounded-lg border border-zinc-800 bg-zinc-950/60 p-4 text-xs text-zinc-400">
        <Loader2 className="h-4 w-4 animate-spin" /> Loading market…
      </div>
    );
  }
  if (err) {
    return (
      <div className="rounded border border-red-500/30 bg-red-500/5 px-3 py-2 text-xs text-red-300">
        {err}
      </div>
    );
  }

  return (
    <div className="space-y-3">
      {wallet && (
        <div className="flex flex-wrap items-center gap-4 rounded-lg border border-amber-500/25 bg-amber-500/5 p-3">
          <div className="flex items-center gap-2">
            <Wallet className="h-5 w-5 text-amber-400" />
            <div>
              <p className="text-[10px] uppercase tracking-wider text-zinc-400">Available CC</p>
              <p className="text-lg font-bold text-amber-300">{wallet.balance.toLocaleString()}</p>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <Lock className="h-5 w-5 text-sky-400" />
            <div>
              <p className="text-[10px] uppercase tracking-wider text-zinc-400">In Escrow</p>
              <p className="text-lg font-bold text-sky-300">{wallet.escrowed.toLocaleString()}</p>
            </div>
          </div>
        </div>
      )}

      {stats && (
        <>
          <div className="grid grid-cols-2 gap-2 sm:grid-cols-4 lg:grid-cols-6">
            <Stat icon={<Swords className="h-4 w-4 text-fuchsia-400" />}
              label="Total" value={stats.totalQuests} />
            <Stat icon={<Coins className="h-4 w-4 text-emerald-400" />}
              label="Open" value={stats.openCount} />
            <Stat icon={<ShieldCheck className="h-4 w-4 text-amber-400" />}
              label="To Verify" value={stats.pendingVerification} />
            <Stat icon={<Coins className="h-4 w-4 text-sky-400" />}
              label="Escrowed" value={stats.totalEscrowed} />
            <Stat icon={<Coins className="h-4 w-4 text-emerald-400" />}
              label="Paid Out" value={stats.totalPaidOut} />
            <Stat icon={<Users className="h-4 w-4 text-zinc-400" />}
              label="Guilds" value={stats.guildCount} />
          </div>

          {stats.recentLedger.length > 0 && (
            <div className="rounded-lg border border-zinc-800 bg-zinc-950/60 p-3">
              <p className="mb-1.5 text-[10px] uppercase tracking-wider text-zinc-400">
                Recent escrow ledger
              </p>
              <div className="space-y-1">
                {stats.recentLedger.slice(0, 6).map((e, i) => (
                  <div key={i} className="flex items-center justify-between text-[11px]">
                    <span className={
                      e.type === 'payout' ? 'text-emerald-300'
                        : e.type === 'escrow_refund' ? 'text-sky-300'
                          : 'text-zinc-400'}>
                      {e.type.replace('_', ' ')}
                    </span>
                    <span className="flex items-center gap-2">
                      <span className="font-mono text-amber-300">{e.amount} CC</span>
                      <span className="text-zinc-600">{new Date(e.ts).toLocaleTimeString()}</span>
                    </span>
                  </div>
                ))}
              </div>
            </div>
          )}
        </>
      )}
    </div>
  );
}

function Stat({ icon, label, value }: { icon: React.ReactNode; label: string; value: number }) {
  return (
    <div className="rounded-lg border border-zinc-800 bg-zinc-950/60 p-2.5">
      <div className="mb-1">{icon}</div>
      <p className="text-[9px] uppercase tracking-wider text-zinc-400">{label}</p>
      <p className="text-base font-bold text-white">{value.toLocaleString()}</p>
    </div>
  );
}
