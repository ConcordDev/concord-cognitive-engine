'use client';

/**
 * Welding lens — field-service operations console + engineering
 * calculators for a working welder/fabrication shop.
 *
 * Backed entirely by `server/domains/welding.js`'s 28 registered macros:
 *   - WeldingOperations mounts the Jobber/ServiceTitan-parity console
 *     (schedule / quotes / invoices / WPS / certs / photos / codes),
 *     each tab calling its own `welding.*` macro directly.
 *   - WelderProcedures mounts the four Lincoln/Miller-style engineering
 *     calculators (joint strength, rod selection, heat input, weld
 *     inspection) against `welding.jointStrength` / `rodSelection` /
 *     `heatInput` / `inspectionChecklist`.
 *   - WeldingFeed pulls real-world welding-community chatter (Reddit).
 *
 * A prior version of this page additionally ran a generic artifact-CRUD
 * dashboard (Jobs/Estimates/Codes/Materials/CRM/Invoices/Inspections/
 * Certs tabs over `useLensData`/`useRunArtifact`) that persisted to the
 * *generic* `/api/lens/welding` artifact store — a parallel, disconnected
 * data model that never touched the real `welding.job-schedule` /
 * `estimate-create` / `invoice-from-job` / `cert-add` / `code-search`
 * macros above. Its "Activate" button routed through the generic
 * analyze/generate/suggest catch-all rather than any welding-specific
 * macro. That fake system has been removed; WeldingOperations already
 * covers the same jobs/estimates/invoices/certs/codes surface against
 * the real, persisted backend state.
 */

import { LensShell } from '@/components/lens/LensShell';
import { CrossLensRecentsPanel } from '@/components/lens/CrossLensRecentsPanel';
import { FirstRunTour } from '@/components/lens/FirstRunTour';
import { DepthBadge } from '@/components/lens/DepthBadge';
import { WeldingFeed } from '@/components/welding/WeldingFeed';
import { WelderProcedures } from '@/components/welding/WelderProcedures';
import { WeldingOperations } from '@/components/welding/WeldingOperations';
import { LensPageShell } from '@/components/lens/LensPageShell';
import { Flame, ChevronDown, ChevronRight } from 'lucide-react';
import { useState } from 'react';

export default function WeldingLensPage() {
  const [showFeed, setShowFeed] = useState(false);
  return (
    <LensShell lensId="welding" asMain={false}>
      <FirstRunTour lensId="welding" />      <DepthBadge lensId="welding" size="sm" className="ml-2" />
      <LensPageShell
        domain="welding"
        title="Welding"
        description="Field-service operations, welding-engineering calculators, WPS + certification tracking, and real-world welding chatter"
        headerIcon={<Flame className="w-6 h-6" />}
      >
        <section className="rounded-xl border border-orange-500/15 bg-zinc-950/40 p-4">
          <WeldingOperations />
        </section>

        <section>
          <WelderProcedures />
        </section>

        <section className="mt-6 rounded-xl border border-zinc-800 bg-zinc-950/40 p-4">
          <button
            type="button"
            onClick={() => setShowFeed(v => !v)}
            className="flex w-full items-center justify-between text-left text-sm font-semibold text-white"
          >
            <span>Welding community chatter (Reddit)</span>
            {showFeed ? <ChevronDown className="h-4 w-4" /> : <ChevronRight className="h-4 w-4" />}
          </button>
          {showFeed && (
            <div className="mt-3">
              <WeldingFeed />
            </div>
          )}
        </section>
      </LensPageShell>

      <a href="#welding-skip" className="sr-only focus:not-sr-only focus:ring-2 focus:ring-amber-500 focus:outline-none">Skip to welding content</a>      <CrossLensRecentsPanel lensId="welding" sinceDays={7} limit={6} hideWhenEmpty className="mt-3" />
    </LensShell>
  );
}
