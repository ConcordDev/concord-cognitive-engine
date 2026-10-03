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
import { Siren, LayoutDashboard, Radio, Truck, AlertOctagon, Users } from 'lucide-react';
import { LensShell } from '@/components/lens/LensShell';
import { FirstRunTour } from '@/components/lens/FirstRunTour';
import { DepthBadge } from '@/components/lens/DepthBadge';
import { DTUExportButton } from '@/components/lens/DTUExportButton';
import { NorthStarFrame } from '@/components/lens/NorthStarFrame';
import { useAuth } from '@/hooks/useAuth';
import { titleCaseDisplayName } from '@/components/chat/claudeCleanGreeting';
import { PipingProvider } from '@/components/panel-polish';
import { useLensNav } from '@/hooks/useLensNav';
import { useLensCommand } from '@/hooks/useLensCommand';

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
  const { user } = useAuth();
  const who = titleCaseDisplayName(user?.username);

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
          <section className="rounded-2xl border border-white/10 bg-[#111] p-4">
            <EmsOverviewPanel />
          </section>
        );
      case 'CAD':
        return (
          <section className="rounded-2xl border border-red-500/20 bg-[#111] p-4">
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
          <section className="rounded-2xl border border-white/10 bg-[#111] p-4">
            <QuakeFeed />
          </section>
        );
      default:
        return null;
    }
  };

  const titles: Record<ModeTab, string> = {
    Dashboard: `Hold the line${who ? `, ${who}` : ''}`,
    CAD: 'Dispatch the next unit',
    Agency: 'Call for mutual aid',
    Actions: 'Run the field numbers',
    Seismic: 'Watch the ground',
  };

  return (
    <LensShell lensId="emergency-services" asMain={false}>
      <FirstRunTour lensId="emergency-services" />
      <NorthStarFrame
        lensId="emergency-services"
        crumb="Emergency Services"
        title={titles[activeMode]}
        subtitle="Computer-aided dispatch, field calculators & live seismic intake"
        actions={(
          <>
            <DepthBadge lensId="emergency-services" size="sm" />
            <DTUExportButton domain="emergency-services" data={{}} compact />
          </>
        )}
        tabs={MODE_TABS.map((t) => ({ id: t.key, label: t.label, icon: t.icon, hint: `${t.label} (${t.hotkey})` }))}
        activeTab={activeMode}
        onTab={(id) => setActiveMode(id as ModeTab)}
        tabsLabel="Emergency services views"
        cta={{ label: 'Open CAD console', icon: Radio, onClick: () => setActiveMode('CAD'), title: 'Dispatch and incident intake (2)' }}
      >
        <div className="min-h-[240px]">{renderTab()}</div>
      </NorthStarFrame>
    </LensShell>
  );
}
