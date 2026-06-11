'use client';

/**
 * FirstWinWizard — Guided onboarding flow for new users.
 *
 * Three steps: Create DTU -> Generate Artifact -> View in Global.
 * Auto-dismisses once all steps are complete.
 */

import { useState, useEffect, useRef } from 'react';
import { useQuery } from '@tanstack/react-query';
import { api } from '@/lib/api/client';
import { useRouter } from 'next/navigation';
import { isOnboardingComplete } from '@/lib/onboarding-state';
import { Rocket, CheckCircle, Circle, ArrowRight, X, Brain, Package, Globe, ChefHat, Heart, Swords, Sparkles } from 'lucide-react';
import { cn } from '@/lib/utils';
import { phaseVoiceLine, ARRIVAL_LINE } from '@/lib/concordia/onboarding-voice';

// Onboarding ceremony — speak a Concordia line in-world (the goddess turns to
// the player + a fading toast carries the words) and fire a small juice beat.
function speakConcordia(line: string, fanfare = false) {
  if (typeof window === 'undefined') return;
  try {
    window.dispatchEvent(new CustomEvent('concordia:goddess-speaks', { detail: { targetId: 'player', line } }));
    window.dispatchEvent(new CustomEvent('concordia:toast', { detail: { message: line, kind: fanfare ? 'milestone' : 'ambient', ttl_ms: fanfare ? 5200 : 4200 } }));
    if (fanfare) window.dispatchEvent(new CustomEvent('concordia:soundscape-command', { detail: { action: 'triggerSFX', sfxId: 'milestone' } }));
  } catch { /* ceremony is best-effort */ }
}

interface FirstWinStep {
  id: string;
  label: string;
  completed: boolean;
}

interface FirstWinData {
  ok: boolean;
  steps: FirstWinStep[];
  allDone: boolean;
  completedCount: number;
}

interface FirstCyclePhase {
  questId: string;
  phase: 'cook' | 'eat' | 'fight' | 'commune';
  status: string;
  complete: boolean;
}

interface FirstCycleData {
  ok: boolean;
  tutorial: 'first_cycle';
  currentPhase: 'cook' | 'eat' | 'fight' | 'commune' | 'complete';
  complete: boolean;
  phases: FirstCyclePhase[];
}

const STEP_ICONS: Record<string, typeof Brain> = {
  create_dtu: Brain,
  create_artifact: Package,
  view_global: Globe,
  // First Cycle tutorial — Concordia's mechanic-onboarding loop.
  first_cycle_cook:    ChefHat,
  first_cycle_eat:     Heart,
  first_cycle_fight:   Swords,
  first_cycle_commune: Sparkles,
};

const STEP_DESCRIPTIONS: Record<string, string> = {
  create_dtu:
    'Create a Discrete Thought Unit in the Chat workspace — the fundamental knowledge unit in Concord.',
  create_artifact: 'Generate or upload a file artifact in the Studio workspace.',
  view_global: 'See your work in the Global truth view — the canonical source of all data.',
  // First Cycle — Concordia speaks each phase aloud in the world; the wizard
  // mirrors what she says so the player can pick up where they left off.
  first_cycle_cook:
    'Walk into the glade. Gather two ingredients. Cook your first meal at the starter station.',
  first_cycle_eat:
    'Open inventory and consume the meal you cooked. Feel the warmth — that is the world giving back.',
  first_cycle_fight:
    'Walk to the Training Hollow. Defeat three Ember Sprites with Flow Combat. Pick up the Ember Core that drops.',
  first_cycle_commune:
    'Return to the glade. Speak with Concordia at the living tree. Choose your branch — the world remembers.',
};

const STEP_ROUTES: Record<string, string> = {
  create_dtu: '/lenses/chat',
  create_artifact: '/lenses/studio',
  view_global: '/global',
  // All four First Cycle phases route into the Concordia world lens.
  first_cycle_cook:    '/lenses/world',
  first_cycle_eat:     '/lenses/world',
  first_cycle_fight:   '/lenses/world',
  first_cycle_commune: '/lenses/world',
};

const FIRST_CYCLE_LABELS: Record<string, string> = {
  first_cycle_cook:    'First Cycle — Cook',
  first_cycle_eat:     'First Cycle — Eat',
  first_cycle_fight:   'First Cycle — Fight',
  first_cycle_commune: 'First Cycle — Commune with Concordia',
};

const DISMISSED_KEY = 'concord_first_win_dismissed';
const ARRIVAL_KEY = 'concord_arrival_seen';

function FirstWinWizard() {
  const router = useRouter();
  // Onboarding ceremony — dismissal now COLLAPSES (re-openable via a Resume
  // pill) instead of hiding the wizard forever, so a player who closed it early
  // can pick the First Cycle back up.
  // Default to the compact "Resume First Cycle" pill, NOT the full panel — the
  // expanded card covered too much of the lens. It opens on demand (or once the
  // player explicitly resumes); the pill keeps it discoverable without blocking.
  const [collapsed, setCollapsed] = useState(true);
  // Whether the helper has been fully dismissed. Hydrated from localStorage on
  // mount (SSR-safe) so a prior dismissal STICKS — the pill used to reappear on
  // every load because this flag was written but never read back.
  const [dismissed, setDismissed] = useState(false);
  useEffect(() => {
    try { if (localStorage.getItem(DISMISSED_KEY)) setDismissed(true); } catch { /* private mode */ }
  }, []);

  const handleDismiss = () => {
    setCollapsed(true);
    setDismissed(true);
    if (typeof window !== 'undefined') {
      try { localStorage.setItem(DISMISSED_KEY, 'true'); } catch { /* private mode */ }
    }
  };

  const handleResume = () => {
    setCollapsed(false);
    setDismissed(false);
    if (typeof window !== 'undefined') {
      try { localStorage.removeItem(DISMISSED_KEY); } catch { /* private mode */ }
    }
  };

  const { data, isError } = useQuery<FirstWinData>({
    queryKey: ['guidance-first-win'],
    queryFn: async () => (await api.get('/api/guidance/first-win')).data,
    refetchInterval: 15_000,
    retry: 1,
  });

  // First Cycle — the mechanic-onboarding tutorial that runs BEFORE the
  // First Win loop. Cook → Eat → Fight → Commune. When tutorial.complete
  // is true we hide these phases; otherwise they prepend the wizard's
  // step list so new players see Concordia's loop first.
  const { data: tutorial } = useQuery<FirstCycleData>({
    queryKey: ['tutorial-first-cycle'],
    queryFn: async () => (await api.get('/api/tutorial/first-cycle')).data,
    refetchInterval: 15_000,
    retry: 1,
  });

  // Static fallback when guidance API is unavailable (e.g. no SQLite)
  const FALLBACK_DATA: FirstWinData = {
    ok: true,
    steps: [
      { id: 'create_dtu', label: 'Create your first DTU', completed: false },
      { id: 'create_artifact', label: 'Generate or upload an artifact', completed: false },
      { id: 'view_global', label: 'View it in Global', completed: false },
    ],
    allDone: false,
    completedCount: 0,
  };
  const baseResolved = data || (isError ? FALLBACK_DATA : null);

  // Merge First Cycle phases as additional steps when the tutorial is
  // incomplete. Phases come first so the wizard reads top-to-bottom in
  // the order Concordia walks the player through the world.
  const resolved: FirstWinData | null = (() => {
    if (!baseResolved) return null;
    if (!tutorial || tutorial.complete) return baseResolved;
    const cyclePhases: FirstWinStep[] = tutorial.phases.map((p) => ({
      id: p.questId,
      label: FIRST_CYCLE_LABELS[p.questId] ?? p.questId,
      completed: p.complete,
    }));
    const cycleCompleted = cyclePhases.filter((s) => s.completed).length;
    return {
      ok: true,
      steps: [...cyclePhases, ...baseResolved.steps],
      allDone: false,
      completedCount: cycleCompleted + baseResolved.completedCount,
    };
  })();

  // The current (first-incomplete) step id — drives the between-phase voice hint.
  const currentStepId = resolved
    ? (resolved.steps.find((s) => !s.completed) || resolved.steps[resolved.steps.length - 1])?.id ?? null
    : null;

  // Ceremony 1 — arrival fanfare: the first time a fresh player sees the wizard
  // with the First Cycle still ahead, Concordia welcomes them in-world (once).
  const showable = !!resolved && !resolved.allDone;
  useEffect(() => {
    if (!showable) return;
    if (typeof window === 'undefined') return;
    // First-run sequencing: hold the arrival fanfare until the welcome wizard is
    // done, so it doesn't fire on top of it (the pileup fix).
    if (!isOnboardingComplete()) return;
    if (localStorage.getItem(ARRIVAL_KEY) === 'true') return;
    localStorage.setItem(ARRIVAL_KEY, 'true');
    const t = setTimeout(() => speakConcordia(ARRIVAL_LINE, true), 1200);
    return () => clearTimeout(t);
  }, [showable]);

  // Ceremony 2 — between-phase voice hints: when the active step advances to a
  // new phase, Concordia speaks its hint in-world (cook→eat→fight→commune).
  const lastSpokenRef = useRef<string | null>(null);
  useEffect(() => {
    if (collapsed || !currentStepId) return;
    if (lastSpokenRef.current === currentStepId) return;
    const line = phaseVoiceLine(currentStepId);
    if (!line) { lastSpokenRef.current = currentStepId; return; }
    lastSpokenRef.current = currentStepId;
    const t = setTimeout(() => speakConcordia(line, false), 600);
    return () => clearTimeout(t);
  }, [currentStepId, collapsed]);

  if (!resolved || resolved.allDone || dismissed) return null;

  // Collapsed → a small Resume pill (re-openable), not a permanent hide.
  if (collapsed) {
    return (
      <button
        onClick={handleResume}
        className="fixed bottom-6 left-6 z-40 flex items-center gap-1.5 px-3 py-2 rounded-full bg-lattice-surface border border-neon-blue/30 shadow-lg text-xs font-medium text-neon-blue hover:bg-neon-blue/10"
        aria-label="Resume First Cycle"
      >
        <Rocket className="w-3.5 h-3.5" />
        Resume First Cycle
      </button>
    );
  }

  const currentStep =
    resolved.steps.find((s) => !s.completed) || resolved.steps[resolved.steps.length - 1];

  return (
    <div className="fixed bottom-4 right-4 z-40 w-80 max-w-[calc(100vw-2rem)] max-h-[70vh] overflow-y-auto bg-lattice-surface/95 backdrop-blur border border-neon-blue/30 rounded-xl shadow-xl">
      {/* Header */}
      <div className="flex items-center justify-between px-3 py-2 bg-neon-blue/10 border-b border-neon-blue/20">
        <span className="text-sm font-medium text-neon-blue flex items-center gap-1.5">
          <Rocket className="w-4 h-4" />
          First Win
        </span>
        <div className="flex items-center gap-2">
          <span className="text-xs text-gray-400">
            {resolved.completedCount}/{resolved.steps.length}
          </span>
          <button
            onClick={handleDismiss}
            className="text-gray-400 hover:text-white"
            aria-label="Dismiss wizard"
          >
            <X className="w-3.5 h-3.5" />
          </button>
        </div>
      </div>

      {/* Progress bar */}
      <div className="h-1 bg-lattice-border">
        <div
          className="h-full bg-neon-blue transition-all duration-500"
          style={{ width: `${(resolved.completedCount / resolved.steps.length) * 100}%` }}
        />
      </div>

      {/* Steps */}
      <div className="p-3 space-y-2">
        {resolved.steps.map((step) => {
          const Icon = STEP_ICONS[step.id] || Circle;
          const isCurrent = step.id === currentStep.id && !step.completed;

          return (
            <div
              key={step.id}
              className={cn(
                'flex items-start gap-2 p-2 rounded text-sm transition-colors',
                isCurrent ? 'bg-neon-blue/5 border border-neon-blue/20' : '',
                // `line-through` + text-gray-400 already conveys "done"
                // visually. Adding opacity-60 dropped effective contrast
                // below WCAG AA 4.5:1 (computed 3.39:1). Keep the strike-
                // through + dim style without the opacity dim.
                step.completed ? '' : ''
              )}
            >
              {step.completed ? (
                <CheckCircle className="w-4 h-4 text-neon-green flex-shrink-0 mt-0.5" />
              ) : (
                <Icon
                  className={cn(
                    'w-4 h-4 flex-shrink-0 mt-0.5',
                    isCurrent ? 'text-neon-blue' : 'text-gray-600'
                  )}
                />
              )}
              <div className="flex-1 min-w-0">
                <div
                  className={cn(
                    'font-medium text-xs',
                    step.completed ? 'text-gray-400 line-through' : 'text-white'
                  )}
                >
                  {step.label}
                </div>
                {isCurrent && (
                  <>
                    <p className="text-xs text-gray-400 mt-0.5">{STEP_DESCRIPTIONS[step.id]}</p>
                    {STEP_ROUTES[step.id] && (
                      <button
                        onClick={() => router.push(STEP_ROUTES[step.id])}
                        className="flex items-center gap-1 mt-1.5 text-xs text-neon-blue hover:text-neon-blue/80"
                      >
                        Go <ArrowRight className="w-3 h-3" />
                      </button>
                    )}
                  </>
                )}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

import { withErrorBoundary } from '@/components/common/ErrorBoundary';
const _WrappedFirstWinWizard = withErrorBoundary(FirstWinWizard);
export { _WrappedFirstWinWizard as FirstWinWizard };
