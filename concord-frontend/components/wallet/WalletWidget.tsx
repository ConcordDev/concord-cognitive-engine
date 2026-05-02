'use client';

/**
 * WalletWidget -- Compact wallet display for the header/navbar.
 *
 * Shows:
 * - CC balance with coin icon
 * - Quick "Buy CC" button
 * - Links to full wallet page at /lenses/wallet
 *
 * Designed to sit in the topbar alongside other status indicators.
 */

import { useState } from 'react';
import Link from 'next/link';
import { useQuery } from '@tanstack/react-query';
import { motion, AnimatePresence } from 'framer-motion';
import { Coins, Plus, Wallet, ChevronDown } from 'lucide-react';
import { api } from '@/lib/api/client';
import { cn } from '@/lib/utils';
import { PurchaseFlow } from './PurchaseFlow';

// ── Types ────────────────────────────────────────────────────────────────────

interface WalletWidgetProps {
  /** Optional class for the root element */
  className?: string;
  /** Show compact variant (balance only, no dropdown) */
  compact?: boolean;
}

// ── Component ────────────────────────────────────────────────────────────────

function WalletWidget({ className, compact = false }: WalletWidgetProps) {
  const [dropdownOpen, setDropdownOpen] = useState(false);
  const [purchaseOpen, setPurchaseOpen] = useState(false);

  // Fetch balance
  const { data: balanceData, isLoading } = useQuery({
    queryKey: ['wallet-balance'],
    queryFn: () =>
      api
        .get('/api/economy/balance')
        .then(
          (r) =>
            r.data as {
              balance?: number;
              tokens?: number;
              totalCredits?: number;
              totalDebits?: number;
            }
        )
        .catch(() => null),
    refetchInterval: 30000,
    retry: false,
  });

  const balance = balanceData?.balance ?? balanceData?.tokens ?? 0;

  // ── Compact Mode ───────────────────────────────────────────────────────────

  if (compact) {
    return (
      <Link
        href="/lenses/wallet"
        className={cn(
          'flex items-center gap-1.5 px-3 py-1.5 rounded-lg',
          'bg-lattice-elevated border border-lattice-border text-sm',
          'hover:border-neon-green/30 transition-colors',
          className
        )}
      >
        <Coins className="w-3.5 h-3.5 text-neon-green" />
        {isLoading ? (
          <span className="text-zinc-400 animate-pulse font-mono">...</span>
        ) : (
          <span className="text-zinc-200 font-mono">{Number(balance).toLocaleString()}</span>
        )}
        <span className="text-zinc-500 text-xs">CC</span>
      </Link>
    );
  }

  // ── Full Widget ────────────────────────────────────────────────────────────

  return (
    <>
      <div className={cn('relative', className)}>
        {/* Balance Button */}
        <button
          onClick={() => setDropdownOpen(!dropdownOpen)}
          className={cn(
            'flex items-center gap-2 px-3 py-1.5 rounded-lg',
            'bg-lattice-elevated border border-lattice-border text-sm',
            'hover:border-neon-green/30 transition-colors',
            dropdownOpen && 'border-neon-green/30'
          )}
        >
          <Coins className="w-4 h-4 text-neon-green" />
          {isLoading ? (
            <span className="text-zinc-400 animate-pulse font-mono">...</span>
          ) : (
            <span className="text-zinc-200 font-mono font-medium">
              {Number(balance).toLocaleString()}
            </span>
          )}
          <span className="text-zinc-500 text-xs">CC</span>
          <ChevronDown
            className={cn(
              'w-3 h-3 text-gray-500 transition-transform',
              dropdownOpen && 'rotate-180'
            )}
          />
        </button>

        {/* Dropdown */}
        <AnimatePresence>
          {dropdownOpen && (
            <>
              {/* Backdrop to close */}
              <div
                className="fixed inset-0 z-40"
                onClick={() => setDropdownOpen(false)}
                aria-hidden="true"
              />
              <motion.div
                initial={{ opacity: 0, y: -8, scale: 0.95 }}
                animate={{ opacity: 1, y: 0, scale: 1 }}
                exit={{ opacity: 0, y: -8, scale: 0.95 }}
                transition={{ duration: 0.15 }}
                className="absolute right-0 top-full mt-2 z-50 w-64 bg-lattice-surface border border-lattice-border rounded-xl shadow-2xl overflow-hidden"
              >
                {/* Balance Display */}
                <div className="p-4 border-b border-lattice-border bg-lattice-deep">
                  <p className="text-xs text-gray-500 uppercase tracking-wide mb-1">Balance</p>
                  <div className="flex items-baseline gap-2">
                    <span className="text-2xl font-mono font-bold text-white">
                      {Number(balance).toLocaleString()}
                    </span>
                    <span className="text-sm text-gray-400">CC</span>
                  </div>
                  <p className="text-xs text-gray-500 mt-1">
                    = ${Number(balance).toLocaleString()}.00 USD
                  </p>
                </div>

                {/* Actions */}
                <div className="p-2 space-y-1">
                  <button
                    onClick={() => {
                      setDropdownOpen(false);
                      setPurchaseOpen(true);
                    }}
                    className="flex items-center gap-3 w-full px-3 py-2.5 rounded-lg text-sm text-gray-300 hover:bg-lattice-elevated hover:text-white transition-colors"
                  >
                    <Plus className="w-4 h-4 text-neon-green" />
                    Buy CC
                  </button>
                  <Link
                    href="/lenses/wallet"
                    onClick={() => setDropdownOpen(false)}
                    className="flex items-center gap-3 w-full px-3 py-2.5 rounded-lg text-sm text-gray-300 hover:bg-lattice-elevated hover:text-white transition-colors"
                  >
                    <Wallet className="w-4 h-4 text-neon-blue" />
                    Wallet & History
                  </Link>
                </div>
              </motion.div>
            </>
          )}
        </AnimatePresence>
      </div>

      {/* Purchase Flow Modal */}
      <AnimatePresence>
        {purchaseOpen && <PurchaseFlow mode="modal" onClose={() => setPurchaseOpen(false)} />}
      </AnimatePresence>
    </>
  );
}

import { withErrorBoundary } from '@/components/common/ErrorBoundary';
const _WrappedWalletWidget = withErrorBoundary(WalletWidget);
export { _WrappedWalletWidget as WalletWidget };
export default _WrappedWalletWidget;
