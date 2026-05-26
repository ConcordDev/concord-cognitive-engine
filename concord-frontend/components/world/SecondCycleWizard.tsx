'use client';

/**
 * SecondCycleWizard — Wave 7 / T3.2.
 *
 * Light-weight onboarding checklist for the new UI surfaces. Auto-opens
 * once per session if the player has at least 1 step incomplete + has
 * been playing long enough that they're past the First Cycle. Refreshes
 * on `concordia:ui-opened` events (dispatched by hotkey handlers).
 */

import { useCallback, useEffect, useState } from 'react';

interface Step {
  key: string;
  label: string;
  complete: boolean;
}

interface ProgressResponse {
  ok: boolean;
  tutorial: string;
  steps: Step[];
  completeCount: number;
  totalCount: number;
  complete: boolean;
  currentStep: string | null;
}

const SESSION_KEY = 'concordia:second-cycle-dismissed:v1';

export default function SecondCycleWizard() {
  const [progress, setProgress] = useState<ProgressResponse | null>(null);
  const [open, setOpen] = useState(false);

  const fetchProgress = useCallback(async () => {
    try {
      const r = await fetch('/api/tutorial/second-cycle', { credentials: 'same-origin' });
      if (!r.ok) return;
      const j = (await r.json()) as ProgressResponse;
      if (j?.ok) setProgress(j);
    } catch { /* best-effort */ }
  }, []);

  // Initial load — open the wizard if not already complete + not session-dismissed.
  useEffect(() => {
    let cancelled = false;
    void (async () => {
      await fetchProgress();
      if (cancelled) return;
      const dismissed = typeof window !== 'undefined' && window.sessionStorage.getItem(SESSION_KEY) === '1';
      // We need progress to decide — fetchProgress sets state so a small
      // microtask later we read it. For first paint we check the response.
      setOpen(!dismissed);
    })();
    return () => { cancelled = true; };
  }, [fetchProgress]);

  // Refresh on each UI-open event.
  useEffect(() => {
    const onChange = () => { void fetchProgress(); };
    window.addEventListener('concordia:ui-opened', onChange);
    window.addEventListener('concordia:bestiary-changed', onChange);
    window.addEventListener('concordia:loadout-changed', onChange);
    return () => {
      window.removeEventListener('concordia:ui-opened', onChange);
      window.removeEventListener('concordia:bestiary-changed', onChange);
      window.removeEventListener('concordia:loadout-changed', onChange);
    };
  }, [fetchProgress]);

  const dismiss = useCallback(() => {
    setOpen(false);
    try { window.sessionStorage.setItem(SESSION_KEY, '1'); } catch { /* ok */ }
  }, []);

  if (!open || !progress) return null;
  if (progress.complete) return null;

  return (
    <div className="pointer-events-none fixed bottom-3 left-1/2 -translate-x-1/2 z-30 w-[460px]">
      <div className="pointer-events-auto bg-slate-950/90 border border-cyan-500/40 rounded-lg p-3 backdrop-blur-md">
        <div className="flex items-center justify-between mb-2">
          <div className="text-[10px] uppercase tracking-widest text-cyan-300 font-bold">
            Second Cycle · {progress.completeCount}/{progress.totalCount}
          </div>
          <button onClick={dismiss} className="text-slate-400 hover:text-white text-xs">✕</button>
        </div>
        <div className="space-y-1">
          {progress.steps.map((s) => (
            <div
              key={s.key}
              className={`flex items-center gap-2 text-xs ${
                s.complete ? 'text-emerald-300 line-through opacity-75' : 'text-white'
              }`}
            >
              <span className={s.complete ? 'text-emerald-400' : 'text-slate-500'}>
                {s.complete ? '✓' : '○'}
              </span>
              <span>{s.label}</span>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
