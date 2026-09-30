'use client';

import { motion } from 'framer-motion';
import { ArrowDownRight, ArrowUpRight, X as XIcon } from 'lucide-react';
import { cn } from '@/lib/utils';
import type { WalletTransaction } from './wallet-model';

export function WalletTxDetail({
  tx,
  onClose,
}: {
  tx: WalletTransaction;
  onClose: () => void;
}) {
  return (
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/70 backdrop-blur-sm"
      onClick={onClose}
    >
      <motion.div
        initial={{ scale: 0.95, y: 12, opacity: 0 }}
        animate={{ scale: 1, y: 0, opacity: 1 }}
        exit={{ scale: 0.95, y: 12, opacity: 0 }}
        transition={{ duration: 0.15 }}
        className="w-full max-w-md bg-lattice-surface rounded-xl border border-lattice-border shadow-2xl overflow-hidden"
        onClick={(e) => e.stopPropagation()}
        role="dialog"
        aria-modal="true"
        aria-label="Transaction details"
      >
        <div className="flex items-center gap-2 px-4 py-3 border-b border-lattice-border">
          <div
            className={cn(
              'w-8 h-8 rounded-lg flex items-center justify-center',
              tx.amount >= 0 ? 'bg-[var(--lens-accent)]/15 text-[var(--lens-accent)]' : 'bg-red-500/15 text-red-400',
            )}
          >
            {tx.amount >= 0 ? <ArrowUpRight className="w-4 h-4" /> : <ArrowDownRight className="w-4 h-4" />}
          </div>
          <div className="flex-1 min-w-0">
            <div className="text-sm font-semibold text-white truncate">
              {tx.description || tx.type.replace(/_/g, ' ')}
            </div>
            <div className="text-[10px] text-gray-400 uppercase tracking-wider font-mono">{tx.type}</div>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="p-1 rounded hover:bg-lattice-elevated text-gray-400"
            aria-label="Close transaction details"
          >
            <XIcon className="w-4 h-4" />
          </button>
        </div>
        <div className="p-4 space-y-3">
          <div>
            <div className="text-[10px] uppercase tracking-wider text-gray-400 mb-1">Amount</div>
            <div
              className={cn(
                'text-3xl font-bold font-mono tabular-nums',
                tx.amount >= 0 ? 'text-[var(--lens-accent)]' : 'text-red-400',
              )}
            >
              {tx.amount >= 0 ? '+' : ''}
              {tx.amount.toLocaleString()} CC
            </div>
          </div>
          {tx.fee !== undefined && tx.fee > 0 && (
            <div className="grid grid-cols-2 gap-3 text-sm">
              <div>
                <div className="text-[10px] uppercase tracking-wider text-gray-400">Fee</div>
                <div className="text-amber-400 font-mono">{tx.fee.toLocaleString()} CC</div>
              </div>
              {tx.net !== undefined && (
                <div>
                  <div className="text-[10px] uppercase tracking-wider text-gray-400">Net</div>
                  <div className="text-white font-mono">{tx.net.toLocaleString()} CC</div>
                </div>
              )}
            </div>
          )}
          {(tx.from || tx.to) && (
            <div className="space-y-2 pt-2 border-t border-lattice-border">
              {tx.from && (
                <div>
                  <div className="text-[10px] uppercase tracking-wider text-gray-400 mb-0.5">From</div>
                  <div className="text-xs font-mono text-gray-300 break-all">{tx.from}</div>
                </div>
              )}
              {tx.to && (
                <div>
                  <div className="text-[10px] uppercase tracking-wider text-gray-400 mb-0.5">To</div>
                  <div className="text-xs font-mono text-gray-300 break-all">{tx.to}</div>
                </div>
              )}
            </div>
          )}
          {tx.status && (
            <div className="pt-2 border-t border-lattice-border">
              <div className="text-[10px] uppercase tracking-wider text-gray-400 mb-1">Status</div>
              <span
                className={cn(
                  'text-xs px-2 py-0.5 rounded',
                  tx.status === 'completed' || tx.status === 'complete'
                    ? 'bg-[var(--lens-accent)]/15 text-[var(--lens-accent)]'
                    : tx.status === 'pending'
                      ? 'bg-amber-500/15 text-amber-400'
                      : 'bg-gray-500/15 text-gray-400',
                )}
              >
                {tx.status}
              </span>
            </div>
          )}
          <div className="pt-2 border-t border-lattice-border space-y-2">
            <div>
              <div className="text-[10px] uppercase tracking-wider text-gray-400">Timestamp</div>
              <div className="text-xs text-gray-300">
                {new Date(tx.created_at || tx.timestamp || '').toLocaleString()}
              </div>
            </div>
            <div className="flex items-center gap-2">
              <div className="text-[10px] uppercase tracking-wider text-gray-400">ID</div>
              <code className="text-xs font-mono text-gray-400 truncate flex-1">{tx.id}</code>
              <button
                type="button"
                onClick={() => navigator.clipboard?.writeText(tx.id)}
                className="text-[10px] px-1.5 py-0.5 rounded border border-lattice-border text-gray-400 hover:text-white hover:bg-lattice-elevated"
              >
                Copy
              </button>
            </div>
          </div>
          {tx.metadata && Object.keys(tx.metadata).length > 0 && (
            <details className="pt-2 border-t border-lattice-border">
              <summary className="text-[10px] uppercase tracking-wider text-gray-400 cursor-pointer hover:text-gray-300">
                Metadata ({Object.keys(tx.metadata).length})
              </summary>
              <pre className="mt-2 text-[10px] text-gray-400 font-mono whitespace-pre-wrap break-words bg-lattice-deep p-2 rounded max-h-40 overflow-auto">
                {JSON.stringify(tx.metadata, null, 2)}
              </pre>
            </details>
          )}
        </div>
      </motion.div>
    </motion.div>
  );
}
