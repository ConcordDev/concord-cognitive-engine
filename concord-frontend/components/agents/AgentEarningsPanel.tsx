'use client';

/**
 * AgentEarningsPanel — surfaces royalty earnings for the current user's
 * published agents. Reads `agent.earnings` macro (which sums real
 * royalty_payouts rows; no synthetic numbers).
 *
 * Phase 13 (Stage C).
 */

import { useQuery } from '@tanstack/react-query';
import { TrendingUp, Coins, Loader2 } from 'lucide-react';
import { api } from '@/lib/api/client';

interface EarningsRow {
  dtuId: string;
  title: string;
  total: number;
  count: number;
}
interface EarningsResponse {
  ok: boolean;
  totalEarned?: number;
  byContent?: EarningsRow[];
  reason?: string;
}

async function fetchEarnings(): Promise<EarningsResponse | null> {
  try {
    const r = await api.post('/api/lens/run', {
      domain: 'agent', name: 'earnings', input: {},
    });
    return (r?.data ?? null) as EarningsResponse | null;
  } catch {
    return null;
  }
}

export interface AgentEarningsPanelProps {
  className?: string;
}

export function AgentEarningsPanel({ className }: AgentEarningsPanelProps) {
  const { data, isLoading } = useQuery<EarningsResponse | null>({
    queryKey: ['agent-earnings'],
    queryFn: fetchEarnings,
    staleTime: 60_000,
  });

  return (
    <div data-testid="agent-earnings-panel" className={className}>
      <div className="flex items-center justify-between mb-3">
        <h3 className="text-sm font-semibold text-emerald-200 inline-flex items-center gap-2">
          <TrendingUp className="w-4 h-4" />
          Agent earnings
        </h3>
        {data?.ok && (
          <span className="text-xs text-emerald-200 inline-flex items-center gap-1">
            <Coins className="w-3 h-3" />
            <span className="font-mono">{(data.totalEarned ?? 0).toFixed(2)}</span> CC
          </span>
        )}
      </div>

      {isLoading && (
        <div className="text-xs text-zinc-500 inline-flex items-center gap-1">
          <Loader2 className="w-3 h-3 animate-spin" /> Loading…
        </div>
      )}

      {!isLoading && !data?.ok && (
        <p className="text-xs text-zinc-500">
          {data?.reason === 'no_payouts_schema'
            ? 'royalty_payouts table not present in this deploy yet.'
            : 'No earnings data available.'}
        </p>
      )}

      {data?.ok && (data.byContent ?? []).length === 0 && (
        <p className="text-xs text-zinc-500">
          No payouts yet. Publish an agent and another user will earn you cascades when their agents cite yours.
        </p>
      )}

      {data?.ok && (data.byContent ?? []).length > 0 && (
        <ul className="space-y-1.5">
          {(data.byContent ?? []).map((row) => (
            <li key={row.dtuId} data-testid="earnings-row" className="flex items-center justify-between text-xs px-2 py-1.5 rounded bg-zinc-900/40 border border-zinc-800">
              <div className="flex-1 truncate">
                <span className="text-zinc-100">{row.title || '(untitled agent)'}</span>
                <span className="text-zinc-500 font-mono ml-2">{row.dtuId.slice(0, 24)}…</span>
              </div>
              <div className="font-mono text-emerald-200 ml-3">
                {row.total.toFixed(2)} CC <span className="text-zinc-500">· {row.count} payout(s)</span>
              </div>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

export default AgentEarningsPanel;
