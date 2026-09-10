'use client';

/**
 * WorkbenchPanel — full ODR case-lifecycle workbench (Modria/eBay shape).
 */

import { CaseWorkbench } from '@/components/disputes/CaseWorkbench';

export function WorkbenchPanel() {
  return (
    <section className="rounded-xl border border-zinc-800 bg-zinc-950/40 p-4">
      <CaseWorkbench />
    </section>
  );
}

export default WorkbenchPanel;
