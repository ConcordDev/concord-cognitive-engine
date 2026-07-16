'use client';

import { useState, useEffect, useCallback } from 'react';
import { Gauge, History, RotateCcw, AlertTriangle, Loader2, X } from 'lucide-react';
import { lensRun } from '@/lib/api/client';

// ── Wire shape — exactly what anon.privacyBudgetStatus returns (real state
// read from getAnonState().budgets, never fabricated). ──
interface CallHistoryEntry {
  epsilon: number;
  purpose: string;
  timestamp: number;
}
interface BudgetStatus {
  totalSpent: number;
  totalBudget: number;
  remaining: number;
  percentUsed: number;
  callCount: number;
  callHistory: CallHistoryEntry[];
  createdAt: number | null;
  resetAt: number | null;
  exhausted: boolean;
}

interface PrivacyBudgetPanelProps {
  /**
   * Bump this (e.g. a counter incremented by the parent) after every
   * `differentialPrivacy` call to trigger a real refresh — the panel never
   * assumes its own stale snapshot reflects a call the parent just made.
   */
  refreshKey?: number | string;
}

export function PrivacyBudgetPanel({ refreshKey }: PrivacyBudgetPanelProps) {
  const [status, setStatus] = useState<BudgetStatus | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [confirmingReset, setConfirmingReset] = useState(false);
  const [resetting, setResetting] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const r = await lensRun('anon', 'privacyBudgetStatus', {});
      if (r.data?.ok && r.data.result) {
        setStatus(r.data.result as BudgetStatus);
        setError(null);
      } else {
        setError(r.data?.error || 'Failed to load privacy budget.');
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to load privacy budget.');
    }
    setLoading(false);
  }, []);

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [refreshKey]);

  const resetBudget = async () => {
    setResetting(true);
    try {
      const r = await lensRun('anon', 'privacyBudgetReset', {});
      if (r.data?.ok) {
        setConfirmingReset(false);
        setError(null);
        await load();
      } else {
        setError(r.data?.error || 'Reset failed.');
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Reset failed.');
    }
    setResetting(false);
  };

  return (
    <div
      data-testid="privacy-budget-panel"
      className="rounded-lg border border-lattice-border bg-lattice-deep p-3 space-y-2"
    >
      <div className="flex items-center justify-between">
        <h4 className="flex items-center gap-1.5 text-xs font-semibold text-gray-300">
          <Gauge className="h-3.5 w-3.5 text-neon-purple" /> Privacy Budget
        </h4>
        {status && !confirmingReset && (
          <button
            data-testid="privacy-budget-reset-btn"
            onClick={() => setConfirmingReset(true)}
            className="flex items-center gap-1 rounded bg-white/5 px-2 py-1 text-[11px] text-gray-400 hover:text-red-400"
          >
            <RotateCcw className="h-3 w-3" /> Reset budget
          </button>
        )}
      </div>

      {error && (
        <div
          data-testid="privacy-budget-error"
          className="flex items-center justify-between rounded border border-red-500/40 bg-red-500/10 px-2 py-1.5 text-[11px] text-red-300"
        >
          <span>{error}</span>
          <button onClick={() => setError(null)} aria-label="Dismiss budget error">
            <X className="h-3 w-3" />
          </button>
        </div>
      )}

      {loading && !status && (
        <div data-testid="privacy-budget-loading" className="flex items-center gap-2 text-[11px] text-gray-400">
          <Loader2 className="h-3.5 w-3.5 animate-spin" /> Loading budget…
        </div>
      )}

      {confirmingReset && (
        <div className="space-y-2 rounded border border-yellow-500/30 bg-yellow-900/10 p-2">
          <p className="flex items-center gap-1.5 text-[11px] text-yellow-200">
            <AlertTriangle className="h-3.5 w-3.5 flex-shrink-0" />
            This zeroes your accumulated epsilon spend and starts a new privacy-budget
            epoch. This cannot be undone.
          </p>
          <div className="flex gap-2">
            <button
              data-testid="privacy-budget-reset-confirm"
              onClick={resetBudget}
              disabled={resetting}
              className="flex-1 rounded bg-red-600/80 px-2 py-1 text-[11px] font-semibold text-white hover:bg-red-500 disabled:opacity-50"
            >
              {resetting ? <Loader2 className="mx-auto h-3 w-3 animate-spin" /> : 'Confirm reset'}
            </button>
            <button
              data-testid="privacy-budget-reset-cancel"
              onClick={() => setConfirmingReset(false)}
              disabled={resetting}
              className="flex-1 rounded border border-lattice-border px-2 py-1 text-[11px] text-gray-300 disabled:opacity-50"
            >
              Cancel
            </button>
          </div>
        </div>
      )}

      {status && (
        <>
          <div className="grid grid-cols-3 gap-2">
            <div className="rounded bg-lattice-surface p-2 text-center">
              <p data-testid="privacy-budget-spent" className="text-sm font-bold text-neon-purple">
                {status.totalSpent.toFixed(2)}
              </p>
              <p className="text-[10px] text-gray-400">Spent (ε)</p>
            </div>
            <div className="rounded bg-lattice-surface p-2 text-center">
              <p
                data-testid="privacy-budget-remaining"
                className={`text-sm font-bold ${status.exhausted ? 'text-red-400' : 'text-neon-green'}`}
              >
                {status.remaining.toFixed(2)}
              </p>
              <p className="text-[10px] text-gray-400">Remaining</p>
            </div>
            <div className="rounded bg-lattice-surface p-2 text-center">
              <p data-testid="privacy-budget-calls" className="text-sm font-bold text-white">
                {status.callCount}
              </p>
              <p className="text-[10px] text-gray-400">Calls</p>
            </div>
          </div>

          <div className="space-y-1">
            <div
              data-testid="privacy-budget-bar"
              className="h-1.5 w-full overflow-hidden rounded-full bg-lattice-surface"
            >
              <div
                className={`h-full rounded-full transition-all ${
                  status.exhausted
                    ? 'bg-red-500'
                    : status.percentUsed > 80
                    ? 'bg-yellow-500'
                    : 'bg-neon-purple'
                }`}
                style={{ width: `${Math.min(100, status.percentUsed)}%` }}
              />
            </div>
            <p className="text-[10px] text-gray-500">
              {status.totalSpent.toFixed(2)} / {status.totalBudget.toFixed(2)} ε used (
              {status.percentUsed.toFixed(1)}%)
              {status.exhausted && (
                <span data-testid="privacy-budget-exhausted" className="ml-1 text-red-400">
                  · budget exhausted — reset to continue meaningfully
                </span>
              )}
            </p>
          </div>

          {status.callHistory.length > 0 ? (
            <div className="space-y-1">
              <h5 className="flex items-center gap-1 text-[10px] font-semibold text-gray-400">
                <History className="h-3 w-3" /> Recent spend
              </h5>
              <div data-testid="privacy-budget-history" className="max-h-24 space-y-0.5 overflow-y-auto">
                {[...status.callHistory]
                  .reverse()
                  .slice(0, 10)
                  .map((h, i) => (
                    <div
                      key={`${h.timestamp}-${i}`}
                      className="flex items-center justify-between rounded bg-lattice-surface px-2 py-0.5 text-[10px] text-gray-300"
                    >
                      <span className="truncate">{h.purpose}</span>
                      <span className="text-neon-purple">ε {h.epsilon.toFixed(2)}</span>
                    </div>
                  ))}
              </div>
            </div>
          ) : (
            <p data-testid="privacy-budget-empty" className="text-[11px] text-gray-400">
              No differential-privacy calls yet this epoch.
            </p>
          )}
        </>
      )}
    </div>
  );
}
