'use client';

import { useQuery } from '@tanstack/react-query';
import { apiHelpers } from '@/lib/api/client';
import { Coins } from 'lucide-react';

function TokenBalance({ userId }: { userId?: string }) {
  const { data, isLoading } = useQuery({
    queryKey: ['economy-balance', userId],
    queryFn: () => apiHelpers.economy.balance(userId).then((r) => r.data),
    refetchInterval: 30000,
    retry: false,
  });

  const balance =
    (data as { balance?: number; tokens?: number })?.balance ??
    (data as { balance?: number; tokens?: number })?.tokens ??
    0;

  return (
    <div className="flex items-center gap-2 px-3 py-1.5 rounded-lg bg-lattice-deep border border-lattice-border">
      <Coins className="w-4 h-4 text-neon-green" />
      {isLoading ? (
        <span className="text-sm font-mono animate-pulse text-gray-400">...</span>
      ) : (
        <span className="text-sm font-mono text-neon-green font-medium">
          {balance.toLocaleString()}
        </span>
      )}
      <span className="text-xs text-gray-500">tokens</span>
    </div>
  );
}

import { withErrorBoundary } from '@/components/common/ErrorBoundary';
const _WrappedTokenBalance = withErrorBoundary(TokenBalance);
export { _WrappedTokenBalance as TokenBalance };
