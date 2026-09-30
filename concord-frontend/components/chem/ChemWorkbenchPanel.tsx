'use client';

import ChemWorkbench from '@/components/chem/ChemWorkbench';

/** Workbench as a first-class view — always open while this tab is active. */
export function ChemWorkbenchPanel({ onClose }: { onClose?: () => void }) {
  return (
    <div className="min-h-[24rem]">
      <ChemWorkbench open={true} onClose={() => onClose?.()} />
    </div>
  );
}
