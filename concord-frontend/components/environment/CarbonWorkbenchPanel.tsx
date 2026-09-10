'use client';

/**
 * CarbonWorkbenchPanel — Watershed / Persefoni GHG desk.
 * Sub-nav is panel-owned; the lens page has a single view union.
 */

import { useState } from 'react';
import EmissionsActivitiesPanel from '@/components/environment/EmissionsActivitiesPanel';
import EmissionFactorsLibrary from '@/components/environment/EmissionFactorsLibrary';
import SuppliersPortal from '@/components/environment/SuppliersPortal';
import TargetsTracker from '@/components/environment/TargetsTracker';
import ProjectsBacklog from '@/components/environment/ProjectsBacklog';
import RECsLedger from '@/components/environment/RECsLedger';
import OffsetsLedger from '@/components/environment/OffsetsLedger';
import EJScreenLookup from '@/components/environment/EJScreenLookup';
import ReportsBuilder from '@/components/environment/ReportsBuilder';
import CarbonFootprintDashboard from '@/components/environment/CarbonFootprintDashboard';
import InventoryReportBuilder from '@/components/environment/InventoryReportBuilder';
import ActivityImportPanel from '@/components/environment/ActivityImportPanel';
import ScenarioModeler from '@/components/environment/ScenarioModeler';
import AuditTrailPanel from '@/components/environment/AuditTrailPanel';
import { cn } from '@/lib/utils';

const TABS = [
  { id: 'dashboard', label: 'Footprint' },
  { id: 'activities', label: 'Activities' },
  { id: 'import', label: 'Bulk import' },
  { id: 'factors', label: 'EPA factors' },
  { id: 'suppliers', label: 'Suppliers' },
  { id: 'targets', label: 'Targets' },
  { id: 'projects', label: 'Projects' },
  { id: 'scenarios', label: 'Scenarios' },
  { id: 'recs', label: 'RECs' },
  { id: 'offsets', label: 'Offsets' },
  { id: 'audit', label: 'Audit trail' },
  { id: 'inventory', label: 'GHG inventory' },
  { id: 'ejscreen', label: 'EJScreen' },
  { id: 'reports', label: 'Reports' },
] as const;

type DeskTab = (typeof TABS)[number]['id'];

export function CarbonWorkbenchPanel() {
  const [desk, setDesk] = useState<DeskTab>('dashboard');
  const [importNonce, setImportNonce] = useState(0);

  return (
    <section className="space-y-3">
      <h2 className="text-sm font-semibold uppercase tracking-wider text-emerald-300">
        GHG inventory desk
      </h2>
      <p className="text-xs text-gray-400">
        EPA GHG Emission Factors Hub + eGRID — Scope 1/2/3 activities, SBTi targets, RECs, offsets
      </p>
      <nav
        className="flex items-center gap-1 overflow-x-auto border-b border-emerald-900/30 pb-2"
        aria-label="GHG desk views"
      >
        {TABS.map((t) => (
          <button
            key={t.id}
            type="button"
            onClick={() => setDesk(t.id)}
            className={cn(
              'whitespace-nowrap rounded-md border px-3 py-1.5 font-mono text-xs transition',
              desk === t.id
                ? 'border-emerald-500/20 bg-emerald-500/15 text-emerald-300'
                : 'border-transparent text-gray-400 hover:bg-emerald-900/10 hover:text-emerald-300',
            )}
          >
            {t.label}
          </button>
        ))}
      </nav>
      <div>
        {desk === 'dashboard' && <CarbonFootprintDashboard />}
        {desk === 'activities' && <EmissionsActivitiesPanel key={importNonce} />}
        {desk === 'import' && (
          <ActivityImportPanel onImported={() => setImportNonce((n) => n + 1)} />
        )}
        {desk === 'factors' && <EmissionFactorsLibrary />}
        {desk === 'suppliers' && <SuppliersPortal />}
        {desk === 'targets' && <TargetsTracker />}
        {desk === 'projects' && <ProjectsBacklog />}
        {desk === 'scenarios' && <ScenarioModeler />}
        {desk === 'recs' && <RECsLedger />}
        {desk === 'offsets' && <OffsetsLedger />}
        {desk === 'audit' && <AuditTrailPanel />}
        {desk === 'inventory' && <InventoryReportBuilder />}
        {desk === 'ejscreen' && <EJScreenLookup />}
        {desk === 'reports' && <ReportsBuilder />}
      </div>
    </section>
  );
}
