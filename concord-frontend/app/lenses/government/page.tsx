'use client';

/**
 * Government — one civic-ops app.
 *
 * Reference: USAspending.gov / Congress.gov (dense grouped rail, tabular
 * caseload, no dashboard costume). Every view is a real panel wired to
 * government macros or useLensData artifacts. Nested CivicWorkbench
 * accordion is folded into the single `active` union.
 */

import { useCallback, useMemo, useState } from 'react';
import { LensShell } from '@/components/lens/LensShell';
import { FirstRunTour } from '@/components/lens/FirstRunTour';
import { DepthBadge } from '@/components/lens/DepthBadge';
import { ShellPreview } from '@/components/lens/ShellPreview';
import { PipingProvider } from '@/components/panel-polish';
import { MobileTabBar } from '@/components/mobile/MobileTabBar';
import { useLensNav } from '@/hooks/useLensNav';
import { useLensCommand } from '@/hooks/useLensCommand';
import { useLensIdentity } from '@/hooks/useLensIdentity';
import { useRealtimeLens } from '@/hooks/useRealtimeLens';
import { LiveIndicator } from '@/components/lens/LiveIndicator';
import { DTUExportButton } from '@/components/lens/DTUExportButton';
import { RealtimeDataPanel } from '@/components/lens/RealtimeDataPanel';
import LiveFeed from '@/components/lens/LiveFeed';
import { NorthStarFrame } from '@/components/lens/NorthStarFrame';
import { useAuth } from '@/hooks/useAuth';
import { titleCaseDisplayName } from '@/components/chat/claudeCleanGreeting';
import { cn } from '@/lib/utils';
import {
  Landmark,
  Megaphone,
  Inbox,
  FolderOpen,
  MapPin,
  FileCheck as MTabPermit,
  HardHat as MTabPW,
  Archive as MTabRec,
  Gavel as MTabCourt,
  FileText as MTabBills,
  Siren as MTabAlert,
} from 'lucide-react';

import { CaseOpsPanel, type CaseArtifactType } from '@/components/government/CaseOpsPanel';
import { GovernmentActionPanel } from '@/components/government/GovernmentActionPanel';
import ServiceRequestsPanel from '@/components/government/ServiceRequestsPanel';
import DepartmentsPanel from '@/components/government/DepartmentsPanel';
import RoutingRulesPanel from '@/components/government/RoutingRulesPanel';
import PermitsPanel from '@/components/government/PermitsPanel';
import InspectionsPanel from '@/components/government/InspectionsPanel';
import AssetsPanel from '@/components/government/AssetsPanel';
import OpenDataExplorer from '@/components/government/OpenDataExplorer';
import PaymentsPanel from '@/components/government/PaymentsPanel';
import MeetingsPanel from '@/components/government/MeetingsPanel';
import ElectionsPanel from '@/components/government/ElectionsPanel';
import ServiceRequestReporter from '@/components/government/ServiceRequestReporter';
import AdvocacyPanel from '@/components/government/AdvocacyPanel';
import DocumentLibraryPanel from '@/components/government/DocumentLibraryPanel';
import NotificationsPanel from '@/components/government/NotificationsPanel';
import RepresentativeFinder from '@/components/government/RepresentativeFinder';
import CivicAlerts from '@/components/government/CivicAlerts';
import FOIATracker from '@/components/government/FOIATracker';
import BudgetVisualizer from '@/components/government/BudgetVisualizer';
import BillsDesk from '@/components/government/BillsDesk';

type GovView =
  | 'overview'
  | 'bills'
  | 'budget'
  | 'foia'
  | 'alerts'
  | 'opendata'
  | 'reps'
  | 'advocacy'
  | 'elections'
  | 'meetings'
  | 'actions'
  | 'sr'
  | 'reporter'
  | 'permit-ops'
  | 'inspections'
  | 'payments'
  | 'assets'
  | 'departments'
  | 'routing'
  | 'documents'
  | 'notifications'
  | 'permits'
  | 'works'
  | 'code'
  | 'emergency'
  | 'records'
  | 'court';

const GROUPS: { id: string; label: string; title: string; hint: string; icon: typeof Landmark; items: { id: GovView; label: string }[] }[] = [
  {
    id: 'oversight', label: 'Oversight', title: 'How your government is doing', hint: 'Caseload, bills, spending, FOIA, alerts and open data', icon: Landmark,
    items: [
      { id: 'overview', label: 'Caseload' },
      { id: 'bills', label: 'Bills' },
      { id: 'budget', label: 'Spending' },
      { id: 'foia', label: 'FOIA' },
      { id: 'alerts', label: 'Alerts' },
      { id: 'opendata', label: 'Open data' },
    ],
  },
  {
    id: 'congress', label: 'Congress', title: 'Who speaks for you', hint: 'Representatives, advocacy, elections, meetings and lookups', icon: Megaphone,
    items: [
      { id: 'reps', label: 'My reps' },
      { id: 'advocacy', label: 'Advocacy' },
      { id: 'elections', label: 'Elections' },
      { id: 'meetings', label: 'Meetings' },
      { id: 'actions', label: 'Lookups' },
    ],
  },
  {
    id: 'services', label: '311 / Permits', title: 'Get something fixed or approved', hint: '311, pin-drop reports, permit desk, inspections, payments and routing', icon: Inbox,
    items: [
      { id: 'sr', label: '311' },
      { id: 'reporter', label: 'Pin-drop' },
      { id: 'permit-ops', label: 'Permit desk' },
      { id: 'inspections', label: 'Inspections' },
      { id: 'payments', label: 'Payments' },
      { id: 'assets', label: 'Assets' },
      { id: 'departments', label: 'Departments' },
      { id: 'routing', label: 'Routing' },
      { id: 'documents', label: 'Documents' },
      { id: 'notifications', label: 'Notices' },
    ],
  },
  {
    id: 'cases', label: 'Case files', title: 'Every file on record', hint: 'Permits, public works, code, emergency, records and court', icon: FolderOpen,
    items: [
      { id: 'permits', label: 'Permits' },
      { id: 'works', label: 'Public works' },
      { id: 'code', label: 'Code' },
      { id: 'emergency', label: 'Emergency' },
      { id: 'records', label: 'Records' },
      { id: 'court', label: 'Court' },
    ],
  },
];

const CASE_VIEW: Record<string, CaseArtifactType> = {
  permits: 'Permit',
  works: 'Project',
  code: 'Violation',
  emergency: 'EmergencyPlan',
  records: 'Record',
  court: 'CourtCase',
};

const TYPE_TO_VIEW: Record<CaseArtifactType, GovView> = {
  Permit: 'permits',
  Project: 'works',
  Violation: 'code',
  EmergencyPlan: 'emergency',
  Record: 'records',
  CourtCase: 'court',
};

function CivicPane({
  active,
  onNavigateType,
}: {
  active: GovView;
  onNavigateType: (type: CaseArtifactType) => void;
}) {
  if (active === 'overview') {
    return <CaseOpsPanel artifactType="Permit" surface="dashboard" onNavigateType={onNavigateType} />;
  }
  const caseType = CASE_VIEW[active];
  if (caseType) {
    return <CaseOpsPanel artifactType={caseType} surface="files" onNavigateType={onNavigateType} />;
  }
  if (active === 'bills') return <BillsDesk />;
  if (active === 'budget') return <BudgetVisualizer />;
  if (active === 'foia') return <FOIATracker />;
  if (active === 'alerts') return <CivicAlerts />;
  if (active === 'opendata') return <OpenDataExplorer />;
  if (active === 'reps') return <RepresentativeFinder />;
  if (active === 'advocacy') return <AdvocacyPanel />;
  if (active === 'elections') return <ElectionsPanel />;
  if (active === 'meetings') return <MeetingsPanel />;
  if (active === 'actions') {
    return (
      <PipingProvider>
        <GovernmentActionPanel />
      </PipingProvider>
    );
  }
  if (active === 'sr') return <ServiceRequestsPanel />;
  if (active === 'reporter') return <ServiceRequestReporter />;
  if (active === 'permit-ops') return <PermitsPanel />;
  if (active === 'inspections') return <InspectionsPanel />;
  if (active === 'payments') return <PaymentsPanel />;
  if (active === 'assets') return <AssetsPanel />;
  if (active === 'departments') return <DepartmentsPanel />;
  if (active === 'routing') return <RoutingRulesPanel />;
  if (active === 'documents') return <DocumentLibraryPanel />;
  return <NotificationsPanel />;
}

export default function GovernmentLensPage() {
  useLensNav('government');
  useLensIdentity('government');
  const { user } = useAuth();
  const who = titleCaseDisplayName(user?.username);
  const { latestData: realtimeData, isLive, lastUpdated, insights } = useRealtimeLens('government');
  const [active, setActive] = useState<GovView>('overview');

  const go = useCallback((id: GovView) => setActive(id), []);
  const onNavigateType = useCallback((type: CaseArtifactType) => {
    setActive(TYPE_TO_VIEW[type]);
  }, []);

  useLensCommand(
    [
      { id: 'gov-overview', keys: 'g o', description: 'Caseload overview', category: 'navigation', action: () => go('overview') },
      { id: 'gov-bills', keys: 'g b', description: 'Bills', category: 'navigation', action: () => go('bills') },
      { id: 'gov-permits', keys: 'p', description: 'Permit case files', category: 'navigation', action: () => go('permits') },
      { id: 'gov-works', keys: 'u', description: 'Public works', category: 'navigation', action: () => go('works') },
      { id: 'gov-code', keys: 'c', description: 'Code enforcement', category: 'navigation', action: () => go('code') },
      { id: 'gov-records', keys: 'r', description: 'Records', category: 'navigation', action: () => go('records') },
      { id: 'gov-court', keys: 'o', description: 'Court', category: 'navigation', action: () => go('court') },
      { id: 'gov-311', keys: '3', description: '311 requests', category: 'navigation', action: () => go('sr') },
      { id: 'gov-reps', keys: 'g r', description: 'My representatives', category: 'navigation', action: () => go('reps') },
    ],
    { lensId: 'government' },
  );

  const group = useMemo(
    () => GROUPS.find((g) => g.items.some((i) => i.id === active)) ?? GROUPS[0],
    [active],
  );
  const activeLabel = group.items.find((t) => t.id === active)?.label ?? active;

  return (
    <LensShell lensId="government" asMain={false}>
      <FirstRunTour lensId="government" />
      <DepthBadge lensId="government" size="sm" className="ml-2" />
      <NorthStarFrame
        lensId="government"
        crumb="Government"
        title={`${group.title}${active === 'overview' && who ? `, ${who}` : ''}`}
        subtitle="Civic ops: caseload, bills, spending, FOIA, 311 and permits, representatives and case files, all against real government macros."
        actions={(
          <>
            <LiveIndicator isLive={isLive} lastUpdated={lastUpdated} compact />
            <DTUExportButton domain="government" data={{}} compact />
          </>
        )}
        tabs={GROUPS.map((g) => ({ id: g.id, label: g.label, icon: g.icon, hint: g.hint }))}
        activeTab={group.id}
        onTab={(id) => go(GROUPS.find((g) => g.id === id)!.items[0].id)}
        tabsLabel="Civic ops areas"
        cta={{ label: 'Report an issue', icon: MapPin, onClick: () => go('reporter'), title: 'Drop a pin and file a 311 report' }}
      >
        <a href="#government-main" className="sr-only focus:not-sr-only focus:ring-2 focus:ring-[var(--lens-accent)]">
          Skip to civic ops
        </a>
        <ShellPreview lensId="government" defaultOpen={true} />

        <nav aria-label={`${group.label} sections`} className="mb-5 flex flex-wrap items-center gap-1.5">
          {group.items.map((t) => {
            const on = active === t.id;
            return (
              <button
                key={t.id}
                type="button"
                onClick={() => go(t.id)}
                aria-current={on ? 'true' : undefined}
                className={cn(
                  'rounded-full border px-3.5 py-1 text-[13px] transition-colors',
                  on
                    ? 'border-white/20 bg-white/10 text-zinc-50'
                    : 'border-white/10 text-zinc-500 hover:text-zinc-200',
                )}
              >
                {t.label}
              </button>
            );
          })}
          <span className="ml-auto font-mono text-[11px] text-zinc-600">{activeLabel} · kbd g o / p / 3</span>
        </nav>

        <div className="mb-5 space-y-4">
          <LiveFeed
            articles={(realtimeData as { articles?: Array<Record<string, unknown>> } | null)?.articles as React.ComponentProps<typeof LiveFeed>['articles']}
            domain="government"
            isLive={isLive}
            lastUpdated={lastUpdated}
            limit={8}
          />
          <RealtimeDataPanel
            domain="government"
            data={realtimeData}
            isLive={isLive}
            lastUpdated={lastUpdated}
            insights={insights}
            compact
          />
        </div>

        <div id="government-main" className="min-w-0">
          <CivicPane active={active} onNavigateType={onNavigateType} />
        </div>
      </NorthStarFrame>

      <MobileTabBar
        tabs={[
          { id: 'overview', label: 'Ops', icon: Landmark },
          { id: 'permits', label: 'Permits', icon: MTabPermit },
          { id: 'works', label: 'PW', icon: MTabPW },
          { id: 'records', label: 'Records', icon: MTabRec },
          { id: 'court', label: 'Court', icon: MTabCourt },
          { id: 'bills', label: 'Bills', icon: MTabBills },
          { id: 'alerts', label: 'Alerts', icon: MTabAlert },
        ]}
        active={active}
        onSelect={(id) => go(id as GovView)}
      />
    </LensShell>
  );
}
