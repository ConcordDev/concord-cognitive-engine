'use client';

import { useQuery } from '@tanstack/react-query';
import { apiHelpers } from '@/lib/api/client';
import { ArrowUpRight, ArrowDownRight, Repeat, Coins } from 'lucide-react';

interface Transaction {
  id?: string;
  type?: string;
  amount?: number;
  description?: string;
  from?: string;
  to?: string;
  status?: string;
  timestamp?: string;
  created_at?: string;
}

function TransactionHistory({ userId, limit = 20 }: { userId?: string; limit?: number }) {
  const { data, isLoading } = useQuery({
    queryKey: ['economy-history', userId, limit],
    queryFn: () => apiHelpers.economy.history({ user_id: userId, limit }).then((r) => r.data),
    refetchInterval: 60000,
    retry: false,
  });

  const transactions: Transaction[] =
    (data as { transactions?: Transaction[]; items?: Transaction[]; history?: Transaction[] })
      ?.transactions ||
    (data as { transactions?: Transaction[]; items?: Transaction[]; history?: Transaction[] })
      ?.items ||
    (data as { transactions?: Transaction[]; items?: Transaction[]; history?: Transaction[] })
      ?.history ||
    [];

  function getIcon(type?: string) {
    switch (type) {
      case 'earn':
      case 'credit':
      case 'reward':
        return <ArrowDownRight className="w-3.5 h-3.5 text-neon-green" />;
      case 'spend':
      case 'debit':
      case 'purchase':
        return <ArrowUpRight className="w-3.5 h-3.5 text-red-400" />;
      case 'transfer':
        return <Repeat className="w-3.5 h-3.5 text-neon-blue" />;
      default:
        return <Coins className="w-3.5 h-3.5 text-gray-400" />;
    }
  }

  if (isLoading) {
    return (
      <div className="space-y-2">
        {[1, 2, 3].map((i) => (
          <div key={i} className="h-10 bg-lattice-deep animate-pulse rounded-lg" />
        ))}
      </div>
    );
  }

  if (transactions.length === 0) {
    return (
      <div className="text-center py-6">
        <Coins className="w-6 h-6 mx-auto mb-2 text-gray-600" />
        <p className="text-xs text-gray-500">No transactions yet</p>
      </div>
    );
  }

  return (
    <div className="space-y-1">
      {transactions.map((tx, i) => (
        <div
          key={tx.id || i}
          className="flex items-center gap-2 px-2 py-2 rounded-lg hover:bg-lattice-deep/50 transition-colors"
        >
          <span className="flex-shrink-0">{getIcon(tx.type)}</span>
          <div className="min-w-0 flex-1">
            <p className="text-xs text-gray-300 truncate">
              {tx.description || tx.type || 'Transaction'}
            </p>
          </div>
          <span
            className={`text-xs font-mono ${(tx.amount || 0) >= 0 ? 'text-neon-green' : 'text-red-400'}`}
          >
            {(tx.amount || 0) >= 0 ? '+' : ''}
            {tx.amount}
          </span>
          <span className="text-[10px] text-gray-600 flex-shrink-0">
            {(tx.timestamp || tx.created_at) &&
              new Date(tx.timestamp || tx.created_at || '').toLocaleDateString(undefined, {
                month: 'short',
                day: 'numeric',
              })}
          </span>
        </div>
      ))}
    </div>
  );
}

import { withErrorBoundary } from '@/components/common/ErrorBoundary';
const _WrappedTransactionHistory = withErrorBoundary(TransactionHistory);
export { _WrappedTransactionHistory as TransactionHistory };
