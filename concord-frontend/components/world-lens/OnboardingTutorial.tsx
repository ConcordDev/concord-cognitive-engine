'use client';

import React, { useState, useCallback, useEffect } from 'react';
import { ChevronRight, Check, Footprints, MessageSquare, Axe, Hammer, Swords, X } from 'lucide-react';
import { tutorialManager } from '@/lib/concordia/onboarding/tutorial';

const panel = 'bg-black/90 backdrop-blur-sm border border-white/10 rounded-lg';

interface TutorialStep {
  id: number;
  title: string;
  description: string;
  icon: React.ComponentType<{ className?: string }>;
  instruction: string;
  action: string;
}

const TUTORIALS: TutorialStep[] = [
  {
    id: 1,
    title: 'Move around',
    description: 'WASD to walk, hold Shift to run. The world is yours to explore.',
    icon: Footprints,
    instruction: 'Press W to walk forward. Try Shift+W for running.',
    action: 'walked',
  },
  {
    id: 2,
    title: 'Talk to an NPC',
    description: 'Walk up to any NPC and click on them. They have stories, quests, and trade.',
    icon: MessageSquare,
    instruction: 'Approach an NPC and click on them, or press E when nearby.',
    action: 'opened-dialogue',
  },
  {
    id: 3,
    title: 'Gather resources',
    description: 'Right-click on terrain (grass, stone, water) to harvest materials.',
    icon: Axe,
    instruction: 'Right-click any terrain — wood, stone, fiber, or herbs.',
    action: 'gathered',
  },
  {
    id: 4,
    title: 'Craft something',
    description: 'Open the crafting panel and turn your gathered materials into a weapon or tool.',
    icon: Hammer,
    instruction: 'Press C to open crafting. Try the Wooden Sword recipe — it needs 5 wood + 2 fiber.',
    action: 'crafted',
  },
  {
    id: 5,
    title: 'Fight a hostile',
    description: 'Frontier district has wraiths and drift-eaters. Combat awards XP that levels skills.',
    icon: Swords,
    instruction: 'Travel to the frontier, target a hostile creature, attack with left-click.',
    action: 'combat-hit',
  },
];

interface OnboardingTutorialProps {
  onComplete: () => void;
  onDismiss: () => void;
}

const STEP_STORAGE_KEY = 'concordia:tutorial:step';

export default function OnboardingTutorial({ onComplete, onDismiss }: OnboardingTutorialProps) {
  const [currentStep, setCurrentStep] = useState<number>(() => {
    if (typeof window === 'undefined') return 0;
    const saved = Number(localStorage.getItem(STEP_STORAGE_KEY) ?? 0);
    return Number.isFinite(saved) && saved >= 0 && saved < TUTORIALS.length ? saved : 0;
  });
  const [completedSteps, setCompletedSteps] = useState<Set<number>>(() => {
    if (typeof window === 'undefined') return new Set();
    const saved = Number(localStorage.getItem(STEP_STORAGE_KEY) ?? 0);
    const set = new Set<number>();
    for (let i = 0; i < saved; i++) set.add(i);
    return set;
  });
  const [dropHints, setDropHints] = useState(false);

  // Persist progress so a refresh mid-tutorial picks up where the player left off.
  useEffect(() => {
    try { localStorage.setItem(STEP_STORAGE_KEY, String(currentStep)); }
    catch { /* persistence best-effort */ }
  }, [currentStep]);

  const completeStep = useCallback(() => {
    setCompletedSteps((prev) => new Set([...prev, currentStep]));
    if (currentStep < TUTORIALS.length - 1) {
      setCurrentStep(currentStep + 1);
    } else {
      if (dropHints) tutorialManager.enableHints();
      try { localStorage.removeItem(STEP_STORAGE_KEY); } catch { /* best-effort */ }
      onComplete();
    }
  }, [currentStep, dropHints, onComplete]);

  // Auto-advance the tutorial when the player performs the matching action.
  // Each step lists an `action` token; the world page already dispatches
  // concordia:tutorial-action events with the same token whenever the user
  // moves / opens dialogue / etc. Listen and advance when a match arrives.
  useEffect(() => {
    function onAction(e: Event) {
      const detail = (e as CustomEvent).detail as { action?: string } | undefined;
      const action = detail?.action;
      if (!action) return;
      const expected = TUTORIALS[currentStep]?.action;
      if (!expected) return;
      // Map several incoming action tokens onto each step.
      const matches: Record<string, string[]> = {
        'walked':         ['walked', 'moved', 'sent-quick-message'],
        'opened-dialogue':['opened-dialogue', 'talk-npc', 'entered-lens-portal'],
        'gathered':       ['gathered', 'gather-success'],
        'crafted':        ['crafted', 'craft-success', 'craft-complete'],
        'combat-hit':     ['combat-hit', 'combat-crit', 'combat-kill'],
      };
      const accept = matches[expected] ?? [expected];
      if (accept.includes(action)) completeStep();
    }
    window.addEventListener('concordia:tutorial-action', onAction);
    return () => window.removeEventListener('concordia:tutorial-action', onAction);
  }, [currentStep, completeStep]);

  const handleSkip = useCallback(() => {
    tutorialManager.skip(dropHints);
    onDismiss();
  }, [dropHints, onDismiss]);

  const tutorial = TUTORIALS[currentStep];

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm">
      <div className={`${panel} w-full max-w-md p-6`}>
        {/* Header */}
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-sm font-bold text-white">Welcome to World Lens</h2>
          <button onClick={handleSkip} className="text-gray-500 hover:text-white">
            <X className="w-4 h-4" />
          </button>
        </div>

        <p className="text-xs text-gray-400 mb-4">
          Everything you see was built by users like you. Let's learn the basics.
        </p>

        {/* Step indicators */}
        <div className="flex gap-2 mb-6">
          {TUTORIALS.map((t, i) => (
            <div
              key={t.id}
              className={`flex-1 h-1 rounded-full transition-colors ${
                completedSteps.has(i)
                  ? 'bg-green-500'
                  : i === currentStep
                    ? 'bg-cyan-500'
                    : 'bg-white/10'
              }`}
            />
          ))}
        </div>

        {/* Current tutorial */}
        <div className="text-center mb-6">
          <div className="w-16 h-16 rounded-full bg-cyan-500/10 border border-cyan-500/30 flex items-center justify-center mx-auto mb-3">
            <tutorial.icon className="w-8 h-8 text-cyan-400" />
          </div>
          <h3 className="text-lg font-bold text-white mb-1">
            Tutorial {tutorial.id}: {tutorial.title}
          </h3>
          <p className="text-sm text-gray-400 mb-3">{tutorial.description}</p>
          <div className="p-3 rounded bg-white/5 text-xs text-gray-300">{tutorial.instruction}</div>
        </div>

        {/* Drop Hints toggle */}
        <button
          onClick={() => setDropHints((v) => !v)}
          className="w-full flex items-center justify-between px-3 py-2 rounded-lg bg-white/5 hover:bg-white/8 border border-white/5 mb-3 transition-colors"
        >
          <span className="text-xs text-white/60 flex items-center gap-2">
            <span>💡</span> Drop hints after tutorial
          </span>
          <span
            className={`text-[10px] font-medium px-2 py-0.5 rounded-full transition-colors ${
              dropHints ? 'bg-cyan-500/20 text-cyan-300' : 'bg-white/10 text-white/30'
            }`}
          >
            {dropHints ? 'ON' : 'OFF'}
          </span>
        </button>

        {/* Actions */}
        <div className="flex gap-2">
          <button
            onClick={handleSkip}
            className="flex-1 py-2 text-xs text-gray-400 border border-white/10 rounded-lg hover:text-white transition-colors"
          >
            Skip Tutorial
          </button>
          <button
            onClick={completeStep}
            className="flex-1 py-2 bg-cyan-500/20 text-cyan-300 rounded-lg text-xs hover:bg-cyan-500/30 transition-colors flex items-center justify-center gap-1"
          >
            {currentStep < TUTORIALS.length - 1 ? (
              <>
                {tutorial.action}
                <ChevronRight className="w-3.5 h-3.5" />
              </>
            ) : (
              <>
                <Check className="w-3.5 h-3.5" />
                Complete
              </>
            )}
          </button>
        </div>

        <p className="text-[10px] text-gray-600 text-center mt-3">
          Step {currentStep + 1} of {TUTORIALS.length}
        </p>
      </div>
    </div>
  );
}
