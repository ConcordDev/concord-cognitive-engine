'use client';

/**
 * UnbuiltEnginePanel — the honest "not built yet" state for a Frontier
 * engine whose panel hasn't shipped.
 *
 * This is NOT a placeholder with fake data, a disabled-looking mock form,
 * or a "coming soon" banner over sample numbers — per CLAUDE.md's
 * zero-demo-content invariant, an engine that can't compute yet must say
 * so and name exactly what's missing. The Boundary cell still renders for
 * real (the honest-boundary text is real backend copy regardless of
 * whether a frontend panel exists for it yet), so a visitor always learns
 * something true about the engine even before it has a UI.
 */

import { Wrench } from 'lucide-react';
import { ds } from '@/lib/design-system';
import { cn } from '@/lib/utils';
import { BoundaryCell } from '@/components/frontier/FrontierEngineShell';
import type { FrontierEngineDef } from '@/lib/frontier-engines';

export function UnbuiltEnginePanel({ engine }: { engine: FrontierEngineDef }) {
  return (
    <div className="space-y-8">
      <section className="border-l-2 border-l-slate-600 pl-4 py-3" aria-label="Panel not built yet">
        <div className="flex items-baseline gap-2 mb-2">
          <span className={cn(ds.monoXs, 'text-gray-500 select-none')}>—</span>
          <h3 className={cn(ds.heading3, 'text-sm')}>Panel not built yet</h3>
        </div>
        <div className="flex items-start gap-3 rounded-lg border border-lattice-border bg-lattice-surface p-4">
          <Wrench className="w-5 h-5 mt-0.5 shrink-0 text-gray-500" aria-hidden="true" />
          <div className="space-y-2">
            <p className={cn(ds.textBody)}>
              <strong>{engine.name}</strong> ({engine.wave}) is a real backend engine —
              it just doesn&apos;t have a Compute/Verify UI in this destination yet.
              This is an honest empty state, not a mock: no fabricated inputs,
              outputs, or numbers are shown below.
            </p>
            {engine.macros.length > 0 ? (
              <div>
                <p className={cn(ds.textMuted, 'mb-1')}>
                  Macro{engine.macros.length > 1 ? 's' : ''} it will call once wired:
                </p>
                <ul className="space-y-0.5">
                  {engine.macros.map((m) => (
                    <li key={`${m.domain}.${m.name}`} className={cn(ds.monoXs, 'text-gray-400')}>
                      {m.domain}.{m.name}
                    </li>
                  ))}
                </ul>
              </div>
            ) : (
              <p className={cn(ds.textMuted)}>
                This engine has no lens-callable macro at all yet (see the boundary
                note below for why) — there is nothing for a Compute cell to call.
              </p>
            )}
          </div>
        </div>
      </section>

      <BoundaryCell cellNumber="B" text={engine.boundary ?? 'No boundary text recorded yet.'} source={engine.boundarySource} />
    </div>
  );
}

export default UnbuiltEnginePanel;
