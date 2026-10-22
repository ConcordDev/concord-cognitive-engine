'use client';

/**
 * Environment lens — NOAA/EPA environmental ops console.
 * One view union. Field survey, live government feeds, and the GHG desk
 * are panels under components/environment/. No stacked accordions.
 */

import { useState } from 'react';
import {
  Wind,
  MapPin,
  Bug,
  FlaskConical,
  Footprints,
  Recycle,
  ShieldCheck,
  Calculator,
  Trees,
  Leaf,
  BarChart3,
  Factory,
  Droplets,
  Target,
  Map,
  Plus,
} from 'lucide-react';
import { LensShell } from '@/components/lens/LensShell';
import { LensFeedButton } from '@/components/lens/LensFeedButton';
import { NorthStarFrame } from '@/components/lens/NorthStarFrame';
import { DepthBadge } from '@/components/lens/DepthBadge';
import { ShellPreview } from '@/components/lens/ShellPreview';
import { DTUExportButton } from '@/components/lens/DTUExportButton';
import { MobileTabBar } from '@/components/mobile/MobileTabBar';
import { useLensNav } from '@/hooks/useLensNav';
import { useLensCommand } from '@/hooks/useLensCommand';
import { useLensIdentity } from '@/hooks/useLensIdentity';
import { WatchPanel } from '@/components/environment/WatchPanel';
import { FieldOpsPanel, type FieldOpsKind } from '@/components/environment/FieldOpsPanel';
import { CarbonWorkbenchPanel } from '@/components/environment/CarbonWorkbenchPanel';
import { ComplianceDiversionPanel } from '@/components/environment/ComplianceDiversionPanel';
import { FieldMonitoringPanel } from '@/components/environment/FieldMonitoringPanel';

export type EnvView =
  | 'watch'
  | 'overview'
  | 'sites'
  | 'species'
  | 'sampling'
  | 'trails'
  | 'waste'
  | 'compliance'
  | 'diversion'
  | 'field'
  | 'ledger'
  | 'ghg'
  | 'resources'
  | 'goals'
  | 'map';

const TABS: { id: EnvView; label: string; icon: typeof Wind; keys: string; }[] = [
  { id: 'watch', label: 'Watch', icon: Wind, keys: 'w' },
  { id: 'overview', label: 'Overview', icon: BarChart3, keys: 'd' },
  { id: 'sites', label: 'Sites', icon: MapPin, keys: 's' },
  { id: 'species', label: 'Species', icon: Bug, keys: 'p' },
  { id: 'sampling', label: 'Sampling', icon: FlaskConical, keys: 'a' },
  { id: 'trails', label: 'Trails', icon: Footprints, keys: 't' },
  { id: 'waste', label: 'Waste', icon: Recycle, keys: 'u' },
  { id: 'compliance', label: 'Permits', icon: ShieldCheck, keys: 'c' },
  { id: 'diversion', label: 'Diversion', icon: Calculator, keys: 'v' },
  { id: 'field', label: 'Trends', icon: Trees, keys: 'f' },
  { id: 'ledger', label: 'Emissions log', icon: Leaf, keys: 'n' },
  { id: 'ghg', label: 'GHG desk', icon: Factory, keys: 'g' },
  { id: 'resources', label: 'Resources', icon: Droplets, keys: 'r' },
  { id: 'goals', label: 'Goals', icon: Target, keys: 'o' },
  { id: 'map', label: 'Map', icon: Map, keys: 'm' },
];

const FIELD_KIND: Partial<Record<EnvView, FieldOpsKind>> = {
  sites: 'Sites',
  species: 'Species',
  sampling: 'Sampling',
  trails: 'Trails',
  waste: 'Waste',
  compliance: 'Compliance',
  ledger: 'Carbon',
  resources: 'Resources',
  goals: 'Goals',
  map: 'Map',
};

export default function EnvironmentLensPage() {
  useLensNav('environment');
  useLensIdentity('environment');
  const [activeView, setActiveView] = useState<EnvView>('watch');

  useLensCommand(
    TABS.map((t) => ({
      id: `env-${t.id}`,
      keys: t.keys,
      description: t.label,
      category: 'navigation' as const,
      action: () => setActiveView(t.id),
    })),
    { lensId: 'environment' },
  );


  return (
    <LensShell lensId="environment" asMain={false}>

      <DepthBadge lensId="environment" size="sm" className="ml-2" />
      <NorthStarFrame
        lensId="environment"
        crumb="Environment"
        subtitle="NOAA / Open-Meteo air quality, Superfund, USGS, field survey and GHG Protocol inventory."
        actions={
          <>
            <LensFeedButton domain="environment" label="Live environment feed" />
            <DTUExportButton domain="environment" data={{}} compact />
          </>
        }
        tabs={TABS.map((t) => ({ id: t.id, label: t.label, icon: t.icon, keys: t.keys }))}
        activeTab={activeView}
        onTab={(id) => setActiveView(id as EnvView)}
        tabsLabel="Environment views"
        cta={{ label: 'Log a site', icon: Plus, onClick: () => setActiveView('sites'), title: 'Open Sites to add a monitoring site' }}
      >
        <a
          href="#environment-main"
          className="sr-only focus:not-sr-only focus:ring-2 focus:ring-emerald-500 focus:outline-none"
        >
          Skip to environment content
        </a>
        <ShellPreview lensId="environment" defaultOpen={false} />
        <main id="environment-main" className="min-w-0">
          <EnvironmentView active={activeView} />
        </main>
      </NorthStarFrame>

      <MobileTabBar
        tabs={[
          { id: 'watch', label: 'Watch', icon: Wind },
          { id: 'sites', label: 'Sites', icon: MapPin },
          { id: 'sampling', label: 'Samp', icon: FlaskConical },
          { id: 'compliance', label: 'Permit', icon: ShieldCheck },
          { id: 'ghg', label: 'GHG', icon: Factory },
          { id: 'map', label: 'Map', icon: Map },
        ]}
        active={activeView}
        onSelect={(id) => setActiveView(id as EnvView)}
      />
    </LensShell>
  );
}

function EnvironmentView({ active }: { active: EnvView }) {
  if (active === 'watch') return <WatchPanel />;
  if (active === 'overview') return <FieldOpsPanel kind="Sites" initialView="dashboard" />;
  if (active === 'diversion') return <ComplianceDiversionPanel />;
  if (active === 'field') return <FieldMonitoringPanel />;
  if (active === 'ghg') return <CarbonWorkbenchPanel />;
  const fieldKind = FIELD_KIND[active];
  return <FieldOpsPanel kind={fieldKind ?? 'Sites'} />;
}
