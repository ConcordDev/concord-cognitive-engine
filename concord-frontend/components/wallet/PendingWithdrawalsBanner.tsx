'use client';

import { motion } from 'framer-motion';
import { Clock } from 'lucide-react';
import { cn } from '@/lib/utils';
import type { WithdrawalsPage } from './wallet-model';

export function PendingWithdrawalsBanner({
  withdrawalsData,
}: {
  withdrawalsData?: WithdrawalsPage;
}) {
  const allWithdrawals = withdrawalsData?.withdrawals || withdrawalsData?.items || [];
  const pending = allWithdrawals.filter((w) =>
    ['pending', 'approved', 'processing'].includes(w.status),
  );
  if (pending.length === 0) return null;
  const totalPending = pending.reduce((sum, w) => sum + w.amount, 0);

  return (
    <motion.div
      initial={{ opacity: 0, y: -10 }}
      animate={{ opacity: 1, y: 0 }}
      className="bg-amber-500/10 border border-amber-500/30 rounded-xl p-4"
    >
      <div className="flex items-start gap-3">
        <Clock className="w-5 h-5 text-amber-400 mt-0.5 flex-shrink-0" />
        <div className="flex-1 min-w-0">
          <p className="text-sm font-medium text-amber-300">
            {pending.length} pending withdrawal{pending.length !== 1 ? 's' : ''} (
            {totalPending.toLocaleString()} CC)
          </p>
          <div className="mt-2 space-y-1.5">
            {pending.map((w) => (
              <div key={w.id} className="flex items-center justify-between text-xs">
                <div className="flex items-center gap-2">
                  <span className="font-mono text-white">{w.amount.toLocaleString()} CC</span>
                  {w.fee > 0 && <span className="text-gray-400">(fee: {w.fee})</span>}
                </div>
                <div className="flex items-center gap-2">
                  <span
                    className={cn(
                      'px-1.5 py-0.5 rounded text-xs',
                      w.status === 'processing'
                        ? 'bg-blue-500/10 text-blue-400'
                        : w.status === 'approved'
                          ? 'bg-[var(--lens-accent)]/10 text-[var(--lens-accent)]'
                          : 'bg-amber-500/10 text-amber-400',
                    )}
                  >
                    {w.status}
                  </span>
                  <span className="text-gray-400">{new Date(w.created_at).toLocaleDateString()}</span>
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>
    </motion.div>
  );
}
