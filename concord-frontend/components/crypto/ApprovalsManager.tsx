'use client';

import { useEffect, useState } from 'react';
import { ShieldCheck, Trash2, Loader2, ExternalLink, AlertTriangle } from 'lucide-react';
import { lensRun } from '@/lib/api/client';
import { cn } from '@/lib/utils';

export interface TokenAllowance {
  id: string;
  tokenSymbol: string;
  tokenAddress: string;
  spenderAddress: string;
  spenderLabel?: string;
  allowance: 'unlimited' | number;
  chain: string;
  approvedAt: string;
  riskLevel?: 'low' | 'moderate' | 'high';
  explorerUrl?: string;
}

interface ApprovalsManagerProps {
  walletAddress?: string;
}

export function ApprovalsManager({ walletAddress }: ApprovalsManagerProps) {
  const [allowances, setAllowances] = useState<TokenAllowance[]>([]);
  const [loading, setLoading] = useState(true);
  const [revoking, setRevoking] = useState<string | null>(null);
  const [filter, setFilter] = useState<'all' | 'risky' | 'unlimited'>('all');

  // eslint-disable-next-line react-hooks/exhaustive-deps -- refresh is a stable closure; only walletAddress should retrigger
  useEffect(() => { if (walletAddress) refresh(); }, [walletAddress]);

  async function refresh() {
    setLoading(true);
    try {
      const res = await lensRun({
        domain: 'crypto',
        action: 'token-allowances',
        input: { walletAddress },
      });
      setAllowances((res.data?.result?.allowances || []) as TokenAllowance[]);
    } catch (e) {
      console.error('[Approvals] list failed', e);
    } finally { setLoading(false); }
  }

  async function revoke(id: string) {
    setRevoking(id);
    try {
      await lensRun({
        domain: 'crypto',
        action: 'revoke-allowance',
        input: { id, walletAddress },
      });
      setAllowances(prev => prev.filter(a => a.id !== id));
    } catch (e) {
      console.error('[Approvals] revoke failed', e);
    } finally { setRevoking(null); }
  }

  const visible = allowances.filter(a => {
    if (filter === 'all') return true;
    if (filter === 'risky') return a.riskLevel === 'high' || a.allowance === 'unlimited';
    if (filter === 'unlimited') return a.allowance === 'unlimited';
    return true;
  });

  const riskyCount = allowances.filter(a => a.riskLevel === 'high').length;
  const unlimitedCount = allowances.filter(a => a.allowance === 'unlimited').length;

  return (
    <div className="flex flex-col bg-[#0d1117] border border-lattice-border rounded overflow-hidden">
      <header className="px-3 py-2 border-b border-white/10 flex items-center gap-2">
        <ShieldCheck className="w-4 h-4 text-cyan-400" />
        <span className="text-xs uppercase font-semibold text-gray-300 tracking-wider">Token approvals</span>
        <span className="ml-auto text-[10px] text-gray-500">{allowances.length}</span>
        <button
          onClick={refresh}
          title="Refresh"
          className="p-1 rounded text-gray-400 hover:text-white hover:bg-white/10"
        >
          <Loader2 className={cn('w-3.5 h-3.5', loading && 'animate-spin')} />
        </button>
      </header>
      {(riskyCount > 0 || unlimitedCount > 0) && (
        <div className="px-3 py-1.5 bg-yellow-500/10 border-b border-yellow-500/30 text-[11px] text-yellow-300 flex items-center gap-1.5">
          <AlertTriangle className="w-3.5 h-3.5" />
          {unlimitedCount} unlimited, {riskyCount} high-risk — revoke unused.
        </div>
      )}
      <div className="px-2 py-1.5 border-b border-white/5 flex items-center gap-1">
        {(['all', 'risky', 'unlimited'] as const).map(f => (
          <button
            key={f}
            onClick={() => setFilter(f)}
            className={cn('px-2 py-0.5 text-[10px] uppercase tracking-wider rounded', filter === f ? 'bg-cyan-500/20 text-cyan-300' : 'text-gray-500 hover:text-white')}
          >
            {f}
          </button>
        ))}
      </div>
      <div className="flex-1 overflow-y-auto">
        {loading ? (
          <div className="flex items-center justify-center py-6 text-xs text-gray-500">
            <Loader2 className="w-4 h-4 animate-spin mr-2" /> Scanning approvals…
          </div>
        ) : visible.length === 0 ? (
          <div className="px-3 py-10 text-xs text-gray-500 text-center">
            {allowances.length === 0 ? 'No approvals on record.' : `No approvals match "${filter}".`}
          </div>
        ) : (
          <ul className="text-xs divide-y divide-white/5">
            {visible.map(a => (
              <li key={a.id} className="px-3 py-2 hover:bg-white/[0.03]">
                <div className="flex items-center gap-2">
                  <span className="font-mono text-white">{a.tokenSymbol}</span>
                  <span className="text-gray-500">→</span>
                  <span className="text-cyan-300 truncate flex-1">{a.spenderLabel || abbreviate(a.spenderAddress)}</span>
                  <span className={cn(
                    'text-[10px] font-bold uppercase px-1.5 py-0.5 rounded',
                    a.allowance === 'unlimited' ? 'bg-red-500/20 text-red-300' :
                    a.riskLevel === 'high' ? 'bg-red-500/20 text-red-300' :
                    a.riskLevel === 'moderate' ? 'bg-yellow-500/20 text-yellow-300' :
                    'bg-green-500/20 text-green-300'
                  )}>
                    {a.allowance === 'unlimited' ? 'unlimited' : a.allowance.toLocaleString(undefined, { maximumFractionDigits: 4 })}
                  </span>
                </div>
                <div className="mt-1 flex items-center justify-between text-[10px] text-gray-500">
                  <span>{a.chain} · approved {new Date(a.approvedAt).toLocaleDateString()}</span>
                  <div className="flex items-center gap-2">
                    {a.explorerUrl && (
                      <a
                        href={a.explorerUrl}
                        target="_blank"
                        rel="noreferrer noopener"
                        className="text-gray-400 hover:text-cyan-300 inline-flex items-center gap-0.5"
                      >
                        Explorer <ExternalLink className="w-3 h-3" />
                      </a>
                    )}
                    <button
                      onClick={() => revoke(a.id)}
                      disabled={revoking === a.id}
                      className="inline-flex items-center gap-1 text-red-400 hover:text-red-300 disabled:opacity-50"
                    >
                      {revoking === a.id ? <Loader2 className="w-3 h-3 animate-spin" /> : <Trash2 className="w-3 h-3" />}
                      Revoke
                    </button>
                  </div>
                </div>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}

function abbreviate(addr: string): string {
  if (!addr || addr.length < 10) return addr;
  return `${addr.slice(0, 6)}…${addr.slice(-4)}`;
}

export default ApprovalsManager;
