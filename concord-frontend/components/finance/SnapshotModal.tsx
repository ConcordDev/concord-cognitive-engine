'use client';

/**
 * SnapshotModal — record finance.net-worth-snapshot (extracted from finance page).
 */

import { useState } from 'react';
import { motion } from 'framer-motion';
import { Loader2, Plus, X } from 'lucide-react';
import { useMacroDispatchFeedback } from '@/hooks/useMacroDispatchFeedback';

export function SnapshotModal({ onClose, onRecorded }: { onClose: () => void; onRecorded: () => void }) {
  const { status, error, dispatch } = useMacroDispatchFeedback();
  const [form, setForm] = useState({ cash: '', investments: '', realEstate: '', crypto: '', liabilities: '' });
  const busy = status === 'dispatched' || status === 'running';

  const set = (k: keyof typeof form) => (e: React.ChangeEvent<HTMLInputElement>) =>
    setForm((f) => ({ ...f, [k]: e.target.value }));

  const submit = async () => {
    if (busy) return;
    const input = {
      cash: parseFloat(form.cash) || 0,
      investments: parseFloat(form.investments) || 0,
      realEstate: parseFloat(form.realEstate) || 0,
      crypto: parseFloat(form.crypto) || 0,
      liabilities: parseFloat(form.liabilities) || 0,
    };
    const res = await dispatch('finance', 'net-worth-snapshot', input);
    if (res) {
      onRecorded();
      onClose();
    }
  };

  const fields: { k: keyof typeof form; label: string }[] = [
    { k: 'cash', label: 'Cash' },
    { k: 'investments', label: 'Investments' },
    { k: 'realEstate', label: 'Real estate' },
    { k: 'crypto', label: 'Crypto' },
    { k: 'liabilities', label: 'Liabilities' },
  ];

  return (
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 backdrop-blur-sm p-4"
      onClick={onClose}
    >
      <motion.div
        initial={{ scale: 0.96, opacity: 0 }}
        animate={{ scale: 1, opacity: 1 }}
        exit={{ scale: 0.96, opacity: 0 }}
        onClick={(e) => e.stopPropagation()}
        className="w-full max-w-sm rounded-lg border border-lattice-border bg-lattice-surface p-5 font-mono"
        role="dialog"
        aria-modal="true"
        aria-label="Record net-worth snapshot"
      >
        <div className="flex items-center justify-between mb-4">
          <h3 className="text-sm font-semibold text-emerald-100">Record net-worth snapshot</h3>
          <button type="button" onClick={onClose} className="text-gray-400 hover:text-white" aria-label="Close">
            <X className="w-4 h-4" />
          </button>
        </div>
        <div className="space-y-2.5">
          {fields.map((f) => (
            <label key={f.k} className="flex items-center justify-between gap-3 text-xs">
              <span className="text-gray-400 w-24">{f.label}</span>
              <div className="relative flex-1">
                <span className="absolute left-2 top-1/2 -translate-y-1/2 text-gray-500">$</span>
                <input
                  type="number"
                  inputMode="decimal"
                  value={form[f.k]}
                  onChange={set(f.k)}
                  placeholder="0"
                  className="w-full pl-5 pr-2 py-1.5 rounded bg-lattice-deep border border-lattice-border text-right tabular-nums focus:outline-none focus:ring-1 focus:ring-emerald-500"
                />
              </div>
            </label>
          ))}
        </div>
        {status === 'error' && (
          <p className="mt-3 text-xs text-rose-300" role="alert">
            {error || 'Failed to record snapshot.'}
          </p>
        )}
        <button
          type="button"
          onClick={submit}
          disabled={busy}
          className="mt-4 w-full py-2.5 rounded bg-emerald-600 hover:bg-emerald-500 text-white text-sm font-semibold disabled:opacity-50 flex items-center justify-center gap-2 transition-colors"
        >
          {busy ? <Loader2 className="w-4 h-4 animate-spin" /> : <Plus className="w-4 h-4" />}
          {busy ? 'Recording…' : 'Record snapshot'}
        </button>
      </motion.div>
    </motion.div>
  );
}
