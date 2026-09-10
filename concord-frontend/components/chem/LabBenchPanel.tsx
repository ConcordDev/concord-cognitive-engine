'use client';

import { ChemActionPanel } from '@/components/chem/ChemActionPanel';
import { PipingProvider } from '@/components/panel-polish';

export function LabBenchPanel() {
  return (
    <div className="rounded-xl border border-zinc-800 bg-zinc-950/40 p-4">
      <h3 className="mb-3 text-sm font-semibold text-white">Lab bench (calc + mint/publish)</h3>
      <PipingProvider>
        <ChemActionPanel />
      </PipingProvider>
    </div>
  );
}
