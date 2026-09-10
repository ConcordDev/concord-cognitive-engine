'use client';

/**
 * ─────────────────────────────────────────────────────────────────────────
 * CONCORD // EMERGENCY SERVICES — CAD (Computer-Aided Dispatch) shape
 * (Frontend Rebuild Program)
 * ─────────────────────────────────────────────────────────────────────────
 * Every panel on this page is real and wired to a macro in
 * `server/domains/emergencyservices.js` — full audit + reference-parity
 * checklist in `docs/lens-specs/emergency-services-capability-map.md`.
 *
 * REMOVED (fabrication + a disconnected generic surface the old page
 * shipped, 7 of 9 tabs' worth):
 *   - A generic-CRUD artifact store cycling through type strings that
 *     never matched any registered backend macro, backing the old
 *     Dashboard/Calls/Units/Fire/EMS/Dispatch/Resources/Map tabs. Two of
 *     those type strings (fire-incident and EMS-call variants) had no
 *     corresponding macro anywhere in the domain file — they rendered an
 *     always-empty list.
 *   - A literal hardcoded "4.2m" "Avg Response" stat tile — a decorative
 *     string with no computation behind it, presented next to three real
 *     counts as if it were live telemetry.
 *   - A Map tab plotting lat/lng off the same disconnected fake store,
 *     duplicating map data the real CAD console below it already renders
 *     from the live map-state macro.
 *   - The auto-generated scaffold action body that ships on every
 *     un-rebuilt lens page — a manifest-driven quick-action strip layered
 *     over a generic capabilities list, neither of which counted as a
 *     designed feature even though the macros underneath were real.
 *
 * KEPT + PROMOTED: the CAD Console (`CADConsole`) already covered the
 * entire live operational surface — incident intake, unit roster, live
 * map, triage queue, dispatch, nearest-unit routing, timeline, readiness,
 * alerts — but only inside one tab; the field-calculator bench
 * (`EmergencyServicesActionPanel`) and the live USGS seismic feed
 * (`QuakeFeed`) were both real but bolted below the tab nav, unreachable
 * from it. All three are now first-class tabs.
 *
 * ADDED: `EmsOverviewPanel` — a real Dashboard wiring the previously
 * unsurfaced `ems-dashboard` + `readiness-rollup` macros into honest KPI
 * tiles. `QuakeFeed` gained a bulk "Ingest to substrate" action wired to
 * the `feed` macro (server-side dedup + bulk DTU-mint), which had zero
 * frontend caller before this rebuild.
 *
 * ADDED (WAVE4): `AgencyMutualAidPanel` — a real cross-org "agency" surface
 * (an agency IS an org, server/lib/world-organizations.js) with a genuine
 * mutual-aid incident-share primitive: create/join an agency, see its
 * shared incident + unit board, opt in to receiving mutual aid, share a
 * real open incident with another agency, and commit a real unit to a
 * shared incident. All additive — the CAD Console tab's per-user path is
 * unchanged when no agency is selected. Real SMS/radio/CAD-hardware
 * paging stays documented-external; nothing here claims one was sent.
 * ─────────────────────────────────────────────────────────────────────────
 */

import { useState } from 'react';
import { Siren, LayoutDashboard, Radio, Truck, AlertOctagon, Keyboard, Users } from 'lucide-react';
import { LensShell } from '@/components/lens/LensShell';
import { FirstRunTour } from '@/components/lens/FirstRunTour';
import { DepthBadge } from '@/components/lens/DepthBadge';
import { DTUExportButton } from '@/components/lens/DTUExportButton';
import { CrossLensRecentsPanel } from '@/components/lens/CrossLensRecentsPanel';
import { PipingProvider } from '@/components/panel-polish';
import { useLensNav } from '@/hooks/useLensNav';
import { useLensCommand } from '@/hooks/useLensCommand';
import { cn } from '@/lib/utils';

import { QuakeFeed } from '@/components/emergency-services/QuakeFeed';
import { EmergencyServicesActionPanel } from '@/components/emergency-services/EmergencyServicesActionPanel';
import { CADConsole } from '@/components/emergency-services/CADConsole';
import { EmsOverviewPanel } from '@/components/emergency-services/EmsOverviewPanel';
import { AgencyMutualAidPanel } from '@/components/emergency-services/AgencyMutualAidPanel';

type ModeTab = 'Dashboard' | 'CAD' | 'Agency' | 'Actions' | 'Seismic';

const MODE_TABS: { key: ModeTab; label: string; icon: typeof Siren; hotkey: string }[] = [
  { key: 'Dashboard', label: 'Dashboard', icon: LayoutDashboard, hotkey: '1' },
  { key: 'CAD', label: 'CAD Console', icon: Radio, hotkey: '2' },
  { key: 'Agency', label: 'Agency & Mutual Aid', icon: Users, hotkey: '3' },
  { key: 'Actions', label: 'Quick Actions', icon: Truck, hotkey: '4' },
  { key: 'Seismic', label: 'Seismic Feed', icon: AlertOctagon, hotkey: '5' },
];

export default function EmergencyServicesLensPage() {
  useLensNav('emergency-services');
  const [activeMode, setActiveMode] = useState<ModeTab>('Dashboard');

  useLensCommand(
    MODE_TABS.map((t) => ({
      id: `mode-${t.key.toLowerCase()}`,
      keys: t.hotkey,
      description: t.label,
      category: 'navigation' as const,
      action: () => setActiveMode(t.key),
    })),
    { lensId: 'emergency-services' }
  );

  const renderTab = () => {
    switch (activeMode) {
      case 'Dashboard':
        return (
          <section className="rounded-xl border border-zinc-800 bg-zinc-950/40 p-4">
            <EmsOverviewPanel />
          </section>
        );
      case 'CAD':
        return (
          <section className="rounded-xl border border-red-500/20 bg-zinc-950/50 p-4">
            <CADConsole />
          </section>
        );
      case 'Agency':
        return (
          <section>
            <AgencyMutualAidPanel />
          </section>
        );
      case 'Actions':
        return (
          <PipingProvider>
            <section>
              <EmergencyServicesActionPanel />
            </section>
          </PipingProvider>
        );
      case 'Seismic':
        return (
          <section className="rounded-xl border border-zinc-800 bg-zinc-950/40 p-4">
            <QuakeFeed />
          </section>
        );
      default:
        return null;
    }
  };

  return (
    <LensShell lensId="emergency-services" asMain={false}>
      <FirstRunTour lensId="emergency-services" />
      <div data-lens-theme="emergency-services" className="min-h-full p-4 space-y-4">
        {/* Command bar */}
        <header className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex items-center gap-3">
            <div className="w-9 h-9 rounded-lg bg-red-500/20 flex items-center justify-center shrink-0">
              <Siren className="w-5 h-5 text-red-400" />
            </div>
            <div>
              <div className="flex items-center gap-2">
                <h1 className="text-xl font-bold">Emergency Services</h1>
                <DepthBadge lensId="emergency-services" size="sm" />
              </div>
              <p className="text-xs text-gray-400">Computer-aided dispatch, field calculators &amp; live seismic intake</p>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <span className="hidden md:flex items-center gap-1 text-[10px] text-gray-600" title="1–5 switch view">
              <Keyboard className="w-3.5 h-3.5" /> 1–5
            </span>
            <DTUExportButton domain="emergency-services" data={{}} compact />
          </div>
        </header>

        {/* Tabs */}
        <nav className="flex gap-2 border-b border-white/10 pb-2 overflow-x-auto">
          {MODE_TABS.map((t) => {
            const Icon = t.icon;
            const active = activeMode === t.key;
            return (
              <button
                key={t.key}
                onClick={() => setActiveMode(t.key)}
                className={cn(
                  'flex items-center gap-1.5 px-4 py-2 rounded-t-lg text-sm font-medium whitespace-nowrap transition-colors',
                  active
                    ? 'bg-red-400/20 text-red-400 border-b-2 border-red-400'
                    : 'text-gray-400 hover:text-white'
                )}
              >
                <Icon className="w-3.5 h-3.5" /> {t.label}
              </button>
            );
          })}
        </nav>

        <div className="min-h-[240px]">{renderTab()}</div>        <CrossLensRecentsPanel lensId="emergency-services" sinceDays={7} limit={6} hideWhenEmpty className="mt-3" />
      </div>
    </LensShell>
  );
}
