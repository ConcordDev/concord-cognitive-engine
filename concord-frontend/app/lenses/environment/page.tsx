'use client';

/**
 * Environment lens — NOAA/EPA environmental ops console.
 * One view union. Field survey, live government feeds, and the GHG desk
 * are panels under components/environment/. No stacked accordions.
 */

import { useState } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
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
  Globe,
} from 'lucide-react';
import { LensShell } from '@/components/lens/LensShell';
import { LensFeedButton } from '@/components/lens/LensFeedButton';
import { CrossLensRecentsPanel } from '@/components/lens/CrossLensRecentsPanel';
import { FirstRunTour } from '@/components/lens/FirstRunTour';
import { DepthBadge } from '@/components/lens/DepthBadge';
import { ShellPreview } from '@/components/lens/ShellPreview';
import { DTUExportButton } from '@/components/lens/DTUExportButton';
import { MobileTabBar } from '@/components/mobile/MobileTabBar';
import { useLensNav } from '@/hooks/useLensNav';
import { useLensCommand } from '@/hooks/useLensCommand';
import { useLensIdentity } from '@/hooks/useLensIdentity';
import { ds } from '@/lib/design-system';
import { cn } from '@/lib/utils';
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

const TABS: { id: EnvView; label: string; icon: typeof Wind; keys: string }[] = [
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

  const reduceMotion =
    typeof window !== 'undefined' && window.matchMedia('(prefers-reduced-motion: reduce)').matches;

  return (
    <LensShell lensId="environment" asMain={false}>
      <FirstRunTour lensId="environment" />
      <DepthBadge lensId="environment" size="sm" className="ml-2" />
      <div data-lens-theme="environment" className={ds.pageContainer}>
        <a
          href="#environment-main"
          className="sr-only focus:not-sr-only focus:ring-2 focus:ring-emerald-500 focus:outline-none"
        >
          Skip to environment content
        </a>
        <ShellPreview lensId="environment" defaultOpen={false} />

        <header className={ds.sectionHeader}>
          <div className="flex items-center gap-3">
            <Globe className="h-8 w-8 text-emerald-400" />
            <div>
              <h1 className={ds.heading1}>Environment</h1>
              <p className={ds.textMuted}>
                NOAA / EPA ops — AirNow, Superfund, USGS, field survey, GHG Protocol inventory
              </p>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <LensFeedButton domain="environment" label="Live environment feed" />
            <DTUExportButton domain="environment" data={{}} compact />
          </div>
        </header>

        <div className="flex flex-col gap-4 md:flex-row">
          <nav
            className="flex shrink-0 gap-1 overflow-x-auto border-b border-emerald-900/40 pb-2 md:w-44 md:flex-col md:overflow-visible md:border-b-0 md:border-r md:pb-0 md:pr-3"
            aria-label="Environment views"
          >
            {TABS.map((tab) => {
              const Icon = tab.icon;
              const on = activeView === tab.id;
              return (
                <button
                  key={tab.id}
                  type="button"
                  onClick={() => setActiveView(tab.id)}
                  className={cn(
                    'flex items-center gap-2 whitespace-nowrap rounded-md border px-3 py-2 text-sm font-medium transition-colors',
                    on
                      ? 'border-emerald-500/30 bg-emerald-500/15 text-emerald-200'
                      : 'border-transparent text-gray-400 hover:bg-white/[0.04] hover:text-white',
                  )}
                >
                  <Icon className="h-4 w-4" />
                  {tab.label}
                  <kbd className="ml-auto hidden font-mono text-[10px] text-gray-500 md:inline">
                    {tab.keys}
                  </kbd>
                </button>
              );
            })}
          </nav>

          <main id="environment-main" className="min-w-0 flex-1">
            <AnimatePresence mode="wait">
              <motion.div
                key={activeView}
                initial={reduceMotion ? false : { opacity: 0, y: 8 }}
                animate={{ opacity: 1, y: 0 }}
                exit={reduceMotion ? undefined : { opacity: 0, y: -6 }}
                transition={reduceMotion ? { duration: 0 } : { duration: 0.18 }}
              >
                <EnvironmentView active={activeView} />
              </motion.div>
            </AnimatePresence>
          </main>
        </div>

        <CrossLensRecentsPanel
          lensId="environment"
          sinceDays={7}
          limit={6}
          hideWhenEmpty
          className="mt-3"
        />
      </div>

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
