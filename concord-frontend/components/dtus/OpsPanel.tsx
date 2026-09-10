'use client';

/**
 * OpsPanel — substrate-class DTU macro probes (promotion, dream, autotag, …).
 */

import { DomainProbeCard } from '@/components/system/DomainProbeCard';
import { probesByGroup } from '@/lib/headless-probes';

export function OpsPanel() {
  return (
    <section aria-labelledby="dtu-ops-heading" data-lens-section="dtu-operations">
      <header className="mb-3 flex items-baseline justify-between">
        <h2 id="dtu-ops-heading" className="text-base font-semibold text-white">
          DTU operations
        </h2>
        <span className="text-[11px] text-gray-400">substrate macros · live probes</span>
      </header>
      <div className="grid grid-cols-1 gap-2 sm:grid-cols-2 lg:grid-cols-3">
        {probesByGroup('dtu').map((p) => (
          <DomainProbeCard key={`${p.domain}.${p.macro}`} probe={p} />
        ))}
      </div>
    </section>
  );
}
