'use client';
// Loads a run once, then follows its events (CKPT-17). No polling, no timers.
import { useCallback, useEffect, useRef, useState } from 'react';
import {
  fetchRun, openRunEvents, reduceRun, sendDecision, runAction, TERMINAL, EMPTY_VIEW,
  type PublicRun, type PublicStep, type RunView, type CockpitEvent,
} from './run-client';

export type CockpitRunHook = RunView & {
  decided: 'Approved' | 'Rejected' | null;
  loading: boolean;
  approve: (edited?: Record<string, unknown>, dontAskAgain?: boolean) => Promise<void>;
  reject: () => Promise<void>;
  answer: (text: string) => Promise<void>;
  maybeDone: (happened: boolean) => Promise<void>;
  pause: () => Promise<void>;
  resume: () => Promise<void>;
  cancel: () => Promise<void>;
  busy: boolean;
};

export function useCockpitRun(runId: string | null, opts?: { onFinished?: (run: PublicRun, steps: PublicStep[]) => void }): CockpitRunHook {
  const [view, setView] = useState<RunView>(EMPTY_VIEW);
  const [busy, setBusy] = useState(false);
  const [loading, setLoading] = useState(!!runId);
  const [decided, setDecided] = useState<'Approved' | 'Rejected' | null>(null);
  const viewRef = useRef(view);
  viewRef.current = view;
  const finishedRef = useRef(false);
  const onFinishedRef = useRef(opts?.onFinished);
  onFinishedRef.current = opts?.onFinished;

  const finishIfTerminal = useCallback((v: RunView) => {
    if (!finishedRef.current && v.run && TERMINAL.includes(v.run.status)) {
      finishedRef.current = true;
      onFinishedRef.current?.(v.run, v.steps);
    }
  }, []);

  const reload = useCallback(async (id: string, notify = true) => {
    const r = await fetchRun(id);
    if (!r.ok) { setView((v) => ({ ...v, error: r.error })); return null; }
    const next: RunView = { run: r.run, steps: r.steps, confirm: viewRef.current.confirm, error: null };
    if (r.run.status !== 'awaiting_confirm') next.confirm = null;
    setView(next);
    // A run that was already finished when the card opened is history, not news:
    // onFinished only fires for a run seen to finish while the card is open.
    if (notify) finishIfTerminal(next);
    else if (TERMINAL.includes(r.run.status)) finishedRef.current = true;
    return next;
  }, [finishIfTerminal]);

  useEffect(() => {
    if (!runId) { setView(EMPTY_VIEW); setLoading(false); return undefined; }
    let closed = false;
    let close: (() => void) | null = null;
    finishedRef.current = false;
    setLoading(true);
    setView(EMPTY_VIEW);
    (async () => {
      const first = await reload(runId, false);
      if (closed) return;
      setLoading(false);
      if (!first || !first.run || TERMINAL.includes(first.run.status)) return;
      close = openRunEvents(
        runId,
        (e: CockpitEvent) => {
          if (closed) return;
          setView((v) => { const n = reduceRun(v, e); finishIfTerminal(n); return n; });
          if (e.type === 'cockpit:confirm') setDecided(null);
        },
        async () => {
          if (closed) return;
          await reload(runId);
          setView((v) => ({ ...v, error: 'Lost the live connection. Showing the last saved state.' }));
        },
      );
    })();
    return () => { closed = true; close?.(); };
  }, [runId, reload, finishIfTerminal]);

  const decide = useCallback(async (body: Parameters<typeof sendDecision>[1], label: 'Approved' | 'Rejected' | null) => {
    const id = viewRef.current.run?.id;
    if (!id) return;
    const prev = viewRef.current;
    setBusy(true);
    setDecided(label);
    setView({ ...prev, confirm: null, error: null });
    const r = await sendDecision(id, body);
    if (!r.ok) {
      setView({ ...prev, error: r.error || 'That did not go through.' });
      setDecided(null);
    } else {
      await reload(id);
    }
    setBusy(false);
  }, [reload]);

  const stepId = () => viewRef.current.confirm?.stepId || '';
  const act = useCallback(async (action: 'pause' | 'resume' | 'cancel') => {
    const id = viewRef.current.run?.id;
    if (!id) return;
    const prev = viewRef.current;
    setBusy(true);
    if (action === 'cancel' && prev.run) setView({ ...prev, run: { ...prev.run, status: 'cancelled' }, confirm: null });
    const r = await runAction(id, action);
    if (!r.ok) setView({ ...prev, error: r.error || 'That did not go through.' });
    else await reload(id);
    setBusy(false);
  }, [reload]);

  return {
    ...view, decided, loading, busy,
    approve: (edited, dontAskAgain) => decide({ stepId: stepId(), decision: 'approve', ...(edited ? { editedArgs: edited } : {}), ...(dontAskAgain ? { dontAskAgain: true } : {}) }, 'Approved'),
    reject: () => decide({ stepId: stepId(), decision: 'reject' }, 'Rejected'),
    answer: (text) => decide({ stepId: stepId(), decision: 'answer', answer: text }, null),
    maybeDone: (happened) => decide({ stepId: stepId(), decision: happened ? 'mark_done' : 'run_again' }, null),
    pause: () => act('pause'),
    resume: () => act('resume'),
    cancel: () => act('cancel'),
  };
}
