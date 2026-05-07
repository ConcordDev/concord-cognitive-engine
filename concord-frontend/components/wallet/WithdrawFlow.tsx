'use client';

/**
 * WithdrawFlow -- Modal component for withdrawing CC tokens to fiat.
 *
 * Features:
 * - Stripe Connect onboarding check
 * - Amount input with min/max validation
 * - Max button to fill available balance
 * - Fee preview and breakdown
 * - Confirmation step before submission
 * - Pending withdrawal status tracking
 */

import { useState, useCallback, useEffect } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import {
  ArrowDownToLine,
  ShieldCheck,
  ExternalLink,
  Loader2,
  CheckCircle2,
  XCircle,
  AlertTriangle,
  Info,
  Clock,
  Coins,
  Building2,
} from 'lucide-react';
import { api, apiHelpers } from '@/lib/api/client';
import { cn } from '@/lib/utils';
import { ds } from '@/lib/design-system';

// ── Constants ────────────────────────────────────────────────────────────────

const MIN_WITHDRAWAL = 20;
const MAX_DAILY_WITHDRAWAL = 5_000;
const PLATFORM_FEE_PERCENT = 5; // 5% platform fee on withdrawals

// ── Types ────────────────────────────────────────────────────────────────────

interface WithdrawFlowProps {
  /** Whether to show as inline or modal */
  mode?: 'inline' | 'modal';
  /** Called when modal should close */
  onClose?: () => void;
  /** Called after a successful withdrawal request */
  onSuccess?: () => void;
  /** Current balance (passed in to avoid duplicate fetch) */
  balance?: number;
  /** Optional class */
  className?: string;
}

interface ConnectStatus {
  connected: boolean;
  stripeAccountId?: string;
  onboardingComplete?: boolean;
}

interface Withdrawal {
  id: string;
  amount: number;
  fee: number;
  net: number;
  status: 'pending' | 'approved' | 'processing' | 'complete' | 'rejected' | 'canceled';
  created_at: string;
  processed_at?: string;
}

type FlowStep = 'check' | 'onboard' | 'input' | 'confirm' | 'loading' | 'success' | 'error';

// ── Component ────────────────────────────────────────────────────────────────

function WithdrawFlow({
  mode = 'modal',
  onClose,
  onSuccess,
  balance: externalBalance,
  className,
}: WithdrawFlowProps) {
  const queryClient = useQueryClient();
  const [step, setStep] = useState<FlowStep>('check');
  const [amount, setAmount] = useState('');
  const [errorMessage, setErrorMessage] = useState('');

  // Fetch Connect status
  const { data: connectStatus, isLoading: connectLoading } = useQuery({
    queryKey: ['stripe-connect-status'],
    queryFn: () => apiHelpers.economy.connectStatus().then((r) => r.data as ConnectStatus),
    retry: false,
  });

  // Fetch balance if not provided
  const { data: balanceData } = useQuery({
    queryKey: ['wallet-balance'],
    queryFn: () => api.get('/api/economy/balance').then((r) => r.data as { balance: number }),
    enabled: externalBalance === undefined,
    retry: false,
  });

  // Fetch pending withdrawals
  const { data: withdrawalsData } = useQuery({
    queryKey: ['wallet-withdrawals'],
    queryFn: () =>
      api.get('/api/economy/withdrawals').then(
        (r) =>
          r.data as {
            withdrawals?: Withdrawal[];
            items?: Withdrawal[];
          }
      ),
    retry: false,
  });

  const currentBalance = externalBalance ?? balanceData?.balance ?? 0;
  const pendingWithdrawals = withdrawalsData?.withdrawals || withdrawalsData?.items || [];
  const pendingAmount = pendingWithdrawals
    .filter((w) => ['pending', 'approved', 'processing'].includes(w.status))
    .reduce((sum, w) => sum + w.amount, 0);
  const availableForWithdrawal = Math.max(0, currentBalance - pendingAmount);

  // Parsed amount
  const parsedAmount = parseInt(amount, 10) || 0;
  const fee = Math.ceil(parsedAmount * (PLATFORM_FEE_PERCENT / 100));
  const netPayout = parsedAmount - fee;
  const isValidAmount =
    parsedAmount >= MIN_WITHDRAWAL &&
    parsedAmount <= MAX_DAILY_WITHDRAWAL &&
    parsedAmount <= availableForWithdrawal;

  // Determine initial step based on connect status
  useEffect(() => {
    if (connectLoading) return;

    if (!connectStatus?.connected || !connectStatus?.onboardingComplete) {
      setStep('onboard');
    } else {
      setStep('input');
    }
  }, [connectStatus, connectLoading]);

  // Handle Connect onboarding
  const handleOnboard = useCallback(async () => {
    setStep('loading');
    try {
      const res = await apiHelpers.economy.connectStripe();
      const data = res.data as {
        ok?: boolean;
        onboardingUrl?: string;
        error?: string;
      };
      if (data.ok && data.onboardingUrl) {
        window.location.href = data.onboardingUrl;
      } else {
        setErrorMessage(data.error?.replace(/_/g, ' ') || 'Failed to start Connect onboarding');
        setStep('error');
      }
    } catch {
      setErrorMessage('Failed to connect to Stripe. Please try again.');
      setStep('error');
    }
  }, []);

  // Submit withdrawal
  const handleWithdraw = useCallback(async () => {
    if (!isValidAmount) return;

    setStep('loading');
    setErrorMessage('');

    try {
      const res = await api.post('/api/economy/withdraw', {
        amount: parsedAmount,
      });

      const data = res.data as { ok?: boolean; error?: string };

      if (data.ok) {
        setStep('success');
        // Invalidate balance + withdrawal queries
        queryClient.invalidateQueries({ queryKey: ['wallet-balance'] });
        queryClient.invalidateQueries({ queryKey: ['wallet-withdrawals'] });
        queryClient.invalidateQueries({ queryKey: ['economy-balance'] });
        onSuccess?.();
      } else {
        setErrorMessage(data.error?.replace(/_/g, ' ') || 'Withdrawal request failed');
        setStep('error');
      }
    } catch (err: unknown) {
      const message =
        (err as { response?: { data?: { error?: string } } })?.response?.data?.error?.replace(
          /_/g,
          ' '
        ) || 'Something went wrong. Please try again.';
      setErrorMessage(message);
      setStep('error');
    }
  }, [parsedAmount, isValidAmount, queryClient, onSuccess]);

  // Handle amount change
  const handleAmountChange = useCallback((value: string) => {
    setAmount(value.replace(/\D/g, ''));
  }, []);

  // Fill max amount
  const handleMax = useCallback(() => {
    const maxAmount = Math.min(availableForWithdrawal, MAX_DAILY_WITHDRAWAL);
    setAmount(String(maxAmount));
  }, [availableForWithdrawal]);

  // Reset flow
  const handleReset = useCallback(() => {
    setStep(connectStatus?.onboardingComplete ? 'input' : 'onboard');
    setAmount('');
    setErrorMessage('');
  }, [connectStatus]);

  // ── Render Steps ───────────────────────────────────────────────────────────

  const renderContent = () => {
    switch (step) {
      // Loading / Checking connect status
      case 'check':
        return (
          <div className="text-center py-12">
            <Loader2 className="w-8 h-8 mx-auto text-neon-blue animate-spin" />
            <p className="text-gray-400 mt-3">Checking payout setup...</p>
          </div>
        );

      // Connect onboarding required
      case 'onboard':
        return (
          <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} className="space-y-6">
            <div className="flex items-center gap-3">
              <div className="p-2 rounded-lg bg-neon-purple/20">
                <Building2 className="w-5 h-5 text-neon-purple" />
              </div>
              <div>
                <h3 className={ds.heading3}>Set Up Payouts</h3>
                <p className={ds.textMuted}>Connect your bank account to withdraw</p>
              </div>
            </div>

            <div className="bg-lattice-deep rounded-lg p-4 border border-lattice-border space-y-3">
              <div className="flex items-start gap-3">
                <ShieldCheck className="w-5 h-5 text-neon-green mt-0.5 flex-shrink-0" />
                <div>
                  <p className="text-sm text-white font-medium">Secure & Verified</p>
                  <p className="text-xs text-gray-400">
                    Stripe handles all payout processing. Your banking details are never stored on
                    our servers.
                  </p>
                </div>
              </div>
              <div className="flex items-start gap-3">
                <Clock className="w-5 h-5 text-neon-blue mt-0.5 flex-shrink-0" />
                <div>
                  <p className="text-sm text-white font-medium">Takes ~5 Minutes</p>
                  <p className="text-xs text-gray-400">
                    You will need to verify your identity and connect a bank account through Stripe.
                  </p>
                </div>
              </div>
            </div>

            <button
              onClick={handleOnboard}
              className={cn(
                ds.btnBase,
                'w-full px-6 py-3 bg-gradient-to-r from-neon-purple to-neon-pink text-white hover:opacity-90 focus:ring-neon-purple'
              )}
            >
              <ExternalLink className="w-4 h-4" />
              Set Up Payouts with Stripe
            </button>
          </motion.div>
        );

      // Amount input
      case 'input':
        return (
          <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} className="space-y-6">
            <div className="flex items-center gap-3">
              <div className="p-2 rounded-lg bg-neon-green/20">
                <ArrowDownToLine className="w-5 h-5 text-neon-green" />
              </div>
              <div>
                <h3 className={ds.heading3}>Withdraw CC</h3>
                <p className={ds.textMuted}>Convert tokens to USD</p>
              </div>
            </div>

            {/* Available Balance */}
            <div className="bg-lattice-deep rounded-lg p-4 border border-lattice-border">
              <div className="flex items-center justify-between">
                <span className="text-sm text-gray-400">Available for withdrawal</span>
                <span className="font-mono text-lg font-bold text-neon-green">
                  {availableForWithdrawal.toLocaleString()} CC
                </span>
              </div>
              {pendingAmount > 0 && (
                <p className="text-xs text-gray-500 mt-1">
                  {pendingAmount.toLocaleString()} CC in pending withdrawals
                </p>
              )}
            </div>

            {/* Amount Input */}
            <div>
              <label className={ds.label}>Withdrawal Amount</label>
              <div className="relative">
                <Coins className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-500" />
                <input
                  type="text"
                  inputMode="numeric"
                  value={amount}
                  onChange={(e) => handleAmountChange(e.target.value)}
                  placeholder={`Min ${MIN_WITHDRAWAL} CC`}
                  className={cn(ds.input, 'pl-10 pr-24 font-mono')}
                />
                <button
                  onClick={handleMax}
                  className="absolute right-2 top-1/2 -translate-y-1/2 px-2 py-1 text-xs font-medium text-neon-blue bg-neon-blue/10 rounded hover:bg-neon-blue/20 transition-colors"
                >
                  MAX
                </button>
              </div>
              {amount && !isValidAmount && (
                <p className="text-xs text-red-400 mt-1">
                  {parsedAmount < MIN_WITHDRAWAL
                    ? `Minimum withdrawal is ${MIN_WITHDRAWAL} CC`
                    : parsedAmount > MAX_DAILY_WITHDRAWAL
                      ? `Maximum daily withdrawal is ${MAX_DAILY_WITHDRAWAL.toLocaleString()} CC`
                      : `Insufficient balance. Available: ${availableForWithdrawal.toLocaleString()} CC`}
                </p>
              )}
            </div>

            {/* Fee Preview */}
            <AnimatePresence>
              {parsedAmount > 0 && isValidAmount && (
                <motion.div
                  initial={{ opacity: 0, height: 0 }}
                  animate={{ opacity: 1, height: 'auto' }}
                  exit={{ opacity: 0, height: 0 }}
                  className="overflow-hidden"
                >
                  <div className="bg-lattice-deep rounded-lg p-4 border border-lattice-border space-y-2">
                    <div className="flex items-center justify-between">
                      <span className="text-sm text-gray-400">Withdrawal Amount</span>
                      <span className="font-mono text-white">
                        {parsedAmount.toLocaleString()} CC
                      </span>
                    </div>
                    <div className="flex items-center justify-between">
                      <span className="text-sm text-gray-400 flex items-center gap-1">
                        Platform Fee ({PLATFORM_FEE_PERCENT}%)
                        <Info className="w-3 h-3" />
                      </span>
                      <span className="font-mono text-red-400">-{fee.toLocaleString()} CC</span>
                    </div>
                    <div className="border-t border-lattice-border pt-2">
                      <div className="flex items-center justify-between">
                        <span className="text-sm font-medium text-white">You Receive</span>
                        <span className="font-mono text-lg font-bold text-neon-green">
                          ${netPayout.toLocaleString()}.00
                        </span>
                      </div>
                    </div>
                  </div>
                </motion.div>
              )}
            </AnimatePresence>

            {/* Continue Button */}
            <button
              onClick={() => setStep('confirm')}
              disabled={!isValidAmount}
              className={cn(
                ds.btnBase,
                'w-full px-6 py-3',
                isValidAmount
                  ? 'bg-neon-green/20 text-neon-green border border-neon-green/50 hover:bg-neon-green/30 focus:ring-neon-green'
                  : 'bg-lattice-elevated text-gray-500 cursor-not-allowed'
              )}
            >
              <ArrowDownToLine className="w-5 h-5" />
              {isValidAmount
                ? `Withdraw ${parsedAmount.toLocaleString()} CC`
                : 'Enter withdrawal amount'}
            </button>

            {/* Limits Info */}
            <div className="flex items-start gap-2 text-xs text-gray-500">
              <Info className="w-3.5 h-3.5 mt-0.5 flex-shrink-0" />
              <span>
                Min: {MIN_WITHDRAWAL} CC | Max daily: {MAX_DAILY_WITHDRAWAL.toLocaleString()} CC |
                Withdrawals are reviewed and typically processed within 1-3 business days.
              </span>
            </div>

            {/* Pending Withdrawals */}
            {pendingWithdrawals.length > 0 && (
              <div className="space-y-2">
                <h4 className="text-sm font-medium text-gray-400">Recent Withdrawals</h4>
                {pendingWithdrawals.slice(0, 3).map((w) => (
                  <div
                    key={w.id}
                    className="flex items-center justify-between bg-lattice-deep rounded-lg px-3 py-2 border border-lattice-border"
                  >
                    <div className="flex items-center gap-2">
                      <WithdrawalStatusIcon status={w.status} />
                      <div>
                        <span className="text-sm font-mono text-white">
                          {w.amount.toLocaleString()} CC
                        </span>
                        <p className="text-xs text-gray-500">
                          {new Date(w.created_at).toLocaleDateString()}
                        </p>
                      </div>
                    </div>
                    <WithdrawalStatusBadge status={w.status} />
                  </div>
                ))}
              </div>
            )}
          </motion.div>
        );

      // Confirmation step
      case 'confirm':
        return (
          <motion.div
            initial={{ opacity: 0, x: 20 }}
            animate={{ opacity: 1, x: 0 }}
            className="space-y-6"
          >
            <div className="flex items-center gap-3">
              <div className="p-2 rounded-lg bg-amber-500/20">
                <AlertTriangle className="w-5 h-5 text-amber-400" />
              </div>
              <div>
                <h3 className={ds.heading3}>Confirm Withdrawal</h3>
                <p className={ds.textMuted}>Please review before confirming</p>
              </div>
            </div>

            <div className="bg-lattice-deep rounded-lg p-5 border border-lattice-border space-y-3">
              <div className="flex items-center justify-between">
                <span className="text-sm text-gray-400">Amount</span>
                <span className="font-mono text-white font-medium">
                  {parsedAmount.toLocaleString()} CC
                </span>
              </div>
              <div className="flex items-center justify-between">
                <span className="text-sm text-gray-400">Fee ({PLATFORM_FEE_PERCENT}%)</span>
                <span className="font-mono text-red-400">-{fee.toLocaleString()} CC</span>
              </div>
              <div className="border-t border-lattice-border pt-3">
                <div className="flex items-center justify-between">
                  <span className="text-sm font-semibold text-white">Payout Amount</span>
                  <span className="font-mono text-xl font-bold text-neon-green">
                    ${netPayout.toLocaleString()}.00
                  </span>
                </div>
              </div>
            </div>

            <p className="text-xs text-gray-500 flex items-start gap-2">
              <Info className="w-3.5 h-3.5 mt-0.5 flex-shrink-0" />
              Withdrawals are typically processed within 1-3 business days. Funds will be sent to
              your connected Stripe account.
            </p>

            <div className="flex gap-3">
              <button onClick={() => setStep('input')} className={cn(ds.btnSecondary, 'flex-1')}>
                Back
              </button>
              <button
                onClick={handleWithdraw}
                className={cn(
                  ds.btnBase,
                  'flex-1 px-6 py-2 bg-neon-green/20 text-neon-green border border-neon-green/50 hover:bg-neon-green/30 focus:ring-neon-green'
                )}
              >
                <CheckCircle2 className="w-4 h-4" />
                Confirm Withdrawal
              </button>
            </div>
          </motion.div>
        );

      // Processing
      case 'loading':
        return (
          <div className="text-center py-12">
            <Loader2 className="w-10 h-10 mx-auto text-neon-blue animate-spin" />
            <p className="text-gray-400 mt-3">Processing your request...</p>
          </div>
        );

      // Success
      case 'success':
        return (
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
            <h3 className={ds.heading2}>Withdrawal Requested</h3>
            <p className="text-gray-400">
              Your withdrawal of{' '}
              <span className="text-neon-green font-mono font-bold">
                {parsedAmount.toLocaleString()} CC
              </span>{' '}
              (${netPayout.toLocaleString()} after fees) has been submitted for review.
            </p>
            <p className="text-xs text-gray-500">
              You will receive ${netPayout.toLocaleString()}.00 within 1-3 business days.
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
        );

      // Error
      case 'error':
        return (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            className="text-center py-8 space-y-4"
          >
            <XCircle className="w-16 h-16 mx-auto text-red-400" />
            <h3 className={ds.heading2}>Withdrawal Failed</h3>
            <p className="text-gray-400">{errorMessage}</p>
            <button onClick={handleReset} className={cn(ds.btnSecondary, 'mt-4')}>
              Try Again
            </button>
          </motion.div>
        );

      default:
        return null;
    }
  };

  // ── Main Render ────────────────────────────────────────────────────────────

  if (mode === 'modal') {
    return (
      <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
        <div
          className="absolute inset-0 bg-black/70 backdrop-blur-sm"
          onClick={onClose}
          aria-hidden="true"
        />
        <motion.div
          initial={{ opacity: 0, scale: 0.95, y: 20 }}
          animate={{ opacity: 1, scale: 1, y: 0 }}
          exit={{ opacity: 0, scale: 0.95, y: 20 }}
          className={cn(
            'relative w-full max-w-lg bg-lattice-surface border border-lattice-border rounded-xl shadow-2xl p-6 max-h-[85vh] overflow-y-auto',
            className
          )}
        >
          {renderContent()}
        </motion.div>
      </div>
    );
  }

  return <div className={cn('w-full', className)}>{renderContent()}</div>;
}

// ── Helper Components ────────────────────────────────────────────────────────

function WithdrawalStatusIcon({ status }: { status: string }) {
  switch (status) {
    case 'complete':
      return <CheckCircle2 className="w-4 h-4 text-neon-green" />;
    case 'rejected':
    case 'canceled':
      return <XCircle className="w-4 h-4 text-red-400" />;
    case 'processing':
      return <Loader2 className="w-4 h-4 text-neon-blue animate-spin" />;
    default:
      return <Clock className="w-4 h-4 text-amber-400" />;
  }
}

function WithdrawalStatusBadge({ status }: { status: string }) {
  const colorMap: Record<string, string> = {
    pending: 'text-amber-400 bg-amber-400/10 border-amber-400/30',
    approved: 'text-neon-blue bg-neon-blue/10 border-neon-blue/30',
    processing: 'text-neon-blue bg-neon-blue/10 border-neon-blue/30',
    complete: 'text-neon-green bg-neon-green/10 border-neon-green/30',
    rejected: 'text-red-400 bg-red-400/10 border-red-400/30',
    canceled: 'text-gray-400 bg-gray-400/10 border-gray-400/30',
  };

  return (
    <span
      className={cn(
        'px-2 py-0.5 rounded-full text-xs font-medium border',
        colorMap[status] || 'text-gray-400 bg-gray-400/10 border-gray-400/30'
      )}
    >
      {status}
    </span>
  );
}

import { withErrorBoundary } from '@/components/common/ErrorBoundary';
const _WrappedWithdrawFlow = withErrorBoundary(WithdrawFlow);
export { _WrappedWithdrawFlow as WithdrawFlow };
export default _WrappedWithdrawFlow;
