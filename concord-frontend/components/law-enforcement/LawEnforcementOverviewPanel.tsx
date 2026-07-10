'use client';

/**
 * LawEnforcementOverviewPanel — real command-dashboard stat strip.
 *
 * Replaces a removed fabricated Quick-Stats row that computed "Active Cases" /
 * "Officers Assigned" / "Active Incidents" / "High Priority" off a generic
 * artifact store (`useLensData('law-enforcement', 'Case'|'Incident'|'Officer')`)
 * with ZERO backing macro in `server/domains/lawenforcement.js` — every number
 * was always 0 on a fresh install and never reconciled with the real CAD /
 * roster / evidence / warrant data one click away in the already-mounted
 * RmsCadConsole. See docs/lens-specs/law-enforcement-capability-map.md.
 *
 * Every tile here is sourced from a real macro round-trip:
 *   cadCallQueue    — active 911 calls
 *   cadUnitBoard    — patrol units + availability
 *   rosterBoard     — officers on roster + overtime
 *   evidenceList    — items in custody
 *   warrantList     — active warrants + expiring soon
 *   reportList      — reports pending supervisor approval
 *   bookingList     — arrests + field interviews
 */

import { useEffect, useState, useCallback } from 'react';
import { Loader2 } from 'lucide-react';
import { lensRun } from '@/lib/api/client';
import { StatTile, StatTileGrid } from '@/components/ui/StatTile';

interface Overview {
  activeCalls: number;
  pendingCalls: number;
  availableUnits: number;
  totalUnits: number;
  officers: number;
  officersOnOvertime: number;
  evidenceInCustody: number;
  evidenceTotal: number;
  activeWarrants: number;
  warrantsExpiringSoon: number;
  reportsPending: number;
  arrests: number;
  fieldInterviews: number;
}

const EMPTY: Overview = {
  activeCalls: 0, pendingCalls: 0, availableUnits: 0, totalUnits: 0,
  officers: 0, officersOnOvertime: 0, evidenceInCustody: 0, evidenceTotal: 0,
  activeWarrants: 0, warrantsExpiringSoon: 0, reportsPending: 0, arrests: 0, fieldInterviews: 0,
};

export function LawEnforcementOverviewPanel() {
  const [stats, setStats] = useState<Overview | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    setLoading(true); setError(null);
    try {
      const [calls, units, roster, evidence, warrants, reports, bookings] = await Promise.all([
        lensRun<{ activeCount: number; pendingCount: number }>('law-enforcement', 'cadCallQueue'),
        lensRun<{ totalUnits: number; availableCount: number }>('law-enforcement', 'cadUnitBoard'),
        lensRun<{ totalOfficers: number; officersOnOvertime: number }>('law-enforcement', 'rosterBoard'),
        lensRun<{ total: number; inCustody: number }>('law-enforcement', 'evidenceList'),
        lensRun<{ active: number; expiringSoon: number }>('law-enforcement', 'warrantList'),
        lensRun<{ pendingApproval: number }>('law-enforcement', 'reportList'),
        lensRun<{ arrests: number; fieldInterviews: number }>('law-enforcement', 'bookingList'),
      ]);
      setStats({
        activeCalls: calls.data.result?.activeCount ?? 0,
        pendingCalls: calls.data.result?.pendingCount ?? 0,
        availableUnits: units.data.result?.availableCount ?? 0,
        totalUnits: units.data.result?.totalUnits ?? 0,
        officers: roster.data.result?.totalOfficers ?? 0,
        officersOnOvertime: roster.data.result?.officersOnOvertime ?? 0,
        evidenceInCustody: evidence.data.result?.inCustody ?? 0,
        evidenceTotal: evidence.data.result?.total ?? 0,
        activeWarrants: warrants.data.result?.active ?? 0,
        warrantsExpiringSoon: warrants.data.result?.expiringSoon ?? 0,
        reportsPending: reports.data.result?.pendingApproval ?? 0,
        arrests: bookings.data.result?.arrests ?? 0,
        fieldInterviews: bookings.data.result?.fieldInterviews ?? 0,
      });
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { void load(); }, [load]);

  if (loading && !stats) {
    return (
      <div role="status" aria-live="polite" aria-busy="true" className="flex items-center gap-2 py-6 justify-center text-zinc-400">
        <Loader2 className="w-4 h-4 animate-spin" /> <span className="text-xs">Loading watch commander overview…</span>
      </div>
    );
  }

  const s = stats ?? EMPTY;

  return (
    <div className="space-y-3">
      {error && (
        <div role="alert" className="rounded-lg border border-red-500/40 bg-red-500/5 px-3 py-2 text-xs text-red-300">
          Couldn&apos;t load overview: {error}
        </div>
      )}
      <StatTileGrid columns={4}>
        <StatTile label="Active calls" value={s.activeCalls} caption={`${s.pendingCalls} pending`} tone={s.pendingCalls > 0 ? 'negative' : 'neutral'} />
        <StatTile label="Units available" value={s.availableUnits} caption={`of ${s.totalUnits} on board`} />
        <StatTile label="Officers on roster" value={s.officers} caption={`${s.officersOnOvertime} on overtime`} tone={s.officersOnOvertime > 0 ? 'negative' : 'neutral'} />
        <StatTile label="Evidence in custody" value={s.evidenceInCustody} caption={`of ${s.evidenceTotal} booked`} />
        <StatTile label="Active warrants" value={s.activeWarrants} caption={`${s.warrantsExpiringSoon} expiring ≤7d`} tone={s.warrantsExpiringSoon > 0 ? 'negative' : 'neutral'} />
        <StatTile label="Reports pending" value={s.reportsPending} caption="awaiting supervisor" tone={s.reportsPending > 0 ? 'negative' : 'neutral'} />
        <StatTile label="Arrests" value={s.arrests} caption="booking log" />
        <StatTile label="Field interviews" value={s.fieldInterviews} caption="booking log" />
      </StatTileGrid>
    </div>
  );
}

export default LawEnforcementOverviewPanel;
