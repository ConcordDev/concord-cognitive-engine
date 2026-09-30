'use client';

/**
 * WorkbenchPanel — LinguisticsActionPanel behind PipingProvider.
 * Folded from the workbench accordion on the linguistics page.
 */

import { PipingProvider } from '@/components/panel-polish';
import { LinguisticsActionPanel } from '@/components/linguistics/LinguisticsActionPanel';

export function WorkbenchPanel() {
  return (
    <PipingProvider>
      <div className="rounded-xl border border-zinc-800 bg-zinc-950/40 p-4">
        <h3 className="text-sm font-semibold text-white mb-3">Linguistics workbench</h3>
        <LinguisticsActionPanel />
      </div>
    </PipingProvider>
  );
}
