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
import { lensRun } from '@/lib/api/client';
import { Car, Gauge, DollarSign, AlertTriangle, Shield, ChevronDown, ChevronRight } from 'lucide-react';

interface DashboardSummary {
  vehicleCount: number;
  spend12moUsd: number;
  fuelEntryCount: number;
  serviceEntryCount: number;
  overdueServices: number;
  dueSoonServices: number;
  scheduleCount: number;
}

interface UpcomingRenewal {
  id: string;
  kind: string;
  title: string;
  provider: string;
  renewalDate: string;
  premium: number | null;
  daysRemaining: number | null;
  milesRemaining: number | null;
  status: 'ok' | 'due_soon' | 'expired';
  vehicleName: string | null;
}

const RENEWAL_STATUS_COLOUR: Record<UpcomingRenewal['status'], string> = {
  expired: 'text-rose-300',
  due_soon: 'text-amber-300',
  ok: 'text-emerald-300',
};

export default function AutomotiveLensPage() {
  const [summary, setSummary] = useState<DashboardSummary | null>(null);
  const [upcomingRenewals, setUpcomingRenewals] = useState<UpcomingRenewal[] | null>(null);
  const [showActionPanel, setShowActionPanel] = useState(false);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const r = await lensRun('automotive', 'automotive-dashboard-summary', {});
      if (!cancelled && r.data?.ok) setSummary(r.data.result as DashboardSummary);
    })();
    return () => { cancelled = true; };
  }, []);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      // automotive.renewals-upcoming — status-ranked, withinDays-windowed view
      // spanning every vehicle (unlike renewals-list, which needs a vehicleId).
      const r = await lensRun('automotive', 'renewals-upcoming', { withinDays: 60 });
      if (!cancelled && r.data?.ok) {
        const result = r.data.result as { renewals?: UpcomingRenewal[] } | undefined;
        setUpcomingRenewals(result?.renewals || []);
      }
    })();
    return () => { cancelled = true; };
  }, []);

  return (
    <LensShell lensId="automotive" asMain={false}>
      <FirstRunTour lensId="automotive" />      <DepthBadge lensId="automotive" size="sm" className="ml-2" />
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

        {/* Dashboard "upcoming renewals" widget — automotive.renewals-upcoming */}
        {upcomingRenewals && upcomingRenewals.length > 0 && (
          <section className="rounded-xl border border-zinc-800 bg-zinc-950/40 p-4">
            <div className="flex items-center gap-2 mb-2">
              <Shield className="w-4 h-4 text-neon-cyan" />
              <h2 className="text-sm font-semibold text-white">Upcoming renewals</h2>
              <span className="text-[10px] text-gray-500">next 60 days, across all vehicles</span>
            </div>
            <ul className="divide-y divide-white/5">
              {upcomingRenewals.slice(0, 6).map((r) => (
                <li key={r.id} className="py-2 flex items-center gap-3">
                  <Shield className={`w-3.5 h-3.5 shrink-0 ${RENEWAL_STATUS_COLOUR[r.status]}`} />
                  <div className="flex-1 min-w-0">
                    <div className="text-xs text-white truncate">
                      {r.title}
                      <span className="text-[9px] uppercase text-gray-400 ml-1">{r.kind.replace(/_/g, ' ')}</span>
                    </div>
                    <div className="text-[10px] text-gray-400 truncate">
                      {[r.vehicleName, r.provider, r.premium !== null ? `$${r.premium}` : ''].filter(Boolean).join(' · ') || '—'}
                    </div>
                  </div>
                  <div className="text-right shrink-0">
                    <div className={`text-[11px] font-mono ${RENEWAL_STATUS_COLOUR[r.status]}`}>
                      {r.daysRemaining !== null
                        ? (r.daysRemaining < 0 ? `${Math.abs(r.daysRemaining)}d overdue` : `${r.daysRemaining}d left`)
                        : r.renewalDate}
                    </div>
                    {r.milesRemaining !== null && (
                      <div className="text-[10px] text-gray-400">
                        {r.milesRemaining < 0 ? `${Math.abs(r.milesRemaining).toLocaleString()} mi over` : `${r.milesRemaining.toLocaleString()} mi left`}
                      </div>
                    )}
                  </div>
                </li>
              ))}
            </ul>
          </section>
        )}

        <GarageSection />
        <AdvancedToolsPanel />

        {/* Bespoke NHTSA VIN decoder + recall lookup with Save-as-DTU */}
        <section className="rounded-xl border border-zinc-800 bg-zinc-950/40 p-4">
          <VinDecoder />
        </section>

        <section className="rounded-xl border border-zinc-800 bg-zinc-950/40 p-4">
          <button
            type="button"
            onClick={() => setShowActionPanel(v => !v)}
            className="flex w-full items-center justify-between text-left text-sm font-semibold text-white"
          >
            <span>More actions</span>
            {showActionPanel ? <ChevronDown className="h-4 w-4" /> : <ChevronRight className="h-4 w-4" />}
          </button>
          {showActionPanel && (
            <div className="mt-3">
              <PipingProvider>
                <AutomotiveActionPanel />
              </PipingProvider>
            </div>
          )}
        </section>

        <section className="rounded-xl border border-zinc-800 bg-zinc-950/40 p-4">
          <FuelRepairPanel />
        </section>

        <section><LensFeedButton domain="automotive" /></section>

        <section>
          <VehicleHistory />
        </section>
      </div>

      <a href="#automotive-skip" className="sr-only focus:not-sr-only focus:ring-2 focus:ring-amber-500 focus:outline-none">Skip to automotive content</a>      <CrossLensRecentsPanel lensId="automotive" sinceDays={7} limit={6} hideWhenEmpty className="mt-3" />
    </LensShell>
  );
}
