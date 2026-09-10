'use client';

import { useQuery } from '@tanstack/react-query';
import { apiHelpers } from '@/lib/api/client';
import { DollarSign, PieChart, BarChart3, TrendingUp } from 'lucide-react';
import { ds } from '@/lib/design-system';
import { Skeleton } from '@/components/ui/Skeleton';
import { EmptyState } from '@/components/ui/EmptyState';
import { ErrorState } from '@/components/ui/ErrorState';

interface TreasuryData {
  ok: boolean;
  totalBalance: number;
  reserve80: number;
  operating10: number;
  payroll10: number;
  platformBalance: number;
  revenueHistory: Array<{
    date: string;
    totalFees: number;
    reserves: number;
    operating: number;
    payroll: number;
    txCount: number;
  }>;
  feeCollectionRate: number;
  recentFees: number;
  priorFees: number;
  totalDistributed: number;
  distributionCount: number;
}

export function TreasuryPanel() {
  const { data, isLoading, isError, error, refetch } = useQuery({
    queryKey: ['admin-treasury'],
    queryFn: () =>
      apiHelpers.economy.adminTreasury().then((r) => r.data as TreasuryData),
    retry: false,
    refetchInterval: 30000,
  });

  if (isLoading) {
    return (
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        {Array.from({ length: 4 }).map((_, i) => (
          <Skeleton key={i} variant="block" height={96} />
        ))}
      </div>
    );
  }

  if (isError) {
    return (
      <ErrorState
        message={error instanceof Error ? error.message : 'Failed to load treasury'}
        onRetry={() => void refetch()}
      />
    );
  }

  if (!data?.ok) {
    return (
      <EmptyState
        title="Treasury unavailable"
        description="economy.adminTreasury did not return an ok payload for this session."
        compact
      />
    );
  }

  const totalSplit = data.reserve80 + data.operating10 + data.payroll10;
  const reservePct = totalSplit > 0 ? (data.reserve80 / totalSplit) * 100 : 80;
  const operatingPct = totalSplit > 0 ? (data.operating10 / totalSplit) * 100 : 10;
  const payrollPct = totalSplit > 0 ? (data.payroll10 / totalSplit) * 100 : 10;
  const maxFee = Math.max(...data.revenueHistory.map((d) => d.totalFees), 1);

  return (
    <div className="space-y-5">
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <div className={ds.panel}>
          <DollarSign className="w-4 h-4 text-green-400" />
          <p className="mt-3 text-xl font-mono tabular-nums text-white">
            ${data.totalBalance.toLocaleString()}
          </p>
          <p className="text-[11px] uppercase tracking-wider text-gray-500 mt-0.5">Total treasury</p>
        </div>
        <div className={ds.panel}>
          <PieChart className="w-4 h-4 text-[color:var(--lens-accent,#546E7A)]" />
          <p className="mt-3 text-xl font-mono tabular-nums text-white">
            ${data.totalDistributed.toLocaleString()}
          </p>
          <p className="text-[11px] uppercase tracking-wider text-gray-500 mt-0.5">Distributed</p>
          <p className="text-xs text-gray-400 mt-1">{data.distributionCount} distributions</p>
        </div>
        <div className={ds.panel}>
          <BarChart3 className="w-4 h-4" />
          <p className="mt-3 text-xl font-mono tabular-nums text-white">
            ${data.recentFees.toLocaleString()}
          </p>
          <p className="text-[11px] uppercase tracking-wider text-gray-500 mt-0.5">Fees (30d)</p>
          <p className={`text-xs mt-1 ${data.feeCollectionRate >= 0 ? 'text-green-400' : 'text-red-400'}`}>
            {data.feeCollectionRate >= 0 ? '+' : ''}
            {data.feeCollectionRate}% vs prior 30d
          </p>
        </div>
        <div className={ds.panel}>
          <DollarSign className="w-4 h-4" />
          <p className="mt-3 text-xl font-mono tabular-nums text-white">
            ${data.platformBalance.toLocaleString()}
          </p>
          <p className="text-[11px] uppercase tracking-wider text-gray-500 mt-0.5">Platform balance</p>
        </div>
      </div>

      <div className={ds.panel}>
        <h3 className="font-semibold mb-4 flex items-center gap-2 text-sm">
          <PieChart className="w-4 h-4" />
          Fee split (80/10/10)
        </h3>
        <div className="space-y-4">
          <SplitRow label="Reserves (80%)" amount={data.reserve80} pct={reservePct} />
          <SplitRow label="Operating (10%)" amount={data.operating10} pct={operatingPct} />
          <SplitRow label="Payroll (10%)" amount={data.payroll10} pct={payrollPct} />
        </div>
      </div>

      {data.revenueHistory.length > 0 && (
        <div className={ds.panel}>
          <h3 className="font-semibold mb-4 flex items-center gap-2 text-sm">
            <TrendingUp className="w-4 h-4" />
            Revenue over time
          </h3>
          <div className="flex items-end gap-1 h-40">
            {data.revenueHistory.slice(-30).map((day, i) => {
              const height = (day.totalFees / maxFee) * 100;
              return (
                <div key={day.date || i} className="flex-1 flex flex-col items-center gap-1 group relative">
                  <div
                    className="w-full bg-[color:var(--lens-accent,#546E7A)]/70 rounded-t hover:opacity-100 opacity-80 transition-opacity"
                    style={{ height: `${Math.max(height, 2)}%` }}
                  />
                  <div className="absolute bottom-full mb-2 hidden group-hover:block z-10 bg-lattice-surface border border-lattice-border rounded-lg p-2 text-xs whitespace-nowrap shadow-lg">
                    <p className="text-white font-medium">{day.date}</p>
                    <p className="font-mono">${day.totalFees.toFixed(2)}</p>
                    <p className="text-gray-400">{day.txCount} tx</p>
                  </div>
                </div>
              );
            })}
          </div>
          <div className="flex justify-between text-xs text-gray-500 mt-2 font-mono">
            <span>{data.revenueHistory[Math.max(0, data.revenueHistory.length - 30)]?.date || ''}</span>
            <span>{data.revenueHistory[data.revenueHistory.length - 1]?.date || ''}</span>
          </div>
        </div>
      )}
    </div>
  );
}

function SplitRow({ label, amount, pct }: { label: string; amount: number; pct: number }) {
  return (
    <div>
      <div className="flex justify-between text-sm mb-1">
        <span className="text-gray-400">{label}</span>
        <span className="text-white font-mono">
          ${amount.toLocaleString()} ({pct.toFixed(1)}%)
        </span>
      </div>
      <div className="h-1.5 rounded-full bg-white/5 overflow-hidden">
        <div
          className="h-full bg-[color:var(--lens-accent,#546E7A)]"
          style={{ width: `${pct}%` }}
        />
      </div>
    </div>
  );
}
