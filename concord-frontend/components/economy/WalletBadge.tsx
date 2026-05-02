'use client';

/**
 * WalletBadge — Shows user's token balance in the topbar.
 * Wired to GET /api/economy/balance.
 */

import Link from 'next/link';
import { useQuery } from '@tanstack/react-query';
import { api } from '@/lib/api/client';
import { DollarSign } from 'lucide-react';

function WalletBadge() {
  const { data: balance } = useQuery({
    queryKey: ['wallet-balance'],
    queryFn: () =>
      api
        .get('/api/economy/balance')
        .then((r) => r.data)
        .catch(() => null),
    refetchInterval: 30000,
    retry: false,
  });

  const tokenAmount = balance?.tokens ?? balance?.balance ?? 0;

  return (
    <Link
      href="/lenses/marketplace?tab=wallet"
      className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg
        bg-lattice-elevated border border-lattice-border text-sm
        hover:border-neon-green/30 transition-colors"
    >
      <DollarSign className="w-3.5 h-3.5 text-neon-green" />
      <span className="text-zinc-200">{Number(tokenAmount).toFixed(2)}</span>
    </Link>
  );
}

import { withErrorBoundary } from '@/components/common/ErrorBoundary';
const _WrappedWalletBadge = withErrorBoundary(WalletBadge);
export { _WrappedWalletBadge as WalletBadge };
export default _WrappedWalletBadge;
