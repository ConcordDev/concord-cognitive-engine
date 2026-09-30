'use client';

import { Gauge } from 'lucide-react';
import { FormalVerificationWorkbench } from '@/components/invariant/FormalVerificationWorkbench';

/** Formal Verification Workbench — was always stacked on the page. */
export function WorkbenchPanel() {
  return (
    <div className="panel p-4">
      <h2 className="font-semibold mb-4 flex items-center gap-2">
        <Gauge className="w-4 h-4 text-neon-cyan" />
        Formal Verification Workbench
      </h2>
      <FormalVerificationWorkbench />
    </div>
  );
}
