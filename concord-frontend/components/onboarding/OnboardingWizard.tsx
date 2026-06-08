'use client';

/**
 * OnboardingWizard — Focused on the Core 5 model.
 *
 * Walks new users through: Welcome → Chat → Board → Graph → Code → Studio → Ready.
 * Each step highlights a core workspace and its key capability.
 */

import { useState, useEffect, useCallback } from 'react';
import { FIRST_RUN_ADVANCE, cookieAnswered, onboardingDoneLocally } from '@/lib/first-run';
import { motion, AnimatePresence } from 'framer-motion';
import {
  Brain,
  MessageSquare,
  Layout,
  Share2,
  Code,
  Music,
  Rocket,
  ChevronRight,
  ChevronLeft,
  Check,
  X
} from 'lucide-react';
import { cn } from '@/lib/utils';

interface OnboardingStep {
  id: string;
  title: string;
  description: string;
  icon: React.ComponentType<{ className?: string }>;
  color: string;
  action?: string;
  shortcut?: string;
}

const STEPS: OnboardingStep[] = [
  {
    id: 'welcome',
    title: 'Welcome to Concord',
    description: 'Your workspaces, everything connected. Your data stays local. No telemetry, no ads, no profiling.',
    icon: Brain,
    color: 'neon-cyan',
  },
  {
    id: 'chat',
    title: 'Chat — Think Out Loud',
    description: 'AI conversations with 6 modes: overview, deep analysis, creative, code, research, and CRETI. Every conversation becomes a DTU in your knowledge graph.',
    icon: MessageSquare,
    color: 'neon-cyan',
    action: 'openChat',
    shortcut: 'Threads, Forum, Daily, Governance',
  },
  {
    id: 'board',
    title: 'Board — Get Things Done',
    description: 'Kanban boards with goals, calendar, timeline, and spaced repetition. Drag tasks across columns, set due dates, track progress.',
    icon: Layout,
    color: 'neon-purple',
    action: 'openBoard',
    shortcut: 'Goals, Calendar, Timeline, Study',
  },
  {
    id: 'graph',
    title: 'Graph — Connect Everything',
    description: 'Visualize your knowledge as an interactive network. See how ideas link, explore citation chains, and discover surprising connections.',
    icon: Share2,
    color: 'neon-green',
    action: 'openGraph',
    shortcut: 'Schema, Entities, Temporal, Ecosystem',
  },
  {
    id: 'code',
    title: 'Code — Build and Ship',
    description: 'Full code editor with MIDI scripting, debugging tools, database explorer, and repository browser. Write, run, and iterate.',
    icon: Code,
    color: 'neon-blue',
    action: 'openCode',
    shortcut: 'Debug, Database, Repos',
  },
  {
    id: 'studio',
    title: 'Studio — Create Anything',
    description: 'Music production with a full DAW, visual art tools, game development, fractal explorer, and simulation sandbox.',
    icon: Music,
    color: 'neon-pink',
    action: 'openStudio',
    shortcut: 'Music, Art, Game, Visuals, AR',
  },
  {
    id: 'ready',
    title: "You're Ready",
    description: 'Press Cmd+K anytime to search across all workspaces. Your thoughts, your lattice, your way.',
    icon: Rocket,
    color: 'neon-cyan',
  }
];

interface OnboardingWizardProps {
  isOpen: boolean;
  onClose: () => void;
  onComplete: () => void;
  onAction?: (action: string) => void;
}

export function OnboardingWizard({ isOpen, onClose, onComplete, onAction }: OnboardingWizardProps) {
  const [currentStep, setCurrentStep] = useState(0);
  const [completedSteps, setCompletedSteps] = useState<Set<string>>(new Set());

  const step = STEPS[currentStep];
  const Icon = step.icon;
  const isLastStep = currentStep === STEPS.length - 1;
  const isFirstStep = currentStep === 0;

  const handleNext = useCallback(() => {
    setCompletedSteps(prev => new Set([...prev, step.id]));

    if (isLastStep) {
      onComplete();
      onClose();
    } else {
      setCurrentStep(prev => prev + 1);
    }
  }, [step.id, isLastStep, onComplete, onClose]);

  const handlePrev = useCallback(() => {
    if (!isFirstStep) {
      setCurrentStep(prev => prev - 1);
    }
  }, [isFirstStep]);

  const handleAction = () => {
    if (step.action && onAction) {
      onAction(step.action);
    }
  };

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (!isOpen) return;

      if (e.key === 'Escape') {
        onClose();
      } else if (e.key === 'ArrowRight' || e.key === 'Enter') {
        handleNext();
      } else if (e.key === 'ArrowLeft') {
        handlePrev();
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [isOpen, handleNext, handlePrev, onClose]);

  return (
    <AnimatePresence>
      {isOpen && (
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 backdrop-blur-sm"
          role="dialog"
          aria-modal="true"
          aria-label="Welcome to Concord"
        >
          <motion.div
            initial={{ scale: 0.9, opacity: 0 }}
            animate={{ scale: 1, opacity: 1 }}
            exit={{ scale: 0.9, opacity: 0 }}
            className="relative w-full max-w-lg mx-4 bg-lattice-bg border border-lattice-border rounded-2xl overflow-hidden"
          >
            {/* Close button */}
            <button
              onClick={onClose}
              className="absolute top-4 right-4 p-2 text-gray-400 hover:text-white transition-colors z-10"
              aria-label="Skip onboarding"
            >
              <X className="w-5 h-5" />
            </button>

            {/* Progress dots */}
            <div className="absolute top-4 left-1/2 -translate-x-1/2 flex items-center gap-2">
              {STEPS.map((s, i) => (
                <button
                  key={s.id}
                  onClick={() => setCurrentStep(i)}
                  className={cn(
                    'w-2 h-2 rounded-full transition-all',
                    i === currentStep ? `bg-${step.color} scale-125` :
                    completedSteps.has(s.id) ? 'bg-green-500' : 'bg-gray-600',
                    'hover:scale-150'
                  )}
                  aria-label={`Go to step ${i + 1}: ${s.title}`}
                />
              ))}
            </div>

            {/* Content */}
            <div className="p-8 pt-16">
              <AnimatePresence mode="wait">
                <motion.div
                  key={step.id}
                  initial={{ opacity: 0, x: 20 }}
                  animate={{ opacity: 1, x: 0 }}
                  exit={{ opacity: 0, x: -20 }}
                  className="text-center"
                >
                  {/* Icon */}
                  <div className={cn(
                    'w-20 h-20 mx-auto mb-6 rounded-full flex items-center justify-center',
                    `bg-${step.color}/10`
                  )}>
                    <Icon className={cn('w-10 h-10', `text-${step.color}`)} />
                  </div>

                  {/* Title */}
                  <h2 className="text-2xl font-bold text-white mb-3">
                    {step.title}
                  </h2>

                  {/* Description */}
                  <p className="text-gray-400 mb-4 leading-relaxed">
                    {step.description}
                  </p>

                  {/* Sub-lenses included */}
                  {step.shortcut && (
                    <p className="text-xs text-gray-400 mb-6">
                      Includes: <span className="text-gray-400">{step.shortcut}</span>
                    </p>
                  )}

                  {/* Action button (if applicable) */}
                  {step.action && (
                    <button
                      onClick={handleAction}
                      className={cn(
                        'mb-4 px-4 py-2 border rounded-lg text-sm transition-colors',
                        `bg-${step.color}/10 border-${step.color}/30 text-${step.color} hover:bg-${step.color}/20`
                      )}
                    >
                      Try it now
                    </button>
                  )}
                </motion.div>
              </AnimatePresence>
            </div>

            {/* Navigation */}
            <div className="px-8 pb-8 flex items-center justify-between">
              <button
                onClick={handlePrev}
                disabled={isFirstStep}
                className={cn(
                  'flex items-center gap-2 px-4 py-2 rounded-lg transition-colors',
                  isFirstStep
                    ? 'text-gray-600 cursor-not-allowed'
                    : 'text-gray-400 hover:text-white'
                )}
                aria-label="Previous step"
              >
                <ChevronLeft className="w-4 h-4" />
                Back
              </button>

              {/* Step counter */}
              <span className="text-xs text-gray-400">
                {currentStep + 1} / {STEPS.length}
              </span>

              <button
                onClick={handleNext}
                className={cn(
                  'flex items-center gap-2 px-6 py-2 font-medium rounded-lg transition-colors',
                  `bg-${step.color} text-black hover:opacity-90`
                )}
                aria-label={isLastStep ? 'Finish onboarding' : 'Next step'}
              >
                {isLastStep ? (
                  <>
                    Get Started
                    <Check className="w-4 h-4" />
                  </>
                ) : (
                  <>
                    Next
                    <ChevronRight className="w-4 h-4" />
                  </>
                )}
              </button>
            </div>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}

// Hook to manage onboarding state
export function useOnboarding() {
  const [isOpen, setIsOpen] = useState(false);
  const [hasCompleted, setHasCompleted] = useState(false);

  // Phase 17 polish-to-ten: server-confirmed wizard completion.
  // We do NOT optimistically open the modal — that caused it to FLASH on every
  // load for already-completed users (it popped open, then the async server
  // check closed it) and to pile on top of the cookie notice for new users.
  // Instead: a present local flag means done; otherwise we confirm with the
  // server, and only open for a genuinely-new user AND only once the cookie
  // notice has been answered (it sequences ahead of us). When the user answers
  // the cookie notice, CookieConsent fires `concord:first-run-advance` and we
  // re-evaluate.
  useEffect(() => {
    let cancelled = false;

    if (onboardingDoneLocally()) {
      setHasCompleted(true);
      return;
    }

    const openIfNewAndCookieAnswered = () => {
      if (cancelled) return;
      if (!onboardingDoneLocally() && cookieAnswered()) setIsOpen(true);
    };

    (async () => {
      let serverCompleted = false;
      try {
        const res = await fetch('/api/onboarding/wizard-status', { credentials: 'same-origin' });
        if (res.ok) {
          const json = await res.json();
          serverCompleted = Boolean(json?.completed);
        }
      } catch { /* offline / unauthenticated — treat as not-completed (new user) */ }
      if (cancelled) return;
      if (serverCompleted) {
        try { localStorage.setItem('concord-onboarding-completed', 'true'); } catch { /* private mode */ }
        setHasCompleted(true);
        setIsOpen(false);
        return;
      }
      // Genuinely new (or offline-new): open once the cookie notice is answered.
      openIfNewAndCookieAnswered();
    })();

    window.addEventListener(FIRST_RUN_ADVANCE, openIfNewAndCookieAnswered);
    return () => {
      cancelled = true;
      window.removeEventListener(FIRST_RUN_ADVANCE, openIfNewAndCookieAnswered);
    };
  }, []);

  const complete = () => {
    localStorage.setItem('concord-onboarding-completed', 'true');
    setHasCompleted(true);
    setIsOpen(false);
    // Best-effort server sync — survives logout/login/cache-clear.
    fetch('/api/onboarding/wizard-complete', {
      method: 'POST',
      credentials: 'same-origin',
    }).catch(() => { /* server sync is best-effort */ });
  };

  // Dismiss/skip MUST persist. Previously close() only flipped isOpen=false, so
  // the welcome reopened on the next route change / first-run-advance and
  // "bled through" on every surface. Skipping the tour now sticks (the user can
  // replay it via reset()).
  const dismiss = () => {
    try { localStorage.setItem('concord-onboarding-completed', 'true'); } catch { /* private mode */ }
    setHasCompleted(true);
    setIsOpen(false);
    fetch('/api/onboarding/wizard-complete', {
      method: 'POST',
      credentials: 'same-origin',
    }).catch(() => { /* server sync is best-effort */ });
  };

  const reset = () => {
    localStorage.removeItem('concord-onboarding-completed');
    setHasCompleted(false);
    setIsOpen(true);
  };

  return {
    isOpen,
    hasCompleted,
    open: () => setIsOpen(true),
    close: dismiss,
    complete,
    reset
  };
}
