'use client';

import { Phone } from 'lucide-react';

/**
 * Crisis / support resources strip for the Suffering lens (FIX-suffering-002).
 *
 * The lens carried only a "Not medical advice" disclaimer. A lens about pain
 * and suffering must also show where a person in crisis can actually go —
 * the same verified lines the Mental Health lens's crisis-hotlines registry
 * serves (988 Suicide and Crisis Lifeline, Crisis Text Line), kept static
 * here so the strip renders even when lens data fails to load.
 */
export function CrisisResources() {
  return (
    <div className="bg-rose-500/10 border border-rose-500/30 rounded-2xl px-4 py-3 flex items-start gap-3" role="note" aria-label="Crisis and support resources">
      <Phone className="w-5 h-5 text-rose-400 mt-0.5 shrink-0" />
      <p className="text-sm text-rose-200">
        If you or someone you know is in crisis, you are not alone: call or text{' '}
        <strong className="text-rose-100">988</strong> — the Suicide and Crisis Lifeline (US, free,
        confidential, 24/7) — or text <strong className="text-rose-100">HOME</strong> to{' '}
        <strong className="text-rose-100">741741</strong> for the Crisis Text Line. In immediate
        danger, call your local emergency number (911 US · 112 EU). More support lines, including
        international numbers, are in the{' '}
        <a href="/lenses/mental-health" className="underline decoration-rose-300/60 underline-offset-2 hover:text-rose-100">
          Mental Health lens
        </a>
        .
      </p>
    </div>
  );
}
