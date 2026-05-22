'use client';

/**
 * CookMode — Paprika 3 parity. Full-screen, step-by-step cooking view
 * with a per-step timer. Steps + ingredients come from a real recipe
 * loaded via cooking.recipes-get — no mock data.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  ChevronLeft, ChevronRight, X, Timer, Play, Pause, RotateCcw, CheckCircle2,
} from 'lucide-react';
import { cn } from '@/lib/utils';

interface Ingredient { name: string; qty: number | null; unit: string }
export interface CookModeRecipe {
  id: string;
  title: string;
  servings: number;
  ingredients: Ingredient[];
  steps: string[];
}

interface CookModeProps {
  recipe: CookModeRecipe;
  onClose: () => void;
}

// Pull "X minutes" / "X min" out of a step so the per-step timer can
// pre-fill itself from the recipe's own wording.
function minutesInStep(step: string): number {
  const m = /(\d+)\s*(?:minute|min)\b/i.exec(step);
  return m ? Math.max(0, Number(m[1])) : 0;
}

export function CookMode({ recipe, onClose }: CookModeProps) {
  const [stepIdx, setStepIdx] = useState(0);
  const [done, setDone] = useState<Set<number>>(new Set());
  const steps = useMemo(
    () => (recipe.steps.length ? recipe.steps : ['This recipe has no steps yet.']),
    [recipe.steps],
  );
  const lastStep = stepIdx >= steps.length - 1;

  // ── Per-step timer ──
  const suggested = useMemo(() => minutesInStep(steps[stepIdx]) * 60, [steps, stepIdx]);
  const [secondsLeft, setSecondsLeft] = useState(suggested);
  const [timerOn, setTimerOn] = useState(false);
  const [timerDone, setTimerDone] = useState(false);
  const tickRef = useRef<ReturnType<typeof setInterval> | null>(null);

  useEffect(() => {
    setSecondsLeft(suggested);
    setTimerOn(false);
    setTimerDone(false);
  }, [suggested]);

  useEffect(() => {
    if (timerOn) {
      tickRef.current = setInterval(() => {
        setSecondsLeft((s) => {
          if (s <= 1) {
            setTimerOn(false);
            setTimerDone(true);
            return 0;
          }
          return s - 1;
        });
      }, 1000);
    } else if (tickRef.current) {
      clearInterval(tickRef.current);
    }
    return () => { if (tickRef.current) clearInterval(tickRef.current); };
  }, [timerOn]);

  const go = useCallback((dir: -1 | 1) => {
    setStepIdx((i) => Math.min(steps.length - 1, Math.max(0, i + dir)));
  }, [steps.length]);

  const markDone = useCallback(() => {
    setDone((prev) => { const s = new Set(prev); s.add(stepIdx); return s; });
    if (!lastStep) go(1);
  }, [stepIdx, lastStep, go]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
      else if (e.key === 'ArrowRight') go(1);
      else if (e.key === 'ArrowLeft') go(-1);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [go, onClose]);

  const mm = Math.floor(secondsLeft / 60).toString().padStart(2, '0');
  const ss = (secondsLeft % 60).toString().padStart(2, '0');
  const progress = ((stepIdx + 1) / steps.length) * 100;

  return (
    <div className="fixed inset-0 z-[60] flex flex-col bg-[#0b0d12]">
      {/* Header */}
      <header className="flex items-center gap-3 border-b border-white/10 px-5 py-3">
        <div className="min-w-0 flex-1">
          <div className="truncate text-sm font-semibold text-white">{recipe.title}</div>
          <div className="text-[11px] text-gray-500">
            Cook mode · serves {recipe.servings} · step {stepIdx + 1} of {steps.length}
          </div>
        </div>
        <button
          onClick={onClose}
          className="inline-flex items-center gap-1 rounded border border-white/10 px-2.5 py-1 text-xs text-gray-300 hover:bg-white/[0.05]"
        >
          <X className="w-3.5 h-3.5" /> Exit
        </button>
      </header>

      {/* Progress bar */}
      <div className="h-1 w-full bg-white/5">
        <div className="h-full bg-orange-400 transition-all" style={{ width: `${progress}%` }} />
      </div>

      <div className="flex flex-1 flex-col overflow-hidden lg:flex-row">
        {/* Step panel */}
        <div className="flex flex-1 flex-col items-center justify-center gap-6 p-6 lg:p-12">
          <div className="text-[11px] uppercase tracking-widest text-orange-400">Step {stepIdx + 1}</div>
          <p className="max-w-2xl text-center text-xl leading-relaxed text-white lg:text-2xl">
            {steps[stepIdx]}
          </p>

          {/* Per-step timer */}
          <div className="flex flex-col items-center gap-2 rounded-xl border border-orange-500/20 bg-black/40 px-6 py-4">
            <div className="flex items-center gap-1.5 text-[11px] uppercase tracking-wider text-gray-500">
              <Timer className="w-3.5 h-3.5" /> Step timer
            </div>
            <div className={cn('font-mono text-4xl font-bold', timerDone ? 'animate-pulse text-rose-400' : 'text-white')}>
              {timerDone ? 'Done!' : `${mm}:${ss}`}
            </div>
            <div className="flex items-center gap-2">
              <button
                onClick={() => setSecondsLeft((s) => Math.max(0, s - 60))}
                className="rounded border border-white/10 px-2 py-1 text-xs text-gray-300 hover:bg-white/[0.05]"
              >−1m</button>
              <button
                onClick={() => setSecondsLeft((s) => s + 60)}
                className="rounded border border-white/10 px-2 py-1 text-xs text-gray-300 hover:bg-white/[0.05]"
              >+1m</button>
              <button
                onClick={() => { if (timerDone) { setSecondsLeft(suggested); setTimerDone(false); } else setTimerOn((v) => !v); }}
                disabled={!timerDone && secondsLeft === 0}
                className="inline-flex items-center gap-1 rounded bg-orange-500 px-3 py-1 text-xs font-semibold text-black hover:bg-orange-400 disabled:opacity-40"
              >
                {timerDone ? <RotateCcw className="w-3 h-3" /> : timerOn ? <Pause className="w-3 h-3" /> : <Play className="w-3 h-3" />}
                {timerDone ? 'Reset' : timerOn ? 'Pause' : 'Start'}
              </button>
            </div>
          </div>

          {/* Navigation */}
          <div className="flex items-center gap-3">
            <button
              onClick={() => go(-1)}
              disabled={stepIdx === 0}
              className="inline-flex items-center gap-1 rounded border border-white/10 px-4 py-2 text-sm text-gray-300 hover:bg-white/[0.05] disabled:opacity-30"
            >
              <ChevronLeft className="w-4 h-4" /> Back
            </button>
            <button
              onClick={markDone}
              className={cn(
                'inline-flex items-center gap-1.5 rounded px-5 py-2 text-sm font-semibold',
                done.has(stepIdx) ? 'border border-emerald-500/40 text-emerald-300' : 'bg-orange-500 text-black hover:bg-orange-400',
              )}
            >
              <CheckCircle2 className="w-4 h-4" />
              {lastStep ? 'Finish' : done.has(stepIdx) ? 'Done' : 'Done · next'}
            </button>
            {!lastStep && (
              <button
                onClick={() => go(1)}
                className="inline-flex items-center gap-1 rounded border border-white/10 px-4 py-2 text-sm text-gray-300 hover:bg-white/[0.05]"
              >
                Next <ChevronRight className="w-4 h-4" />
              </button>
            )}
          </div>
        </div>

        {/* Ingredients sidebar */}
        <aside className="border-t border-white/10 bg-black/30 p-5 lg:w-72 lg:overflow-y-auto lg:border-l lg:border-t-0">
          <div className="mb-2 text-[11px] uppercase tracking-wider text-gray-500">Ingredients</div>
          {recipe.ingredients.length === 0 ? (
            <p className="text-xs text-gray-600">No ingredients listed.</p>
          ) : (
            <ul className="space-y-1.5">
              {recipe.ingredients.map((ing, i) => (
                <li key={i} className="flex items-baseline gap-2 text-sm">
                  <span className="w-16 shrink-0 text-right font-mono text-orange-300">
                    {ing.qty ?? ''}{ing.unit ? ` ${ing.unit}` : ''}
                  </span>
                  <span className="text-gray-200">{ing.name}</span>
                </li>
              ))}
            </ul>
          )}
        </aside>
      </div>
    </div>
  );
}

export default CookMode;
