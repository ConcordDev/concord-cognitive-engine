'use client';

/**
 * FirstWinWizard — Guided onboarding flow for new users.
 *
 * Three steps: Create DTU -> Generate Artifact -> View in Global.
 * Auto-dismisses once all steps are complete.
 */

import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { api } from '@/lib/api/client';
import { useRouter } from 'next/navigation';
import { Rocket, CheckCircle, Circle, ArrowRight, X, Brain, Package, Globe } from 'lucide-react';
import { cn } from '@/lib/utils';

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

const STEP_ICONS: Record<string, typeof Brain> = {
  create_dtu: Brain,
  create_artifact: Package,
  view_global: Globe,
};

const STEP_DESCRIPTIONS: Record<string, string> = {
  create_dtu:
    'Create a Discrete Thought Unit in the Chat workspace — the fundamental knowledge unit in Concord.',
  create_artifact: 'Generate or upload a file artifact in the Studio workspace.',
  view_global: 'See your work in the Global truth view — the canonical source of all data.',
};

const STEP_ROUTES: Record<string, string> = {
  create_dtu: '/lenses/chat',
  create_artifact: '/lenses/studio',
  view_global: '/global',
};

const DISMISSED_KEY = 'concord_first_win_dismissed';

function FirstWinWizard() {
  const router = useRouter();
  const [dismissed, setDismissed] = useState(() => {
    if (typeof window !== 'undefined') {
      return localStorage.getItem(DISMISSED_KEY) === 'true';
    }
    return false;
  });

  const handleDismiss = () => {
    setDismissed(true);
    if (typeof window !== 'undefined') {
      localStorage.setItem(DISMISSED_KEY, 'true');
    }
  };

  const { data, isError } = useQuery<FirstWinData>({
    queryKey: ['guidance-first-win'],
    queryFn: async () => (await api.get('/api/guidance/first-win')).data,
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
  const resolved = data || (isError ? FALLBACK_DATA : null);

  if (!resolved || resolved.allDone || dismissed) return null;

  const currentStep =
    resolved.steps.find((s) => !s.completed) || resolved.steps[resolved.steps.length - 1];

  return (
    <div className="fixed bottom-4 right-4 z-40 w-80 bg-lattice-surface border border-neon-blue/30 rounded-lg shadow-lg overflow-hidden">
      {/* Header */}
      <div className="flex items-center justify-between px-3 py-2 bg-neon-blue/10 border-b border-neon-blue/20">
        <span className="text-sm font-medium text-neon-blue flex items-center gap-1.5">
          <Rocket className="w-4 h-4" />
          First Win
        </span>
        <div className="flex items-center gap-2">
          <span className="text-xs text-gray-500">
            {resolved.completedCount}/{resolved.steps.length}
          </span>
          <button
            onClick={handleDismiss}
            className="text-gray-500 hover:text-white"
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
                step.completed ? 'opacity-60' : ''
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
                    step.completed ? 'text-gray-500 line-through' : 'text-white'
                  )}
                >
                  {step.label}
                </div>
                {isCurrent && (
                  <>
                    <p className="text-xs text-gray-500 mt-0.5">{STEP_DESCRIPTIONS[step.id]}</p>
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
