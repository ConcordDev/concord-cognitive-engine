'use client';

/**
 * RecallableAction — wraps a destructive-or-irreversible action (publish DTU,
 * send DM) so the caller gets a time-bounded "Recall" affordance.
 *
 * Usage:
 *
 *   const dmRecall = useRecallableAction({
 *     windowMs: 60_000,
 *     onUndo: async (token) => api.delete(`/api/social/dm/${token}`),
 *     label: 'DM',
 *   });
 *
 *   await dmRecall.run(async () => {
 *     const r = await api.post('/api/social/dm', body);
 *     return r.data.message.id; // returned id becomes the undo token
 *   });
 *
 *   <RecallSlot ctl={dmRecall} />  // renders the recall pill while window open
 */

import { useCallback, useEffect, useRef, useState } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import { Undo2, Check, AlertTriangle } from 'lucide-react';
import { cn } from '@/lib/utils';

interface UseRecallOpts {
  /** Time the recall pill stays available, in ms. */
  windowMs?: number;
  /** Called when the user clicks Recall. Receives the token returned from `run`. */
  onUndo: (token: string) => Promise<unknown> | unknown;
  /** Human label, e.g. "DM" / "Publish". */
  label: string;
}

type Status = 'idle' | 'open' | 'undoing' | 'undone' | 'failed' | 'expired';

export interface RecallController {
  status: Status;
  label: string;
  token: string | null;
  remainingMs: number;
  windowMs: number;
  error: string | null;
  run: (op: () => Promise<string | null | undefined>) => Promise<string | null | undefined>;
  recall: () => Promise<void>;
  dismiss: () => void;
}

export function useRecallableAction({ windowMs = 60_000, onUndo, label }: UseRecallOpts): RecallController {
  const [status, setStatus] = useState<Status>('idle');
  const [token, setToken] = useState<string | null>(null);
  const [remainingMs, setRemainingMs] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const expireRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const clearTimers = useCallback(() => {
    if (timerRef.current) { clearInterval(timerRef.current); timerRef.current = null; }
    if (expireRef.current) { clearTimeout(expireRef.current); expireRef.current = null; }
  }, []);

  useEffect(() => () => clearTimers(), [clearTimers]);

  const run = useCallback<RecallController['run']>(async (op) => {
    setError(null);
    setStatus('idle');
    const result = await op();
    if (!result) return result;
    clearTimers();
    setToken(result);
    setStatus('open');
    setRemainingMs(windowMs);
    const startedAt = Date.now();
    timerRef.current = setInterval(() => {
      const left = Math.max(0, windowMs - (Date.now() - startedAt));
      setRemainingMs(left);
    }, 250);
    expireRef.current = setTimeout(() => {
      clearTimers();
      setStatus((s) => (s === 'open' ? 'expired' : s));
    }, windowMs);
    return result;
  }, [windowMs, clearTimers]);

  const recall = useCallback(async () => {
    if (!token) return;
    setStatus('undoing');
    try {
      await onUndo(token);
      clearTimers();
      setStatus('undone');
      setRemainingMs(0);
      setTimeout(() => setStatus('idle'), 2500);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'recall failed');
      setStatus('failed');
    }
  }, [token, onUndo, clearTimers]);

  const dismiss = useCallback(() => {
    clearTimers();
    setStatus('idle');
    setRemainingMs(0);
    setError(null);
  }, [clearTimers]);

  return { status, label, token, remainingMs, windowMs, error, run, recall, dismiss };
}

export function RecallSlot({ ctl }: { ctl: RecallController }) {
  const show = ctl.status === 'open' || ctl.status === 'undoing' || ctl.status === 'undone' || ctl.status === 'failed';
  if (!show) return null;
  const pct = ctl.windowMs > 0 ? Math.max(0, Math.min(100, (ctl.remainingMs / ctl.windowMs) * 100)) : 0;
  const sec = Math.ceil(ctl.remainingMs / 1000);

  return (
    <AnimatePresence>
      <motion.div
        initial={{ opacity: 0, y: 4 }}
        animate={{ opacity: 1, y: 0 }}
        exit={{ opacity: 0, y: 4 }}
        className={cn(
          'flex items-center gap-2 rounded border px-2 py-1 text-[10px]',
          ctl.status === 'undone' ? 'border-emerald-500/40 bg-emerald-500/10 text-emerald-200'
          : ctl.status === 'failed' ? 'border-red-500/40 bg-red-500/10 text-red-200'
          : 'border-amber-500/40 bg-amber-500/10 text-amber-200',
        )}
        role="status"
      >
        {ctl.status === 'undone' && (<><Check className="w-3 h-3" /> {ctl.label} recalled.</>)}
        {ctl.status === 'failed' && (<><AlertTriangle className="w-3 h-3" /> Recall failed{ctl.error ? `: ${ctl.error}` : ''}.</>)}
        {(ctl.status === 'open' || ctl.status === 'undoing') && (
          <>
            <button
              type="button"
              onClick={ctl.recall}
              disabled={ctl.status === 'undoing'}
              className="flex items-center gap-1 px-1.5 py-0.5 rounded bg-amber-500/20 text-amber-100 hover:bg-amber-500/30 disabled:opacity-50"
            >
              <Undo2 className="w-3 h-3" />
              {ctl.status === 'undoing' ? 'Recalling…' : `Recall ${ctl.label}`}
            </button>
            <span className="font-mono text-amber-300">{sec}s</span>
            <div className="flex-1 h-1 bg-amber-900/40 rounded overflow-hidden min-w-[3rem]">
              <div className="h-full bg-amber-400 transition-[width] duration-200" style={{ width: `${pct}%` }} />
            </div>
            <button type="button" onClick={ctl.dismiss} className="text-amber-300 hover:text-amber-100 px-1" title="Dismiss">×</button>
          </>
        )}
      </motion.div>
    </AnimatePresence>
  );
}
