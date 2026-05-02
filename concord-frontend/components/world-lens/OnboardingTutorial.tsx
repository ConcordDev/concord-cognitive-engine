'use client';

import React, { useState, useCallback } from 'react';
import { ChevronRight, Check, Armchair, Box, Home, GitFork, X } from 'lucide-react';
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
    title: 'Place a Bench',
    description: 'Pick a bench from the component library and place it in the park.',
    icon: Armchair,
    instruction: 'Click a bench component in the marketplace, then click the park to place it.',
    action: 'Place bench',
  },
  {
    id: 2,
    title: 'Build a Wall',
    description: 'Pick a material, set wall dimensions, and watch physics validate in real time.',
    icon: Box,
    instruction: 'Select USB-A Composite, create a 3m × 2.5m × 0.2m wall. Green glow = it holds!',
    action: 'Build wall',
  },
  {
    id: 3,
    title: 'Build a Shelter',
    description: 'Four walls, a roof, a door. Your first building.',
    icon: Home,
    instruction: 'Add 4 walls, 1 floor, and 1 roof. Run validation. See your name on it.',
    action: 'Build shelter',
  },
  {
    id: 4,
    title: 'Improve a Design',
    description: 'Fork an existing shelter and add a window for better habitability.',
    icon: GitFork,
    instruction:
      'Fork the shelter, add a window. Original creator earns royalties from your improvement.',
    action: 'Fork & improve',
  },
];

interface OnboardingTutorialProps {
  onComplete: () => void;
  onDismiss: () => void;
}

export default function OnboardingTutorial({ onComplete, onDismiss }: OnboardingTutorialProps) {
  const [currentStep, setCurrentStep] = useState(0);
  const [completedSteps, setCompletedSteps] = useState<Set<number>>(new Set());
  const [dropHints, setDropHints] = useState(false);

  const completeStep = useCallback(() => {
    setCompletedSteps((prev) => new Set([...prev, currentStep]));
    if (currentStep < TUTORIALS.length - 1) {
      setCurrentStep(currentStep + 1);
    } else {
      if (dropHints) tutorialManager.enableHints();
      onComplete();
    }
  }, [currentStep, dropHints, onComplete]);

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
