'use client';

/**
 * PracticePanel — bias checklist, accuracy, reflection prompts, strategies, literature.
 */

import { useState } from 'react';
import { ChevronDown, ChevronRight } from 'lucide-react';
import { BiasChecklist } from '@/components/metacognition/BiasChecklist';
import { AccuracyTracker } from '@/components/metacognition/AccuracyTracker';
import { ReflectionPrompts } from '@/components/metacognition/ReflectionPrompts';
import { StrategyLibrary } from '@/components/metacognition/StrategyLibrary';
import { ReasoningToolkit } from '@/components/metacognition/ReasoningToolkit';
import { CogsciFeed } from '@/components/metacognition/CogsciFeed';
import { ds } from '@/lib/design-system';

export function PracticePanel() {
  const [showCogsciFeed, setShowCogsciFeed] = useState(false);

  return (
    <div className="space-y-6">
      <div>
        <h2 className={ds.heading2}>Practice</h2>
        <p className={ds.textMuted}>
          Pre-decision checklist, accuracy history, after-action prompts, strategy library.
        </p>
      </div>
      <BiasChecklist />
      <AccuracyTracker />
      <ReflectionPrompts />
      <StrategyLibrary />
      <ReasoningToolkit />
      <div>
        <button
          type="button"
          onClick={() => setShowCogsciFeed((v) => !v)}
          className="flex items-center gap-2 text-sm font-medium text-zinc-300 hover:text-white"
        >
          {showCogsciFeed ? <ChevronDown className="w-4 h-4" /> : <ChevronRight className="w-4 h-4" />}
          Cognitive science papers (external reference)
        </button>
        {showCogsciFeed && (
          <section className="mt-3 rounded-xl border border-zinc-800 bg-zinc-950/40 p-4">
            <CogsciFeed />
          </section>
        )}
      </div>
    </div>
  );
}
