'use client';

/**
 * FirstRunTour — 30-second guided first-run per lens.
 *
 * Phase 5 of the 10-dimension UX completeness sprint, landing early.
 *
 * Reads `manifest.firstRunGuide.steps[]`. Renders a small floating
 * coachmark for each step, optionally spotlighting a CSS selector
 * (rendered as a soft halo around the target element). Persists
 * completion in localStorage keyed by lensId so it never re-fires for
 * the same user on the same browser.
 *
 * Mounting:
 *   <FirstRunTour lensId="pharmacy" />
 *
 * Or auto-mounted via codemod inside every LensShell — degrades to
 * no-op when the lens has no firstRunGuide in its manifest.
 */

import { useEffect, useLayoutEffect, useState, useRef } from 'react';
import { Sparkles, ChevronRight, X } from 'lucide-react';
import { getLensManifest } from '@/lib/lenses/manifest';
import { isOnboardingComplete } from '@/lib/onboarding-state';
import { cn } from '@/lib/utils';

const STORAGE_PREFIX = 'concord:first-run-tour:';

export interface FirstRunTourProps {
  lensId: string;
  /** Force re-show even if previously completed. */
  force?: boolean;
  /** Called when the user finishes or skips. */
  onComplete?: (mode: 'finished' | 'skipped') => void;
}

interface SpotlightBox {
  top: number;
  left: number;
  width: number;
  height: number;
}

function readCompleted(lensId: string): boolean {
  if (typeof window === 'undefined') return false;
  try { return window.localStorage.getItem(STORAGE_PREFIX + lensId) === '1'; }
  catch { return false; }
}

function markCompleted(lensId: string) {
  if (typeof window === 'undefined') return;
  try { window.localStorage.setItem(STORAGE_PREFIX + lensId, '1'); }
  catch { /* ignore */ }
}

export function FirstRunTour({ lensId, force = false, onComplete }: FirstRunTourProps) {
  const manifest = getLensManifest(lensId);
  const guide = manifest?.firstRunGuide;

  const [active, setActive] = useState(false);
  const [step, setStep] = useState(0);
  const [spotlight, setSpotlight] = useState<SpotlightBox | null>(null);
  const overlayRef = useRef<HTMLDivElement | null>(null);

  // Decide whether to activate on mount.
  useEffect(() => {
    if (!guide || !Array.isArray(guide.steps) || guide.steps.length === 0) return;
    if (!force && readCompleted(lensId)) return;
    // First-run sequencing: don't stack this coachmark on top of the welcome
    // wizard. Hold until the welcome tour is dismissed/completed (it fires on a
    // later visit once onboarding is done). `force` still bypasses.
    if (!force && !isOnboardingComplete()) return;
    // Don't stack on top of any open modal/dialog (e.g. a lens's own tutorial
    // like the World "Move around" cinematic) — wait a beat and only fire once
    // the surface is clear, so we never pile coachmark + modal + cookie at once.
    const t = setTimeout(() => {
      if (!force && typeof document !== 'undefined' &&
          document.querySelector('[role="dialog"],[aria-modal="true"]')) return;
      setActive(true);
    }, 900);
    return () => clearTimeout(t);
  }, [guide, lensId, force]);

  // Recompute spotlight whenever step changes.
  useLayoutEffect(() => {
    if (!active || !guide) {
      setSpotlight(null);
      return;
    }
    const current = guide.steps[step];
    if (!current?.selector) {
      setSpotlight(null);
      return;
    }
    const target = document.querySelector(current.selector);
    if (!target) {
      setSpotlight(null);
      return;
    }
    const rect = target.getBoundingClientRect();
    setSpotlight({
      top: rect.top + window.scrollY - 6,
      left: rect.left + window.scrollX - 6,
      width: rect.width + 12,
      height: rect.height + 12,
    });
    target.scrollIntoView({ behavior: 'smooth', block: 'center' });
  }, [active, step, guide]);

  // Recompute spotlight on resize / scroll so it tracks the target.
  useEffect(() => {
    if (!active) return;
    let rafId = 0;
    const refresh = () => {
      cancelAnimationFrame(rafId);
      rafId = requestAnimationFrame(() => {
        const current = guide?.steps[step];
        if (!current?.selector) return;
        const target = document.querySelector(current.selector);
        if (!target) return;
        const rect = target.getBoundingClientRect();
        setSpotlight({
          top: rect.top + window.scrollY - 6,
          left: rect.left + window.scrollX - 6,
          width: rect.width + 12,
          height: rect.height + 12,
        });
      });
    };
    window.addEventListener('resize', refresh);
    window.addEventListener('scroll', refresh, true);
    return () => {
      cancelAnimationFrame(rafId);
      window.removeEventListener('resize', refresh);
      window.removeEventListener('scroll', refresh, true);
    };
  }, [active, step, guide]);

  if (!active || !guide || guide.steps.length === 0) return null;

  const total = guide.steps.length;
  const current = guide.steps[step];
  const isLast = step === total - 1;

  const advance = () => {
    if (isLast) finish('finished');
    else setStep(s => s + 1);
  };

  const finish = (mode: 'finished' | 'skipped') => {
    setActive(false);
    setSpotlight(null);
    markCompleted(lensId);
    onComplete?.(mode);
  };

  return (
    <div
      ref={overlayRef}
      className="fixed inset-0 z-[9000] pointer-events-none"
      role="dialog"
      aria-modal={spotlight ? 'true' : undefined}
      aria-label={`${manifest?.label || lensId} first-run guide`}
    >
      {/* Backdrop. Only dim + capture clicks when we're spotlighting a specific
          element (focus mode). For the common no-target step, stay transparent
          and pointer-through so the coachmark never covers or blocks the lens. */}
      {spotlight && (
        <div className="absolute inset-0 bg-black/40 pointer-events-auto" onClick={() => finish('skipped')} role="button" tabIndex={0} aria-label="Skip tour" onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); (e.currentTarget as HTMLElement).click(); } }} />
      )}

      {/* Spotlight halo */}
      {spotlight && (
        <div
          className="absolute rounded-lg ring-4 ring-amber-400/80 ring-offset-2 ring-offset-zinc-900 transition-all duration-200 pointer-events-none"
          style={{
            top: spotlight.top,
            left: spotlight.left,
            width: spotlight.width,
            height: spotlight.height,
            boxShadow: '0 0 0 9999px rgba(0,0,0,0.4)',
          }}
          aria-hidden="true"
        />
      )}

      {/* Coachmark card — anchored to the bottom-LEFT corner (out of the content
          center and clear of the bottom-right action dock) so it never covers
          the lens's primary surface. */}
      <div
        className={cn(
          'absolute bottom-6 left-6 max-w-sm w-[88vw] sm:w-[22rem]',
          'rounded-xl border border-amber-500/40 bg-zinc-950 shadow-2xl shadow-black/50',
          'pointer-events-auto',
        )}
      >
        <header className="flex items-center gap-2 px-4 py-3 border-b border-zinc-800">
          <Sparkles className="w-4 h-4 text-amber-300" aria-hidden="true" />
          <h2 className="text-sm font-medium text-zinc-100 flex-1">
            {manifest?.label || lensId} · quick tour
          </h2>
          <span className="text-[10px] font-mono text-zinc-400">{step + 1} / {total}</span>
          <button
            type="button"
            onClick={() => finish('skipped')}
            className="text-zinc-400 hover:text-zinc-300 -mr-1"
            aria-label="Skip tour"
          >
            <X className="w-4 h-4" />
          </button>
        </header>
        <div className="px-4 py-4">
          <p className="text-sm text-zinc-200 leading-relaxed">{current.caption}</p>
        </div>
        <footer className="flex items-center gap-2 px-4 py-3 border-t border-zinc-800">
          <button
            type="button"
            onClick={() => finish('skipped')}
            className="text-xs text-zinc-400 hover:text-zinc-200 px-2 py-1"
          >
            Skip
          </button>
          <div className="flex-1" />
          <button
            type="button"
            onClick={advance}
            className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium bg-amber-500/90 hover:bg-amber-400 text-zinc-950 rounded-md transition-colors"
          >
            {isLast ? 'Done' : 'Next'}
            {!isLast && <ChevronRight className="w-3 h-3" />}
          </button>
        </footer>
      </div>
    </div>
  );
}

export default FirstRunTour;
