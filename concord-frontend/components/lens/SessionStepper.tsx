'use client';

/**
 * SessionStepper — visual stepper for a multi-step lens session.
 *
 * Phase 5 of the UX completeness sprint. Pairs with useLensSession.
 * The lens declares an ordered list of steps; the stepper highlights
 * the current one + dispatches `onAdvance(toStep)` when the user clicks
 * an upcoming step.
 *
 * No fake state — every step transition is real and persists to
 * lens_session_events.
 */

import { CheckCircle2, Circle, ChevronRight } from 'lucide-react';
import { cn } from '@/lib/utils';

export interface SessionStep {
  id: string;
  label: string;
  description?: string;
}

export interface SessionStepperProps {
  steps: SessionStep[];
  currentStepId: string | null;
  stepCount?: number;
  /** Click a future step → advance to it. */
  onAdvance?: (toStepId: string) => void;
  className?: string;
}

export function SessionStepper({ steps, currentStepId, stepCount, onAdvance, className }: SessionStepperProps) {
  const currentIdx = currentStepId ? steps.findIndex(s => s.id === currentStepId) : -1;

  return (
    <ol className={cn('flex flex-wrap items-center gap-1.5 text-xs', className)}>
      {steps.map((s, i) => {
        const isDone = i < currentIdx;
        const isCurrent = i === currentIdx;
        const canAdvance = onAdvance && i > currentIdx;
        return (
          <li key={s.id} className="flex items-center gap-1.5">
            <button
              type="button"
              disabled={!canAdvance}
              onClick={canAdvance ? () => onAdvance!(s.id) : undefined}
              className={cn(
                'flex items-center gap-1 px-2 py-1 rounded transition-colors',
                isCurrent && 'bg-indigo-500/15 text-indigo-200 ring-1 ring-indigo-500/40 font-medium',
                isDone && 'text-zinc-400 hover:text-zinc-200',
                !isCurrent && !isDone && !canAdvance && 'text-zinc-600',
                canAdvance && 'text-zinc-500 hover:text-indigo-300 hover:bg-zinc-900/60 cursor-pointer',
              )}
              title={s.description}
              aria-current={isCurrent ? 'step' : undefined}
            >
              {isDone ? (
                <CheckCircle2 className="w-3.5 h-3.5 text-emerald-400" />
              ) : (
                <Circle className={cn('w-3.5 h-3.5', isCurrent ? 'text-indigo-300' : 'text-zinc-600')} />
              )}
              <span>{s.label}</span>
            </button>
            {i < steps.length - 1 && <ChevronRight className="w-3 h-3 text-zinc-700" aria-hidden="true" />}
          </li>
        );
      })}
      {typeof stepCount === 'number' && (
        <span className="ml-auto text-[10px] text-zinc-500 font-mono">
          {stepCount} transition{stepCount === 1 ? '' : 's'}
        </span>
      )}
    </ol>
  );
}

export default SessionStepper;
