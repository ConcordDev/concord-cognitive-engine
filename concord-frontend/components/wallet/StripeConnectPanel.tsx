'use client';

/**
 * StripeConnectPanel -- Inline panel for Stripe Connect onboarding and withdrawals.
 *
 * Three states:
 * 1. Not connected: prompt to enable withdrawals via Stripe
 * 2. Connected but not verified: prompt to complete verification
 * 3. Fully connected: withdrawal form with balance, fees, and submit
 */

import { useState, useCallback } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import {
  Building2,
  ShieldCheck,
  ExternalLink,
  Loader2,
  CheckCircle2,
  Clock,
  Coins,
  Info,
  AlertTriangle,
} from 'lucide-react';
import { api, apiHelpers } from '@/lib/api/client';
import { cn } from '@/lib/utils';
import { ds } from '@/lib/design-system';

// ── Constants ────────────────────────────────────────────────────────────────

const MIN_WITHDRAWAL = 10;
const PLATFORM_FEE_PERCENT = 1.46;

// ── Types ────────────────────────────────────────────────────────────────────

interface ConnectStatus {
  ok: boolean;
  connected: boolean;
  stripeAccountId?: string;
  onboardingComplete?: boolean;
}

interface StripeConnectPanelProps {
  className?: string;
}

// ── Component ────────────────────────────────────────────────────────────────

export function StripeConnectPanel({ className }: StripeConnectPanelProps) {
  const queryClient = useQueryClient();
  const [amount, setAmount] = useState('');
  const [connecting, setConnecting] = useState(false);
  const [withdrawing, setWithdrawing] = useState(false);
  const [toast, setToast] = useState<{ type: 'success' | 'error'; message: string } | null>(null);

  // Fetch Connect status
  const { data: connectStatus, isLoading: statusLoading } = useQuery({
    queryKey: ['stripe-connect-status'],
    queryFn: () =>
      apiHelpers.economy.connectStatus().then((r) => r.data as ConnectStatus),
    retry: false,
  });

  // Fetch balance
  const { data: balanceData } = useQuery({
    queryKey: ['wallet-balance'],
    queryFn: () =>
      api.get('/api/economy/balance').then((r) => r.data as { ok: boolean; balance: number }),
    retry: false,
  });

  const balance = balanceData?.balance ?? 0;
  const parsedAmount = parseFloat(amount) || 0;
  const fee = parsedAmount * (PLATFORM_FEE_PERCENT / 100);
  const netUsd = parsedAmount - fee;
  const isValidAmount = parsedAmount >= MIN_WITHDRAWAL && parsedAmount <= balance;

  // Determine state
  const isConnected = connectStatus?.connected === true;
  const isVerified = connectStatus?.onboardingComplete === true;

  // ── Handlers ─────────────────────────────────────────────────────────────

  const showToast = useCallback((type: 'success' | 'error', message: string) => {
    setToast({ type, message });
    setTimeout(() => setToast(null), 5000);
  }, []);

  const handleConnect = useCallback(async () => {
    setConnecting(true);
    try {
      const res = await apiHelpers.economy.connectStripe();
      const data = res.data as { ok?: boolean; onboardingUrl?: string; error?: string };
      if (data.ok && data.onboardingUrl) {
        window.open(data.onboardingUrl, '_blank');
      } else {
        showToast('error', data.error?.replace(/_/g, ' ') || 'Failed to start Stripe onboarding');
      }
    } catch {
      showToast('error', 'Failed to connect to Stripe. Please try again.');
    } finally {
      setConnecting(false);
    }
  }, [showToast]);

  const handleWithdraw = useCallback(async () => {
    if (!isValidAmount) return;
    setWithdrawing(true);
    try {
      const res = await api.post('/api/economy/withdraw', { amount: parsedAmount });
      const data = res.data as { ok?: boolean; error?: string };
      if (data.ok) {
        showToast('success', `Withdrawal of ${parsedAmount} CC submitted successfully.`);
        setAmount('');
        queryClient.invalidateQueries({ queryKey: ['wallet-balance'] });
        queryClient.invalidateQueries({ queryKey: ['wallet-withdrawals'] });
        queryClient.invalidateQueries({ queryKey: ['economy-balance'] });
      } else {
        showToast('error', data.error?.replace(/_/g, ' ') || 'Withdrawal request failed');
      }
    } catch (err: unknown) {
      const message =
        (err as { response?: { data?: { error?: string } } })?.response?.data?.error?.replace(
          /_/g,
          ' '
        ) || 'Something went wrong. Please try again.';
      showToast('error', message);
    } finally {
      setWithdrawing(false);
    }
  }, [parsedAmount, isValidAmount, queryClient, showToast]);

  // ── Loading State ────────────────────────────────────────────────────────

  if (statusLoading) {
    return (
      <div className={cn(ds.panel, 'flex items-center justify-center py-12', className)}>
        <Loader2 className="w-6 h-6 text-neon-blue animate-spin" />
        <span className="ml-3 text-gray-400">Checking payout setup...</span>
      </div>
    );
  }

  // ── State 1: Not Connected ───────────────────────────────────────────────

  if (!isConnected) {
    return (
      <motion.div
        initial={{ opacity: 0, y: 8 }}
        animate={{ opacity: 1, y: 0 }}
        className={cn(ds.panel, 'space-y-5', className)}
      >
        <div className="flex items-center gap-3">
          <div className="p-2 rounded-lg bg-neon-purple/20">
            <Building2 className="w-5 h-5 text-neon-purple" />
          </div>
          <div>
            <h3 className={ds.heading3}>Enable Withdrawals</h3>
            <p className={ds.textMuted}>Connect a bank account to withdraw earnings</p>
          </div>
        </div>

        <div className="bg-lattice-deep rounded-lg p-4 border border-lattice-border space-y-3">
          <div className="flex items-start gap-3">
            <ShieldCheck className="w-5 h-5 text-neon-green mt-0.5 flex-shrink-0" />
            <div>
              <p className="text-sm text-white font-medium">Secure Verification</p>
              <p className="text-xs text-gray-400">
                Stripe handles all identity verification and banking details. Your
                sensitive information is never stored on our servers.
              </p>
            </div>
          </div>
          <div className="flex items-start gap-3">
            <Clock className="w-5 h-5 text-neon-blue mt-0.5 flex-shrink-0" />
            <div>
              <p className="text-sm text-white font-medium">Quick Setup</p>
              <p className="text-xs text-gray-400">
                The process takes about 5 minutes. You will need a valid ID and
                bank account information.
              </p>
            </div>
          </div>
        </div>

        <button
          onClick={handleConnect}
          disabled={connecting}
          className={cn(
            ds.btnBase,
            'w-full px-6 py-3 bg-gradient-to-r from-neon-purple to-neon-pink text-white hover:opacity-90 focus:ring-neon-purple'
          )}
        >
          {connecting ? (
            <Loader2 className="w-4 h-4 animate-spin" />
          ) : (
            <ExternalLink className="w-4 h-4" />
          )}
          Connect Bank Account via Stripe
        </button>

        <Toast toast={toast} />
      </motion.div>
    );
  }

  // ── State 2: Connected but Not Verified ──────────────────────────────────

  if (!isVerified) {
    return (
      <motion.div
        initial={{ opacity: 0, y: 8 }}
        animate={{ opacity: 1, y: 0 }}
        className={cn(ds.panel, 'space-y-5', className)}
      >
        <div className="flex items-center gap-3">
          <div className="p-2 rounded-lg bg-amber-500/20">
            <AlertTriangle className="w-5 h-5 text-amber-400" />
          </div>
          <div>
            <h3 className={ds.heading3}>Verification In Progress</h3>
            <p className={ds.textMuted}>
              Your Stripe account is connected but verification is not yet complete
            </p>
          </div>
        </div>

        <div className="bg-lattice-deep rounded-lg p-4 border border-amber-500/30">
          <div className="flex items-start gap-3">
            <Info className="w-5 h-5 text-amber-400 mt-0.5 flex-shrink-0" />
            <p className="text-sm text-gray-300">
              Stripe may need additional information to verify your identity or
              banking details. Complete the remaining steps to enable withdrawals.
            </p>
          </div>
        </div>

        <button
          onClick={handleConnect}
          disabled={connecting}
          className={cn(
            ds.btnBase,
            'w-full px-6 py-3 bg-amber-500/20 text-amber-400 border border-amber-500/50 hover:bg-amber-500/30 focus:ring-amber-500'
          )}
        >
          {connecting ? (
            <Loader2 className="w-4 h-4 animate-spin" />
          ) : (
            <ExternalLink className="w-4 h-4" />
          )}
          Complete Verification
        </button>

        <Toast toast={toast} />
      </motion.div>
    );
  }

  // ── State 3: Fully Connected -- Withdrawal Form ──────────────────────────

  return (
    <motion.div
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      className={cn(ds.panel, 'space-y-5', className)}
    >
      <div className="flex items-center gap-3">
        <div className="p-2 rounded-lg bg-neon-green/20">
          <CheckCircle2 className="w-5 h-5 text-neon-green" />
        </div>
        <div>
          <h3 className={ds.heading3}>Withdraw Funds</h3>
          <p className={ds.textMuted}>Convert CC tokens to USD</p>
        </div>
      </div>

      {/* Balance Display */}
      <div className="bg-lattice-deep rounded-lg p-4 border border-lattice-border">
        <div className="flex items-center justify-between">
          <span className="text-sm text-gray-400">Available Balance</span>
          <span className="font-mono text-lg font-bold text-neon-green">
            {balance.toLocaleString()} CC
          </span>
        </div>
      </div>

      {/* Amount Input */}
      <div>
        <label className={ds.label}>Withdrawal Amount (CC)</label>
        <div className="relative">
          <Coins className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-500" />
          <input
            type="text"
            inputMode="numeric"
            value={amount}
            onChange={(e) => setAmount(e.target.value.replace(/[^\d.]/g, ''))}
            placeholder={`Min ${MIN_WITHDRAWAL} CC`}
            className={cn(ds.input, 'pl-10 pr-16 font-mono')}
          />
          <button
            onClick={() => setAmount(String(balance))}
            className="absolute right-2 top-1/2 -translate-y-1/2 px-2 py-1 text-xs font-medium text-neon-blue bg-neon-blue/10 rounded hover:bg-neon-blue/20 transition-colors"
          >
            MAX
          </button>
        </div>
        {amount && !isValidAmount && (
          <p className="text-xs text-red-400 mt-1">
            {parsedAmount < MIN_WITHDRAWAL
              ? `Minimum withdrawal is ${MIN_WITHDRAWAL} CC`
              : `Insufficient balance. Available: ${balance.toLocaleString()} CC`}
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
                <span className="font-mono text-red-400">
                  -{fee.toFixed(2)} CC
                </span>
              </div>
              <div className="border-t border-lattice-border pt-2">
                <div className="flex items-center justify-between">
                  <span className="text-sm font-medium text-white">Net Amount (USD)</span>
                  <span className="font-mono text-lg font-bold text-neon-green">
                    ${netUsd.toFixed(2)}
                  </span>
                </div>
              </div>
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Withdraw Button */}
      <button
        onClick={handleWithdraw}
        disabled={!isValidAmount || withdrawing}
        className={cn(
          ds.btnBase,
          'w-full px-6 py-3',
          isValidAmount
            ? 'bg-neon-green/20 text-neon-green border border-neon-green/50 hover:bg-neon-green/30 focus:ring-neon-green'
            : 'bg-lattice-elevated text-gray-500 cursor-not-allowed'
        )}
      >
        {withdrawing ? (
          <Loader2 className="w-5 h-5 animate-spin" />
        ) : (
          <Coins className="w-5 h-5" />
        )}
        {withdrawing
          ? 'Processing...'
          : isValidAmount
          ? `Withdraw ${parsedAmount.toLocaleString()} CC`
          : 'Enter withdrawal amount'}
      </button>

      {/* Estimated Arrival */}
      <div className="flex items-start gap-2 text-xs text-gray-500">
        <Clock className="w-3.5 h-3.5 mt-0.5 flex-shrink-0" />
        <span>
          Estimated arrival: 2-3 business days after approval. Funds will be
          deposited into your connected bank account.
        </span>
      </div>

      <Toast toast={toast} />
    </motion.div>
  );
}

// ── Toast Helper ──────────────────────────────────────────────────────────────

function Toast({ toast }: { toast: { type: 'success' | 'error'; message: string } | null }) {
  return (
    <AnimatePresence>
      {toast && (
        <motion.div
          initial={{ opacity: 0, y: 8 }}
          animate={{ opacity: 1, y: 0 }}
          exit={{ opacity: 0, y: 8 }}
          className={cn(
            'rounded-lg px-4 py-3 text-sm border',
            toast.type === 'success'
              ? 'bg-neon-green/10 text-neon-green border-neon-green/30'
              : 'bg-red-500/10 text-red-400 border-red-500/30'
          )}
        >
          <div className="flex items-center gap-2">
            {toast.type === 'success' ? (
              <CheckCircle2 className="w-4 h-4 flex-shrink-0" />
            ) : (
              <AlertTriangle className="w-4 h-4 flex-shrink-0" />
            )}
            {toast.message}
          </div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}

export default StripeConnectPanel;
