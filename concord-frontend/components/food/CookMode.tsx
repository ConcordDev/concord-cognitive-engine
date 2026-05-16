'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { ChevronLeft, ChevronRight, Pause, Play, X, Volume2, VolumeX, ChefHat } from 'lucide-react';
import { cn } from '@/lib/utils';

export interface CookStep {
  order: number;
  instruction: string;
  timerSec?: number;
  ingredients?: string[];
}

interface CookModeProps {
  recipeTitle: string;
  servings: number;
  steps: CookStep[];
  open: boolean;
  onClose: () => void;
}

export function CookMode({ recipeTitle, servings, steps, open, onClose }: CookModeProps) {
  const [idx, setIdx] = useState(0);
  const [timer, setTimer] = useState<number>(0);
  const [timerRunning, setTimerRunning] = useState(false);
  const [voiceOn, setVoiceOn] = useState(false);
  const wakeLockRef = useRef<{ release?: () => void } | null>(null);

  useEffect(() => {
    if (!open) return;
    // Wake Lock — keep screen on during cooking. Best effort.
    let lock: { release?: () => void } | null = null;
    (async () => {
      try {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const wl = (navigator as any)?.wakeLock;
        if (wl?.request) {
          lock = await wl.request('screen');
          wakeLockRef.current = lock;
        }
      } catch { /* not supported */ }
    })();
    return () => {
      try { lock?.release?.(); } catch { /* noop */ }
    };
  }, [open]);

  useEffect(() => {
    if (!timerRunning) return;
    const i = setInterval(() => setTimer(t => Math.max(0, t - 1)), 1000);
    return () => clearInterval(i);
  }, [timerRunning]);

  useEffect(() => {
    if (timer === 0 && timerRunning) {
      setTimerRunning(false);
      try { new Audio('data:audio/wav;base64,UklGRkQAAABXQVZFZm10IBAAAAABAAEAQB8AAEAfAAABAAgAZGF0YSAAAAAA').play(); } catch { /* noop */ }
      if (voiceOn && typeof window !== 'undefined' && 'speechSynthesis' in window) {
        try { window.speechSynthesis.speak(new SpeechSynthesisUtterance('Timer done')); } catch { /* noop */ }
      }
    }
  }, [timer, timerRunning, voiceOn]);

  const step = steps[idx];

  const next = useCallback(() => {
    if (idx + 1 < steps.length) {
      setIdx(idx + 1);
      if (steps[idx + 1]?.timerSec) {
        setTimer(steps[idx + 1].timerSec || 0);
        setTimerRunning(true);
      }
    }
  }, [idx, steps]);
  const prev = useCallback(() => setIdx(i => Math.max(0, i - 1)), []);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'ArrowRight' || e.key === ' ') { e.preventDefault(); next(); }
      else if (e.key === 'ArrowLeft') { e.preventDefault(); prev(); }
      else if (e.key === 'Escape') { onClose(); }
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [open, next, prev, onClose]);

  useEffect(() => {
    if (voiceOn && step && typeof window !== 'undefined' && 'speechSynthesis' in window) {
      try { window.speechSynthesis.cancel(); window.speechSynthesis.speak(new SpeechSynthesisUtterance(step.instruction)); } catch { /* noop */ }
    }
  }, [idx, voiceOn, step]);

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-[200] bg-[#0a0e17] flex flex-col">
      <header className="flex items-center gap-3 px-6 py-3 border-b border-white/10">
        <ChefHat className="w-5 h-5 text-cyan-400" />
        <div className="flex-1 min-w-0">
          <div className="text-lg font-bold text-white truncate">{recipeTitle}</div>
          <div className="text-xs text-gray-500">Serves {servings} · Step {idx + 1} of {steps.length}</div>
        </div>
        <button onClick={() => setVoiceOn(v => !v)} title="Toggle voice" className={cn('p-2 rounded', voiceOn ? 'bg-cyan-500/20 text-cyan-300' : 'text-gray-400 hover:text-white')}>
          {voiceOn ? <Volume2 className="w-5 h-5" /> : <VolumeX className="w-5 h-5" />}
        </button>
        <button onClick={onClose} className="p-2 rounded text-gray-400 hover:text-white" title="Exit (Esc)">
          <X className="w-5 h-5" />
        </button>
      </header>

      <div className="flex-1 flex">
        {step?.ingredients && step.ingredients.length > 0 && (
          <aside className="w-72 border-r border-white/10 p-6">
            <h3 className="text-xs uppercase tracking-wider text-gray-500 mb-3">For this step</h3>
            <ul className="space-y-2 text-sm text-gray-200">
              {step.ingredients.map((ing, i) => (
                <li key={i} className="flex items-start gap-2">
                  <span className="text-cyan-400 mt-1">•</span>
                  <span>{ing}</span>
                </li>
              ))}
            </ul>
          </aside>
        )}

        <div className="flex-1 flex flex-col items-center justify-center px-8 py-12 text-center">
          {step ? (
            <>
              <div className="text-7xl font-bold text-cyan-300 mb-6 tabular-nums">{step.order}</div>
              <p className="text-3xl text-white max-w-3xl leading-snug">{step.instruction}</p>
              {step.timerSec != null && step.timerSec > 0 && (
                <div className="mt-12 flex items-center gap-4">
                  <button
                    onClick={() => { if (timer === 0) setTimer(step.timerSec || 0); setTimerRunning(v => !v); }}
                    className="inline-flex items-center gap-2 px-6 py-3 rounded-full bg-cyan-500 text-black font-bold hover:bg-cyan-400 text-xl"
                  >
                    {timerRunning ? <Pause className="w-6 h-6" /> : <Play className="w-6 h-6" />}
                    {Math.floor(timer / 60)}:{String(timer % 60).padStart(2, '0')}
                  </button>
                  <button
                    onClick={() => { setTimer(step.timerSec || 0); setTimerRunning(true); }}
                    className="px-4 py-2 text-sm rounded border border-white/10 text-gray-300 hover:text-white"
                  >Reset</button>
                </div>
              )}
            </>
          ) : (
            <div className="text-2xl text-gray-400">No more steps — enjoy your meal!</div>
          )}
        </div>
      </div>

      <footer className="flex items-center gap-3 px-6 py-4 border-t border-white/10">
        <button
          onClick={prev}
          disabled={idx === 0}
          className="inline-flex items-center gap-2 px-4 py-2 rounded bg-white/10 hover:bg-white/20 text-white disabled:opacity-30"
        >
          <ChevronLeft className="w-4 h-4" /> Back (←)
        </button>
        <div className="flex-1 mx-4">
          <div className="h-1.5 bg-white/10 rounded-full overflow-hidden">
            <div className="h-full bg-cyan-500" style={{ width: `${((idx + 1) / steps.length) * 100}%` }} />
          </div>
        </div>
        <button
          onClick={next}
          disabled={idx + 1 >= steps.length}
          className="inline-flex items-center gap-2 px-6 py-2 rounded bg-cyan-500 text-black font-bold hover:bg-cyan-400 disabled:opacity-30"
        >
          Next (→) <ChevronRight className="w-4 h-4" />
        </button>
      </footer>
    </div>
  );
}

export default CookMode;
