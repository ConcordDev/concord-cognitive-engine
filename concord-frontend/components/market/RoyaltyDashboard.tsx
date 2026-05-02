'use client';

/**
 * RoyaltyDashboard — Shows royalty earnings, active streams,
 * and recent payments for a creator.
 */

import React from 'react';
import { useQuery } from '@tanstack/react-query';
import { api } from '@/lib/api/client';
import { DollarSign, TrendingUp, GitBranch, Clock } from 'lucide-react';

interface RoyaltyStream {
  id: string;
  originalTitle: string;
  citationType: string;
  derivativeCount: number;
  totalSales: number;
  totalRoyalties: number;
}

interface RoyaltyPayment {
  id: string;
  date: string;
  amount: number;
  derivativeTitle: string;
  citationType: string;
}

interface RoyaltyData {
  ok: boolean;
  totalEarned: number;
  thisMonth: number;
  streams: RoyaltyStream[];
  recentPayments: RoyaltyPayment[];
}

interface RoyaltyDashboardProps {
  userId: string;
}

const CitationBadge = React.memo(function CitationBadge({ type }: { type: string }) {
  const colors: Record<string, string> = {
    derivative: 'bg-red-500/20 text-red-400',
    adaptation: 'bg-orange-500/20 text-orange-400',
    reference: 'bg-blue-500/20 text-blue-400',
    extension: 'bg-purple-500/20 text-purple-400',
  };
  return (
    <span
      className={`text-xs px-1.5 py-0.5 rounded ${colors[type] || 'bg-gray-700 text-gray-400'}`}
    >
      {type}
    </span>
  );
});

function RoyaltyDashboard({ userId }: RoyaltyDashboardProps) {
  const { data: royalties, isLoading } = useQuery<RoyaltyData>({
    queryKey: ['royalties', userId],
    queryFn: async () => {
      const { data } = await api.get(`/api/marketplace/royalties/${userId}`);
      return data as RoyaltyData;
    },
    staleTime: 30_000,
    enabled: !!userId,
  });

  if (isLoading) {
    return (
      <div className="lens-card animate-pulse">
        <div className="h-6 bg-gray-700 rounded w-1/4 mb-4" />
        <div className="grid grid-cols-2 gap-3 mb-4">
          <div className="h-20 bg-gray-800 rounded" />
          <div className="h-20 bg-gray-800 rounded" />
        </div>
      </div>
    );
  }

  const earned = royalties?.totalEarned ?? 0;
  const monthly = royalties?.thisMonth ?? 0;

  return (
    <div className="lens-card">
      <h2 className="text-lg font-semibold text-white mb-4 flex items-center gap-2">
        <DollarSign className="w-5 h-5 text-neon-green" />
        Your Royalties
      </h2>

      {/* Summary cards */}
      <div className="grid grid-cols-2 gap-3 mb-5">
        <div className="p-3 rounded-lg bg-gray-800/50 border border-gray-700">
          <p className="text-xs text-gray-500 mb-1">Total earned</p>
          <p className="text-xl font-bold text-neon-green">${earned.toFixed(2)}</p>
        </div>
        <div className="p-3 rounded-lg bg-gray-800/50 border border-gray-700">
          <p className="text-xs text-gray-500 mb-1">This month</p>
          <p className="text-xl font-bold text-neon-cyan">${monthly.toFixed(2)}</p>
        </div>
      </div>

      {/* Active streams */}
      {royalties?.streams && royalties.streams.length > 0 && (
        <div className="mb-5">
          <h3 className="text-sm font-semibold text-white mb-2 flex items-center gap-1.5">
            <TrendingUp className="w-4 h-4 text-neon-cyan" />
            Active Royalty Streams
          </h3>
          <div className="space-y-2">
            {royalties.streams.map((stream) => (
              <div
                key={stream.id}
                className="flex items-center justify-between p-2 rounded bg-gray-800/30"
              >
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2">
                    <GitBranch className="w-3 h-3 text-gray-500 shrink-0" />
                    <span className="text-sm text-white truncate">{stream.originalTitle}</span>
                    <CitationBadge type={stream.citationType} />
                  </div>
                  <p className="text-xs text-gray-500 ml-5">{stream.totalSales} sales</p>
                </div>
                <span className="text-sm font-medium text-neon-green shrink-0 ml-2">
                  ${stream.totalRoyalties.toFixed(2)}
                </span>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Recent payments */}
      {royalties?.recentPayments && royalties.recentPayments.length > 0 && (
        <div>
          <h3 className="text-sm font-semibold text-white mb-2 flex items-center gap-1.5">
            <Clock className="w-4 h-4 text-gray-400" />
            Recent Payments
          </h3>
          <div className="space-y-1">
            {royalties.recentPayments.slice(0, 10).map((payment) => (
              <div
                key={payment.id}
                className="flex items-center justify-between text-xs py-1.5 border-b border-gray-800 last:border-0"
              >
                <div className="flex items-center gap-2 min-w-0">
                  <span className="text-gray-500 shrink-0">
                    {payment.date ? new Date(payment.date).toLocaleDateString() : '—'}
                  </span>
                  <span className="text-gray-300 truncate">
                    from &ldquo;{payment.derivativeTitle}&rdquo;
                  </span>
                  <CitationBadge type={payment.citationType} />
                </div>
                <span className="text-neon-green font-medium shrink-0 ml-2">
                  +${payment.amount.toFixed(2)}
                </span>
              </div>
            ))}
          </div>
        </div>
      )}

      {!royalties?.streams?.length && !royalties?.recentPayments?.length && (
        <p className="text-xs text-gray-500">
          No royalty earnings yet. Create content that others remix to start earning.
        </p>
      )}
    </div>
  );
}

import { withErrorBoundary } from '@/components/common/ErrorBoundary';
const _WrappedRoyaltyDashboard = withErrorBoundary(RoyaltyDashboard);
export { _WrappedRoyaltyDashboard as RoyaltyDashboard };
