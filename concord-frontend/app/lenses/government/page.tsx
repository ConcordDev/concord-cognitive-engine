'use client';

/**
 * Government — one civic-ops app.
 *
 * Reference: USAspending.gov / Congress.gov (dense grouped rail, tabular
 * caseload, no dashboard costume). Every view is a real panel wired to
 * government macros or useLensData artifacts. Nested CivicWorkbench
 * accordion is folded into the single `active` union.
 */

import { AnimatePresence, motion, useReducedMotion } from 'framer-motion';
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
import { ds } from '@/lib/design-system';
import { cn } from '@/lib/utils';
import {
  Landmark,
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

const GROUPS: { label: string; items: { id: GovView; label: string }[] }[] = [
  {
    label: 'Oversight',
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
    label: 'Congress',
    items: [
      { id: 'reps', label: 'My reps' },
      { id: 'advocacy', label: 'Advocacy' },
      { id: 'elections', label: 'Elections' },
      { id: 'meetings', label: 'Meetings' },
      { id: 'actions', label: 'Lookups' },
    ],
  },
  {
    label: '311 / Permits',
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
    label: 'Case files',
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
  const reduceMotion = useReducedMotion();
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

  const activeLabel = useMemo(
    () => GROUPS.flatMap((g) => g.items).find((t) => t.id === active)?.label ?? active,
    [active],
  );

  return (
    <LensShell lensId="government" asMain={false}>
      <FirstRunTour lensId="government" />
      <DepthBadge lensId="government" size="sm" className="ml-2" />
      <div data-lens-theme="government" className={cn(ds.pageContainer, 'pb-20 lg:pb-6')}>
        <a href="#government-main" className="sr-only focus:not-sr-only focus:ring-2 focus:ring-[var(--lens-accent)]">
          Skip to civic ops
        </a>
        <ShellPreview lensId="government" defaultOpen={true} />

        <header className={cn(ds.sectionHeader, 'gap-3 flex-wrap')}>
          <div className="flex items-center gap-3 min-w-0">
            <div className="w-9 h-9 rounded-md bg-[var(--lens-accent)]/20 flex items-center justify-center shrink-0">
              <Landmark className="w-5 h-5 text-[var(--lens-secondary)]" />
            </div>
            <div className="min-w-0">
              <div className="flex items-center gap-2 flex-wrap">
                <h1 className={ds.heading1}>Civic ops</h1>
                <LiveIndicator isLive={isLive} lastUpdated={lastUpdated} />
              </div>
              <p className={cn(ds.textMuted, 'font-mono text-xs tracking-wide')}>
                {activeLabel} · USAspending density · kbd g o / p / 3
              </p>
            </div>
          </div>
          <DTUExportButton domain="government" data={{}} compact />
        </header>

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

        <div className="grid grid-cols-1 lg:grid-cols-[13rem_minmax(0,1fr)] gap-4 items-start">
          <nav aria-label="Civic ops" className="lg:sticky lg:top-3 space-y-4">
            {GROUPS.map((group) => (
              <div key={group.label}>
                <p className={cn(ds.overline, 'px-2 mb-1')}>{group.label}</p>
                <ul className="space-y-0.5">
                  {group.items.map((t) => {
                    const on = active === t.id;
                    return (
                      <li key={t.id}>
                        <button
                          type="button"
                          onClick={() => go(t.id)}
                          className={cn(
                            'w-full text-left px-2 py-1 rounded-sm text-xs font-mono tracking-tight transition-colors',
                            on
                              ? 'bg-[var(--lens-accent)]/20 text-white border-l-2 border-[var(--lens-secondary)]'
                              : 'text-gray-400 hover:text-white hover:bg-lattice-elevated border-l-2 border-transparent',
                          )}
                        >
                          {t.label}
                        </button>
                      </li>
                    );
                  })}
                </ul>
              </div>
            ))}
          </nav>

          <main id="government-main" className="min-w-0">
            <AnimatePresence mode="wait">
              <motion.div
                key={active}
                initial={reduceMotion ? false : { opacity: 0, y: 6 }}
                animate={{ opacity: 1, y: 0 }}
                exit={reduceMotion ? undefined : { opacity: 0, y: -4 }}
                transition={{ duration: reduceMotion ? 0 : 0.16 }}
              >
                <CivicPane active={active} onNavigateType={onNavigateType} />
              </motion.div>
            </AnimatePresence>
          </main>
        </div>
      </div>

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
