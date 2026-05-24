'use client';

/**
 * PurchaseFlow -- Modal/inline component for buying CC tokens.
 *
 * Features:
 * - Preset amount buttons (10, 50, 100, 500, 1000 CC)
 * - Custom amount input with validation
 * - USD price display (1:1 peg)
 * - Redirect to Stripe Checkout
 * - Handles success/cancel query params on return
 */

import { useState, useEffect, useCallback } from 'react';
import { useSearchParams } from 'next/navigation';
import { motion, AnimatePresence } from 'framer-motion';
import {
  CreditCard,
  Coins,
  CheckCircle2,
  XCircle,
  Loader2,
  DollarSign,
  Sparkles,
} from 'lucide-react';
import { api } from '@/lib/api/client';
import { cn } from '@/lib/utils';
import { ds } from '@/lib/design-system';

// ── Constants ────────────────────────────────────────────────────────────────

const PRESET_AMOUNTS = [10, 50, 100, 500, 1000] as const;
const MIN_PURCHASE = 1;
const MAX_PURCHASE = 100_000;

// ── Types ────────────────────────────────────────────────────────────────────

interface PurchaseFlowProps {
  /** Whether to show as inline (embedded in page) or modal overlay */
  mode?: 'inline' | 'modal';
  /** Called when the modal should close (modal mode only) */
  onClose?: () => void;
  /** Called after a successful purchase return from Stripe */
  onSuccess?: (tokens: number) => void;
  /** Optional initial amount to prefill */
  initialAmount?: number;
  /** Optional class for the wrapper */
  className?: string;
}

type FlowState = 'select' | 'loading' | 'success' | 'canceled' | 'error';

// ── Component ────────────────────────────────────────────────────────────────

export function PurchaseFlow({
  mode = 'inline',
  onClose,
  onSuccess,
  initialAmount,
  className,
}: PurchaseFlowProps) {
  const searchParams = useSearchParams();
  const [selectedAmount, setSelectedAmount] = useState<number | null>(
    initialAmount ?? null
  );
  const [customAmount, setCustomAmount] = useState('');
  const [flowState, setFlowState] = useState<FlowState>('select');
  const [errorMessage, setErrorMessage] = useState('');

  // The effective amount is either the selected preset or the custom value
  const effectiveAmount = selectedAmount ?? (customAmount ? parseInt(customAmount, 10) : 0);
  const isValidAmount =
    Number.isInteger(effectiveAmount) &&
    effectiveAmount >= MIN_PURCHASE &&
    effectiveAmount <= MAX_PURCHASE;

  // Handle return from Stripe Checkout via query params
  useEffect(() => {
    const success = searchParams.get('success');
    const canceled = searchParams.get('canceled');
    const tokens = searchParams.get('tokens');

    if (success === 'true' && tokens) {
      setFlowState('success');
      onSuccess?.(parseInt(tokens, 10));
    } else if (canceled === 'true') {
      setFlowState('canceled');
    }
  }, [searchParams, onSuccess]);

  // Handle custom amount input
  const handleCustomChange = useCallback((value: string) => {
    // Only allow digits
    const cleaned = value.replace(/\D/g, '');
    setCustomAmount(cleaned);
    setSelectedAmount(null); // Deselect preset when typing custom
  }, []);

  // Handle preset selection
  const handlePresetSelect = useCallback((amount: number) => {
    setSelectedAmount(amount);
    setCustomAmount('');
  }, []);

  // Initiate Stripe Checkout
  const handleBuy = useCallback(async () => {
    if (!isValidAmount) return;

    setFlowState('loading');
    setErrorMessage('');

    try {
      const res = await api.post('/api/economy/buy/checkout', {
        tokens: effectiveAmount,
      });

      const data = res.data as { ok?: boolean; checkoutUrl?: string; error?: string };

      if (data.ok && data.checkoutUrl) {
        // Redirect to Stripe Checkout
        window.location.href = data.checkoutUrl;
      } else {
        setErrorMessage(data.error?.replace(/_/g, ' ') || 'Failed to create checkout session');
        setFlowState('error');
      }
    } catch (err: unknown) {
      const message =
        (err as { response?: { data?: { error?: string } } })?.response?.data?.error?.replace(
          /_/g,
          ' '
        ) || 'Something went wrong. Please try again.';
      setErrorMessage(message);
      setFlowState('error');
    }
  }, [effectiveAmount, isValidAmount]);

  // Reset flow
  const handleReset = useCallback(() => {
    setFlowState('select');
    setSelectedAmount(null);
    setCustomAmount('');
    setErrorMessage('');
  }, []);

  // ── Render: Success State ──────────────────────────────────────────────────

  if (flowState === 'success') {
    const tokens = searchParams.get('tokens');
    return (
      <Wrapper mode={mode} onClose={onClose} className={className}>
        <motion.div
          initial={{ opacity: 0, scale: 0.9 }}
          animate={{ opacity: 1, scale: 1 }}
          className="text-center py-8 space-y-4"
        >
          <motion.div
            initial={{ scale: 0 }}
            animate={{ scale: 1 }}
            transition={{ type: 'spring', delay: 0.1 }}
          >
            <CheckCircle2 className="w-16 h-16 mx-auto text-neon-green" />
          </motion.div>
          <h3 className={ds.heading2}>Purchase Complete!</h3>
          <p className="text-gray-400">
            <span className="text-neon-green font-mono font-bold text-lg">
              {Number(tokens || 0).toLocaleString()} CC
            </span>{' '}
            have been added to your wallet.
          </p>
          <button
            onClick={() => {
              handleReset();
              onClose?.();
            }}
            className={cn(ds.btnPrimary, 'mt-4')}
          >
            Done
          </button>
        </motion.div>
      </Wrapper>
    );
  }

  // ── Render: Canceled State ─────────────────────────────────────────────────

  if (flowState === 'canceled') {
    return (
      <Wrapper mode={mode} onClose={onClose} className={className}>
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          className="text-center py-8 space-y-4"
        >
          <XCircle className="w-16 h-16 mx-auto text-gray-500" />
          <h3 className={ds.heading2}>Purchase Canceled</h3>
          <p className="text-gray-400">
            No charges were made. You can try again anytime.
          </p>
          <button onClick={handleReset} className={cn(ds.btnSecondary, 'mt-4')}>
            Try Again
          </button>
        </motion.div>
      </Wrapper>
    );
  }

  // ── Render: Error State ────────────────────────────────────────────────────

  if (flowState === 'error') {
    return (
      <Wrapper mode={mode} onClose={onClose} className={className}>
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          className="text-center py-8 space-y-4"
        >
          <XCircle className="w-16 h-16 mx-auto text-red-400" />
          <h3 className={ds.heading2}>Something Went Wrong</h3>
          <p className="text-gray-400">{errorMessage}</p>
          <button onClick={handleReset} className={cn(ds.btnSecondary, 'mt-4')}>
            Try Again
          </button>
        </motion.div>
      </Wrapper>
    );
  }

  // ── Render: Loading State ──────────────────────────────────────────────────

  if (flowState === 'loading') {
    return (
      <Wrapper mode={mode} onClose={onClose} className={className}>
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          className="text-center py-12 space-y-4"
        >
          <Loader2 className="w-10 h-10 mx-auto text-neon-blue animate-spin" />
          <p className="text-gray-400">Redirecting to Stripe Checkout...</p>
        </motion.div>
      </Wrapper>
    );
  }

  // ── Render: Selection State ────────────────────────────────────────────────

  return (
    <Wrapper mode={mode} onClose={onClose} className={className}>
      <div className="space-y-6">
        {/* Header */}
        <div className="flex items-center gap-3">
          <div className="p-2 rounded-lg bg-neon-blue/20">
            <Coins className="w-5 h-5 text-neon-blue" />
          </div>
          <div>
            <h3 className={ds.heading3}>Buy CC Tokens</h3>
            <p className={ds.textMuted}>1 CC = $1.00 USD</p>
          </div>
        </div>

        {/* Preset Amounts */}
        <div>
          <label className={ds.label}>Select Amount</label>
          <div className="grid grid-cols-3 sm:grid-cols-5 gap-2">
            {PRESET_AMOUNTS.map((amount) => {
              const isActive = selectedAmount === amount;
              return (
                <motion.button
                  key={amount}
                  whileHover={{ scale: 1.03 }}
                  whileTap={{ scale: 0.97 }}
                  onClick={() => handlePresetSelect(amount)}
                  className={cn(
                    'relative flex flex-col items-center gap-1 p-3 rounded-lg border transition-all',
                    isActive
                      ? 'bg-neon-blue/20 border-neon-blue text-neon-blue shadow-neon-blue'
                      : 'bg-lattice-elevated border-lattice-border text-gray-300 hover:border-gray-500'
                  )}
                >
                  <span className="text-lg font-mono font-bold">
                    {amount.toLocaleString()}
                  </span>
                  <span className="text-xs text-gray-500">
                    ${amount.toLocaleString()}
                  </span>
                  {isActive && (
                    <motion.div
                      layoutId="preset-highlight"
                      className="absolute inset-0 rounded-lg border-2 border-neon-blue"
                      transition={{ type: 'spring', stiffness: 300, damping: 30 }}
                    />
                  )}
                </motion.button>
              );
            })}
          </div>
        </div>

        {/* Custom Amount */}
        <div>
          <label className={ds.label}>Or enter a custom amount</label>
          <div className="relative">
            <Coins className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-500" />
            <input
              type="text"
              inputMode="numeric"
              value={customAmount}
              onChange={(e) => handleCustomChange(e.target.value)}
              placeholder={`${MIN_PURCHASE} - ${MAX_PURCHASE.toLocaleString()}`}
              className={cn(ds.input, 'pl-10 pr-20 font-mono')}
            />
            <span className="absolute right-3 top-1/2 -translate-y-1/2 text-sm text-gray-500">
              CC
            </span>
          </div>
          {customAmount && !isValidAmount && (
            <p className="text-xs text-red-400 mt-1">
              Amount must be between {MIN_PURCHASE} and{' '}
              {MAX_PURCHASE.toLocaleString()} CC
            </p>
          )}
        </div>

        {/* Price Summary */}
        <AnimatePresence>
          {isValidAmount && (
            <motion.div
              initial={{ opacity: 0, height: 0 }}
              animate={{ opacity: 1, height: 'auto' }}
              exit={{ opacity: 0, height: 0 }}
              className="overflow-hidden"
            >
              <div className="bg-lattice-deep rounded-lg p-4 border border-lattice-border space-y-2">
                <div className="flex items-center justify-between">
                  <span className="text-sm text-gray-400">Tokens</span>
                  <span className="font-mono text-white">
                    {effectiveAmount.toLocaleString()} CC
                  </span>
                </div>
                <div className="flex items-center justify-between">
                  <span className="text-sm text-gray-400">Exchange Rate</span>
                  <span className="font-mono text-gray-300">1 CC = $1.00</span>
                </div>
                <div className="border-t border-lattice-border pt-2">
                  <div className="flex items-center justify-between">
                    <span className="text-sm font-medium text-white">
                      Total
                    </span>
                    <span className="font-mono text-lg font-bold text-neon-green flex items-center gap-1">
                      <DollarSign className="w-4 h-4" />
                      {effectiveAmount.toLocaleString()}.00
                    </span>
                  </div>
                </div>
              </div>
            </motion.div>
          )}
        </AnimatePresence>

        {/* Buy Button */}
        <motion.button
          whileHover={isValidAmount ? { scale: 1.01 } : undefined}
          whileTap={isValidAmount ? { scale: 0.99 } : undefined}
          onClick={handleBuy}
          disabled={!isValidAmount}
          className={cn(
            ds.btnBase,
            'w-full px-6 py-3 text-base font-semibold',
            isValidAmount
              ? 'bg-gradient-to-r from-neon-blue to-neon-purple text-white hover:opacity-90 focus:ring-neon-blue'
              : 'bg-lattice-elevated text-gray-500 cursor-not-allowed'
          )}
        >
          <CreditCard className="w-5 h-5" />
          <span>
            {isValidAmount
              ? `Buy ${effectiveAmount.toLocaleString()} CC for $${effectiveAmount.toLocaleString()}`
              : 'Select an amount'}
          </span>
          {isValidAmount && <Sparkles className="w-4 h-4" />}
        </motion.button>

        {/* Security Note */}
        <p className="text-center text-xs text-gray-600">
          Payments are processed securely by Stripe. Your card details never
          touch our servers.
        </p>
      </div>
    </Wrapper>
  );
}

// ── Wrapper Component ────────────────────────────────────────────────────────

function Wrapper({
  mode,
  onClose,
  className,
  children,
}: {
  mode: 'inline' | 'modal';
  onClose?: () => void;
  className?: string;
  children: React.ReactNode;
}) {
  if (mode === 'modal') {
    return (
      <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
        <div
          className="absolute inset-0 bg-black/70 backdrop-blur-sm"
          onClick={onClose}
          aria-hidden="true" role="button" tabIndex={0} onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); (e.currentTarget as HTMLElement).click(); } }} />
        <motion.div
          initial={{ opacity: 0, scale: 0.95, y: 20 }}
          animate={{ opacity: 1, scale: 1, y: 0 }}
          exit={{ opacity: 0, scale: 0.95, y: 20 }}
          className={cn(
            'relative w-full max-w-lg bg-lattice-surface border border-lattice-border rounded-xl shadow-2xl p-6',
            className
          )}
        >
          {children}
        </motion.div>
      </div>
    );
  }

  return <div className={cn('w-full', className)}>{children}</div>;
}

export default PurchaseFlow;
