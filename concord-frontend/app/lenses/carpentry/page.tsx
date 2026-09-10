'use client';

/**
 * Carpentry lens — a real trade-management + shop-calculator surface, not a
 * generic artifact CRUD store. Every panel below calls a genuine
 * `carpentry.*` macro (server/domains/carpentry.js):
 *
 *   JobOps            — cut-list optimizer, material takeoff → estimate,
 *                        crew roster + dispatch calendar, per-job time
 *                        tracking, before/during/after photo log,
 *                        estimate → invoice + e-signature + client portal.
 *   CarpentryShop      — board-foot calculator, joint-strength guide, wood
 *                        selection guide, finish recommender.
 *   WoodSpeciesReference — live Wikipedia REST lookups for named species.
 *
 * A prior revision of this page wrapped the real engine in a generic
 * artifact-CRUD shell (MODE_TABS: Job/Estimate/CodeRef/Material/Client/
 * Invoice/Inspection/Certification persisted through the domain-agnostic
 * /api/lens/carpentry artifact store) plus an auto-generated manifest button
 * bar and a generic three-verb "analyze" action wired to nothing
 * carpentry-specific. None of that touched the real macros above — it was
 * disconnected generic scaffold sitting in front of already-real depth (the
 * 2026-07-09 rebuild
 * pass removed it; see docs/lens-specs/carpentry-capability-map.md).
 */

import { LensShell } from '@/components/lens/LensShell';
import { CrossLensRecentsPanel } from '@/components/lens/CrossLensRecentsPanel';
import { FirstRunTour } from '@/components/lens/FirstRunTour';
import { DepthBadge } from '@/components/lens/DepthBadge';
import { Hammer } from 'lucide-react';
import { WoodSpeciesReference } from '@/components/carpentry/WoodSpeciesReference';
import { CarpentryShop } from '@/components/carpentry/CarpentryShop';
import { JobOps } from '@/components/carpentry/JobOps';

export default function CarpentryLensPage() {
  return (
    <LensShell lensId="carpentry">
      <FirstRunTour lensId="carpentry" />
      <div className="mx-auto max-w-5xl px-4 sm:px-6 py-6 space-y-6">
        <header className="flex items-start justify-between gap-3">
          <div className="flex items-center gap-3">
            <Hammer className="w-6 h-6 text-amber-400" aria-hidden="true" />
            <div>
              <h1 className="text-xl font-semibold text-white">Carpentry</h1>
              <p className="text-sm text-zinc-400 mt-0.5 max-w-2xl">
                Cut lists, material takeoffs, crew dispatch, job time tracking,
                photo logs, and estimate-to-invoice with a shareable client
                portal — plus a shop-calculator suite for board feet, joint
                strength, wood selection, and finish. Every number below comes
                from the real carpentry engine, not a generic form store.
              </p>
            </div>
          </div>
          <DepthBadge lensId="carpentry" size="sm" />
        </header>

        <section id="carpentry-skip" aria-label="Trade job management">
          <JobOps />
        </section>

        <section aria-label="Shop calculator suite" className="rounded-xl border border-amber-700/20 bg-zinc-950/40 p-4">
          <CarpentryShop />
        </section>

        <section aria-label="Wood species reference" className="rounded-xl border border-zinc-800 bg-zinc-950/40 p-4">
          <WoodSpeciesReference />
        </section>
      </div>      <CrossLensRecentsPanel lensId="carpentry" sinceDays={7} limit={6} hideWhenEmpty className="mt-3" />
    </LensShell>
  );
}
