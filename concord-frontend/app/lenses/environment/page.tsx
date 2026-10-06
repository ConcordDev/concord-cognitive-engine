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
import { FirstRunTour } from '@/components/lens/FirstRunTour';
import { DepthBadge } from '@/components/lens/DepthBadge';
import { ShellPreview } from '@/components/lens/ShellPreview';
import { DTUExportButton } from '@/components/lens/DTUExportButton';
import { MobileTabBar } from '@/components/mobile/MobileTabBar';
import { useLensNav } from '@/hooks/useLensNav';
import { useLensCommand } from '@/hooks/useLensCommand';
import { useLensIdentity } from '@/hooks/useLensIdentity';
import { useAuth } from '@/hooks/useAuth';
import { titleCaseDisplayName } from '@/components/chat/claudeCleanGreeting';
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

const TABS: { id: EnvView; label: string; icon: typeof Wind; keys: string; title: string }[] = [
  { id: 'watch', label: 'Watch', icon: Wind, keys: 'w', title: 'The air and water around you' },
  { id: 'overview', label: 'Overview', icon: BarChart3, keys: 'd', title: 'Your sites at a glance' },
  { id: 'sites', label: 'Sites', icon: MapPin, keys: 's', title: 'Where you monitor' },
  { id: 'species', label: 'Species', icon: Bug, keys: 'p', title: 'What lives at your sites' },
  { id: 'sampling', label: 'Sampling', icon: FlaskConical, keys: 'a', title: 'What the samples show' },
  { id: 'trails', label: 'Trails', icon: Footprints, keys: 't', title: 'Where you walk and survey' },
  { id: 'waste', label: 'Waste', icon: Recycle, keys: 'u', title: 'What gets thrown away' },
  { id: 'compliance', label: 'Permits', icon: ShieldCheck, keys: 'c', title: 'What you are permitted to do' },
  { id: 'diversion', label: 'Diversion', icon: Calculator, keys: 'v', title: 'How much stays out of landfill' },
  { id: 'field', label: 'Trends', icon: Trees, keys: 'f', title: 'How conditions are trending' },
  { id: 'ledger', label: 'Emissions log', icon: Leaf, keys: 'n', title: 'What you have emitted' },
  { id: 'ghg', label: 'GHG desk', icon: Factory, keys: 'g', title: 'Your greenhouse gas inventory' },
  { id: 'resources', label: 'Resources', icon: Droplets, keys: 'r', title: 'What you consume' },
  { id: 'goals', label: 'Goals', icon: Target, keys: 'o', title: 'What you are working toward' },
  { id: 'map', label: 'Map', icon: Map, keys: 'm', title: 'Everything on the map' },
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
  const { user } = useAuth();
  const who = titleCaseDisplayName(user?.username);
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

  const current = TABS.find((t) => t.id === activeView)!;

  return (
    <LensShell lensId="environment" asMain={false}>
      <FirstRunTour lensId="environment" />
      <DepthBadge lensId="environment" size="sm" className="ml-2" />
      <NorthStarFrame
        lensId="environment"
        crumb="Environment"
        title={`${current.title}${activeView === 'watch' && who ? `, ${who}` : ''}`}
        subtitle="NOAA / EPA ops: AirNow, Superfund, USGS, field survey and GHG Protocol inventory."
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
