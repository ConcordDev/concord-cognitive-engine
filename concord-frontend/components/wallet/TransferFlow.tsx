'use client';

import { useEffect, useRef, useState } from 'react';
import { motion } from 'framer-motion';
import {
  CheckCircle2,
  Coins,
  Info,
  Loader2,
  Send,
  XCircle,
} from 'lucide-react';
import { api } from '@/lib/api/client';
import { cn } from '@/lib/utils';
import { ds } from '@/lib/design-system';

// Display-only mirror of FEES.TRANSFER = 0.0146 in server/economy/fees.js.
const TRANSFER_FEE_RATE = 0.0146;

type Step = 'input' | 'confirm' | 'loading' | 'success' | 'error';

export function TransferFlow({
  balance,
  mode = 'inline',
  onClose,
  onSuccess,
}: {
  balance: number;
  mode?: 'inline' | 'modal';
  onClose?: () => void;
  onSuccess: () => void;
}) {
  const [recipientId, setRecipientId] = useState('');
  const [amount, setAmount] = useState('');
  const [step, setStep] = useState<Step>('input');
  const [errorMessage, setErrorMessage] = useState('');
  const transferAbortRef = useRef<AbortController | null>(null);

  useEffect(() => {
    return () => {
      transferAbortRef.current?.abort();
    };
  }, []);

  const parsedAmount = parseInt(amount, 10) || 0;
  const fee = Math.ceil(parsedAmount * TRANSFER_FEE_RATE * 100) / 100;
  const netAmount = Math.round((parsedAmount - fee) * 100) / 100;
  const isValid = parsedAmount > 0 && parsedAmount <= balance && recipientId.trim().length > 0;

  const handleTransfer = async () => {
    if (!isValid) return;
    transferAbortRef.current?.abort();
    const abortController = new AbortController();
    transferAbortRef.current = abortController;
    setStep('loading');
    try {
      const res = await api.post(
        '/api/economy/transfer',
        { to: recipientId.trim(), amount: parsedAmount },
        { signal: abortController.signal },
      );
      const data = res.data as { ok?: boolean; error?: string };
      if (data.ok) {
        setStep('success');
        onSuccess();
      } else {
        setErrorMessage(data.error?.replace(/_/g, ' ') || 'Transfer failed');
        setStep('error');
      }
    } catch (err: unknown) {
      setErrorMessage(
        (err as { response?: { data?: { error?: string } } })?.response?.data?.error?.replace(
          /_/g,
          ' ',
        ) || 'Transfer failed. Please try again.',
      );
      setStep('error');
    }
  };

  const body = (
    <>
      {step === 'input' && (
        <div className="space-y-5">
          <div className="flex items-center gap-3">
            <div className="p-2 rounded-lg bg-[var(--lens-accent)]/20">
              <Send className="w-5 h-5" style={{ color: 'var(--lens-accent)' }} />
            </div>
            <div>
              <h3 className={ds.heading3}>Send CC</h3>
              <p className={ds.textMuted}>Pay another Concord user from your balance</p>
            </div>
          </div>

          <div>
            <label className={ds.label}>Recipient user ID</label>
            <input
              type="text"
              value={recipientId}
              onChange={(e) => setRecipientId(e.target.value)}
              placeholder="Enter user ID"
              className={cn(ds.input, 'font-mono')}
            />
          </div>

          <div>
            <label className={ds.label}>Amount</label>
            <div className="relative">
              <Coins className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
              <input
                type="text"
                inputMode="numeric"
                value={amount}
                onChange={(e) => setAmount(e.target.value.replace(/\D/g, ''))}
                placeholder="0"
                className={cn(ds.input, 'pl-10 font-mono')}
              />
            </div>
            <p className="text-xs text-gray-400 mt-1">Available: {balance.toLocaleString()} CC</p>
          </div>

          {parsedAmount > 0 && isValid && (
            <div className="bg-lattice-deep rounded-lg p-4 border border-lattice-border space-y-2">
              <div className="flex items-center justify-between text-sm">
                <span className="text-gray-400">Amount</span>
                <span className="font-mono text-white">{parsedAmount.toLocaleString()} CC</span>
              </div>
              <div className="flex items-center justify-between text-sm">
                <span className="text-gray-400 flex items-center gap-1">
                  Fee (1.46%)
                  <Info className="w-3 h-3" />
                </span>
                <span className="font-mono text-red-400">-{fee.toFixed(2)} CC</span>
              </div>
              <div className="border-t border-lattice-border pt-2 flex items-center justify-between">
                <span className="text-sm font-medium text-white">Recipient gets</span>
                <span className="font-mono text-lg font-bold" style={{ color: 'var(--lens-accent)' }}>
                  {netAmount.toFixed(2)} CC
                </span>
              </div>
            </div>
          )}

          <button
            type="button"
            onClick={() => setStep('confirm')}
            disabled={!isValid}
            className={cn(
              ds.btnBase,
              'w-full px-6 py-3',
              isValid
                ? 'bg-[var(--lens-accent)]/20 text-[var(--lens-accent)] border border-[var(--lens-accent)]/50 hover:bg-[var(--lens-accent)]/30'
                : 'bg-lattice-elevated text-gray-400 cursor-not-allowed',
            )}
          >
            <Send className="w-5 h-5" />
            {isValid ? `Send ${parsedAmount.toLocaleString()} CC` : 'Enter transfer details'}
          </button>
        </div>
      )}

      {step === 'confirm' && (
        <div className="space-y-5">
          <div className="flex items-center gap-3">
            <div className="p-2 rounded-lg bg-amber-500/20">
              <Info className="w-5 h-5 text-amber-400" />
            </div>
            <div>
              <h3 className={ds.heading3}>Confirm transfer</h3>
              <p className={ds.textMuted}>Review before sending</p>
            </div>
          </div>
          <div className="bg-lattice-deep rounded-lg p-4 border border-lattice-border space-y-2">
            <div className="flex items-center justify-between text-sm">
              <span className="text-gray-400">To</span>
              <span className="font-mono text-white truncate max-w-[200px]">{recipientId}</span>
            </div>
            <div className="flex items-center justify-between text-sm">
              <span className="text-gray-400">Amount</span>
              <span className="font-mono text-white">{parsedAmount.toLocaleString()} CC</span>
            </div>
            <div className="flex items-center justify-between text-sm">
              <span className="text-gray-400">Fee (1.46%)</span>
              <span className="font-mono text-red-400">-{fee.toFixed(2)} CC</span>
            </div>
            <div className="border-t border-lattice-border pt-2 flex items-center justify-between">
              <span className="text-sm font-medium text-white">Net</span>
              <span className="font-mono text-lg font-bold" style={{ color: 'var(--lens-accent)' }}>
                {netAmount.toFixed(2)} CC
              </span>
            </div>
          </div>
          <div className="flex gap-3">
            <button type="button" onClick={() => setStep('input')} className={cn(ds.btnSecondary, 'flex-1')}>
              Back
            </button>
            <button
              type="button"
              onClick={handleTransfer}
              className={cn(
                ds.btnBase,
                'flex-1 px-6 py-2 bg-[var(--lens-accent)]/20 text-[var(--lens-accent)] border border-[var(--lens-accent)]/50 hover:bg-[var(--lens-accent)]/30',
              )}
            >
              <CheckCircle2 className="w-4 h-4" />
              Confirm
            </button>
          </div>
        </div>
      )}

      {step === 'loading' && (
        <div className="text-center py-12">
          <Loader2 className="w-10 h-10 mx-auto animate-spin" style={{ color: 'var(--lens-accent)' }} />
          <p className="text-gray-400 mt-3">Processing transfer...</p>
        </div>
      )}

      {step === 'success' && (
        <div className="text-center py-8 space-y-4">
          <CheckCircle2 className="w-16 h-16 mx-auto" style={{ color: 'var(--lens-accent)' }} />
          <h3 className={ds.heading2}>Transfer complete</h3>
          <p className="text-gray-400">
            <span className="font-mono font-bold" style={{ color: 'var(--lens-accent)' }}>
              {netAmount.toFixed(2)} CC
            </span>{' '}
            sent to <span className="text-white font-mono">{recipientId}</span>
          </p>
          <button
            type="button"
            onClick={() => {
              setStep('input');
              setAmount('');
              setRecipientId('');
              onClose?.();
            }}
            className={cn(ds.btnPrimary, 'mt-4')}
          >
            Done
          </button>
        </div>
      )}

      {step === 'error' && (
        <div className="text-center py-8 space-y-4">
          <XCircle className="w-16 h-16 mx-auto text-red-400" />
          <h3 className={ds.heading2}>Transfer failed</h3>
          <p className="text-gray-400" role="alert">
            {errorMessage}
          </p>
          <button type="button" onClick={() => setStep('input')} className={cn(ds.btnSecondary, 'mt-4')}>
            Try again
          </button>
        </div>
      )}
    </>
  );

  if (mode === 'modal') {
    return (
      <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
        <div
          className="absolute inset-0 bg-black/70 backdrop-blur-sm"
          onClick={onClose}
          aria-hidden="true"
          role="button"
          tabIndex={0}
          onKeyDown={(e) => {
            if (e.key === 'Enter' || e.key === ' ') {
              e.preventDefault();
              onClose?.();
            }
          }}
        />
        <motion.div
          initial={{ opacity: 0, scale: 0.95, y: 20 }}
          animate={{ opacity: 1, scale: 1, y: 0 }}
          exit={{ opacity: 0, scale: 0.95, y: 20 }}
          className="relative w-full max-w-lg bg-lattice-surface border border-lattice-border rounded-xl shadow-2xl p-6 max-h-[85vh] overflow-y-auto"
        >
          {body}
        </motion.div>
      </div>
    );
  }

  return <div className={ds.panel}>{body}</div>;
}
