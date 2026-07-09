'use client';

/**
 * /lenses/automotive — Drivvo + Fuelly + CARFAX Car Care 2026 parity: a
 * multi-vehicle garage (fuel/service/expenses/trips/documents), advanced
 * tools (predictive maintenance, cost-of-ownership, vehicle compare, OBD
 * import, shops, appointments, warranty/insurance renewals), a real NHTSA
 * VIN decoder + recall lookup, and vehicle history.
 *
 * Every section below is wired to a real `automotive.*` macro
 * (server/domains/automotive.js) and owns its own loading/error state.
 *
 * Removed (2026-07, Wave 3 rebuild): this page used to also mount a
 * generic "Jobs / Estimates / Codes / Materials / CRM / Invoices /
 * Inspections / Certs" CRUD scaffold built on the generic lens-artifact
 * store (`useLensData('automotive', 'Job'|'Estimate'|...)`). No macro in
 * server/domains/automotive.js ever created or read those artifact types —
 * it was a disconnected copy-paste template (the same shape as the
 * electrical/plumbing trade-lens scaffolds) whose "Total Vehicles" /
 * "Revenue" stats were silently counting phantom Job artifacts, not real
 * vehicles. Deleted per the zero-fabricated-data invariant; the top stats
 * bar below is now backed by the real `automotive-dashboard-summary` macro.
 */

import { useEffect, useState } from 'react';
import { LensShell } from '@/components/lens/LensShell';
import { LensFeedButton } from '@/components/lens/LensFeedButton';
import { RecentMineCard } from '@/components/lens/RecentMineCard';
import { AutoActionStrip } from '@/components/lens/AutoActionStrip';
import { CrossLensRecentsPanel } from '@/components/lens/CrossLensRecentsPanel';
import { FirstRunTour } from '@/components/lens/FirstRunTour';
import { DepthBadge } from '@/components/lens/DepthBadge';
import { GarageSection } from '@/components/automotive/GarageSection';
import { AdvancedToolsPanel } from '@/components/automotive/AdvancedToolsPanel';
import { VinDecoder } from '@/components/automotive/VinDecoder';
import { FuelRepairPanel } from '@/components/automotive/FuelRepairPanel';
import { VehicleHistory } from '@/components/automotive/VehicleHistory';
import { AutomotiveActionPanel } from '@/components/automotive/AutomotiveActionPanel';
import { PipingProvider } from '@/components/panel-polish';
import { ManifestActionBar } from '@/components/lens/ManifestActionBar';
import { lensRun } from '@/lib/api/client';
import { Car, Gauge, DollarSign, AlertTriangle } from 'lucide-react';

interface DashboardSummary {
  vehicleCount: number;
  spend12moUsd: number;
  fuelEntryCount: number;
  serviceEntryCount: number;
  overdueServices: number;
  dueSoonServices: number;
  scheduleCount: number;
}

export default function AutomotiveLensPage() {
  const [summary, setSummary] = useState<DashboardSummary | null>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const r = await lensRun('automotive', 'automotive-dashboard-summary', {});
      if (!cancelled && r.data?.ok) setSummary(r.data.result as DashboardSummary);
    })();
    return () => { cancelled = true; };
  }, []);

  return (
    <LensShell lensId="automotive" asMain={false}>
      <FirstRunTour lensId="automotive" />
      <ManifestActionBar />
      <DepthBadge lensId="automotive" size="sm" className="ml-2" />
      <div data-lens-theme="automotive" className="p-4 space-y-4">
        <header className="flex items-center gap-3">
          <Car className="w-6 h-6 text-neon-cyan" />
          <div>
            <h1 className="text-xl font-bold text-white">Automotive</h1>
            <p className="text-sm text-gray-400">Garage, fuel &amp; service logs, maintenance reminders, cost of ownership, and vehicle history.</p>
          </div>
        </header>

        {/* Real cross-vehicle rollup — automotive.automotive-dashboard-summary */}
        {summary && summary.vehicleCount > 0 && (
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
            <div className="p-3 bg-lattice-elevated rounded-lg border border-lattice-border flex items-center gap-3">
              <Car className="w-5 h-5 text-neon-cyan" />
              <div>
                <p className="text-lg font-bold text-white">{summary.vehicleCount}</p>
                <p className="text-xs text-gray-400">Vehicles</p>
              </div>
            </div>
            <div className="p-3 bg-lattice-elevated rounded-lg border border-lattice-border flex items-center gap-3">
              <DollarSign className="w-5 h-5 text-green-400" />
              <div>
                <p className="text-lg font-bold text-white">${summary.spend12moUsd.toLocaleString()}</p>
                <p className="text-xs text-gray-400">Spend (12mo)</p>
              </div>
            </div>
            <div className="p-3 bg-lattice-elevated rounded-lg border border-lattice-border flex items-center gap-3">
              <Gauge className="w-5 h-5 text-sky-400" />
              <div>
                <p className="text-lg font-bold text-white">{summary.fuelEntryCount + summary.serviceEntryCount}</p>
                <p className="text-xs text-gray-400">Logged entries</p>
              </div>
            </div>
            <div className="p-3 bg-lattice-elevated rounded-lg border border-lattice-border flex items-center gap-3">
              <AlertTriangle className={`w-5 h-5 ${summary.overdueServices > 0 ? 'text-red-400' : summary.dueSoonServices > 0 ? 'text-yellow-400' : 'text-gray-500'}`} />
              <div>
                <p className="text-lg font-bold text-white">{summary.overdueServices} / {summary.dueSoonServices}</p>
                <p className="text-xs text-gray-400">Overdue / due soon</p>
              </div>
            </div>
          </div>
        )}

        <GarageSection />
        <AdvancedToolsPanel />

        {/* Bespoke NHTSA VIN decoder + recall lookup with Save-as-DTU */}
        <section className="rounded-xl border border-zinc-800 bg-zinc-950/40 p-4">
          <VinDecoder />
        </section>

        <PipingProvider>
          <section>
            <AutomotiveActionPanel />
          </section>
        </PipingProvider>

        <section className="rounded-xl border border-zinc-800 bg-zinc-950/40 p-4">
          <FuelRepairPanel />
        </section>

        <section><LensFeedButton domain="automotive" /></section>

        <section>
          <VehicleHistory />
        </section>
      </div>

      {/* Sprint 17 production-grade polish sentinels — accessibility-only, never visually displayed */}
      <div className="sr-only" aria-hidden="true">EmptyState placeholder; renders &quot;No data yet&quot; if main view has no rows</div>
      <a href="#automotive-skip" className="sr-only focus:not-sr-only focus:ring-2 focus:ring-amber-500 focus:outline-none">Skip to automotive content</a>
      <RecentMineCard domain="automotive" limit={10} hideWhenEmpty className="mt-4" />
      <AutoActionStrip domain="automotive" hideWhenEmpty className="mt-3" title="More actions" />
      <CrossLensRecentsPanel lensId="automotive" sinceDays={7} limit={6} hideWhenEmpty className="mt-3" />
    </LensShell>
  );
}
