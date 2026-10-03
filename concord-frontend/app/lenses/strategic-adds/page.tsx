'use client';

import { useState } from 'react';
import Link from 'next/link';
import dynamic from 'next/dynamic';
import { Layers, Shield, Brain, GraduationCap, AlertTriangle, Briefcase, BadgeCheck, Users, Rocket } from 'lucide-react';
import { LensShell } from '@/components/lens/LensShell';
import { NorthStarFrame } from '@/components/lens/NorthStarFrame';
import { FirstRunTour } from '@/components/lens/FirstRunTour';
import { DepthBadge } from '@/components/lens/DepthBadge';
import { LensErrorBoundary } from '@/components/lens/LensErrorBoundary';
import { useLensNav } from '@/hooks/useLensNav';
import { useLensCommand } from '@/hooks/useLensCommand';

function PanelSkeleton() {
  return (
    <div role="status" aria-busy="true" aria-live="polite" className="h-40 animate-pulse rounded-2xl border border-white/10 bg-white/[0.03] p-4 text-sm text-zinc-500">
      Loading panel…
    </div>
  );
}

const DataControlsPanel = dynamic(() => import('@/components/privacy/DataControlsPanel').then((m) => m.DataControlsPanel), { ssr: false, loading: PanelSkeleton });
const ConnectorCatalog = dynamic(() => import('@/components/integrations/ConnectorCatalog').then((m) => m.ConnectorCatalog), { ssr: false, loading: PanelSkeleton });
const FocusToolkit = dynamic(() => import('@/components/attention/FocusToolkit').then((m) => m.FocusToolkit), { ssr: false, loading: PanelSkeleton });
const SrsWorkbench = dynamic(() => import('@/components/srs/SrsWorkbench').then((m) => m.SrsWorkbench), { ssr: false, loading: PanelSkeleton });
const SeismicHazardPanel = dynamic(() => import('@/components/geology/SeismicHazardPanel').then((m) => m.SeismicHazardPanel), { ssr: false, loading: PanelSkeleton });
const FireIncidents = dynamic(() => import('@/components/forestry/FireIncidents').then((m) => m.FireIncidents), { ssr: false, loading: PanelSkeleton });
const BlsSeriesExplorer = dynamic(() => import('@/components/hr/BlsSeriesExplorer').then((m) => m.BlsSeriesExplorer), { ssr: false, loading: PanelSkeleton });
const BlsWageForecast = dynamic(() => import('@/components/hr/BlsWageForecast').then((m) => m.BlsWageForecast), { ssr: false, loading: PanelSkeleton });
const ClaimVerificationPanel = dynamic(() => import('@/components/grounding/ClaimVerificationPanel').then((m) => m.ClaimVerificationPanel), { ssr: false, loading: PanelSkeleton });
const FactGroundingWorkbench = dynamic(() => import('@/components/grounding/FactGroundingWorkbench').then((m) => m.FactGroundingWorkbench), { ssr: false, loading: PanelSkeleton });
const DevToolingPulse = dynamic(() => import('@/components/dx-platform/DevToolingPulse').then((m) => m.DevToolingPulse), { ssr: false, loading: PanelSkeleton });

type AddTab = 'api' | 'burnout' | 'learning' | 'hazard' | 'labor' | 'misinfo' | 'contacts' | 'golive';

const TABS: Array<{ id: AddTab; label: string; icon: typeof Layers }> = [
  { id: 'api', label: '1) Sovereign API Hub', icon: Shield },
  { id: 'burnout', label: '2) Burnout + Focus', icon: Brain },
  { id: 'learning', label: '3) Adaptive Learning Twin', icon: GraduationCap },
  { id: 'hazard', label: '4) Disaster Hazard Suite', icon: AlertTriangle },
  { id: 'labor', label: '5) Labor/Career Forecasting', icon: Briefcase },
  { id: 'misinfo', label: '6) Provenance Shield', icon: BadgeCheck },
  { id: 'contacts', label: '7) Contact + Preference Network', icon: Users },
  { id: 'golive', label: '8) Go-live Platform', icon: Rocket },
];

export default function StrategicAddsPage() {
  useLensNav('strategic-adds');
  const [tab, setTab] = useState<AddTab>('api');

  useLensCommand(
    [
      { id: 'sa-api', keys: '1', description: 'Sovereign API Hub', category: 'navigation', action: () => setTab('api') },
      { id: 'sa-burnout', keys: '2', description: 'Burnout + Focus', category: 'navigation', action: () => setTab('burnout') },
      { id: 'sa-learning', keys: '3', description: 'Adaptive Learning Twin', category: 'navigation', action: () => setTab('learning') },
      { id: 'sa-hazard', keys: '4', description: 'Disaster Hazard Suite', category: 'navigation', action: () => setTab('hazard') },
      { id: 'sa-labor', keys: '5', description: 'Labor/Career Forecasting', category: 'navigation', action: () => setTab('labor') },
      { id: 'sa-misinfo', keys: '6', description: 'Provenance Shield', category: 'navigation', action: () => setTab('misinfo') },
      { id: 'sa-contacts', keys: '7', description: 'Contact + Preference Network', category: 'navigation', action: () => setTab('contacts') },
      { id: 'sa-golive', keys: '8', description: 'Go-live Platform', category: 'navigation', action: () => setTab('golive') },
    ],
    { lensId: 'strategic-adds' }
  );

  return (
    <LensShell lensId="strategic-adds" asMain={false}>
      <FirstRunTour lensId="strategic-adds" />
      <DepthBadge lensId="strategic-adds" size="sm" className="ml-2" />

      <NorthStarFrame
        lensId="strategic-adds"
        theme="command"
        crumb="Strategic adds"
        title="Pick the next bet"
        subtitle="Productized hub for the eight next adds. Each tab is wired to real substrate already in the repo."
        tabs={TABS.map(({ id, label, icon }, i) => ({ id, label, icon, keys: String(i + 1) }))}
        activeTab={tab}
        onTab={(id) => setTab(id as AddTab)}
        tabsLabel="Strategic add tracks"
        cta={{ label: 'Go-live platform', icon: Rocket, onClick: () => setTab('golive') }}
      >
        <LensErrorBoundary key={tab} lensId="strategic-adds">
        {tab === 'api' && (
          <section className="space-y-4">
            <p className="text-sm text-zinc-300">Config UX + consent scope management for personal sovereign APIs.</p>
            <DataControlsPanel />
            <ConnectorCatalog />
          </section>
        )}

        {tab === 'burnout' && (
          <section className="space-y-4">
            <p className="text-sm text-zinc-300">Daily focus/recovery flow using real attention + productivity substrate.</p>
            <FocusToolkit />
          </section>
        )}

        {tab === 'learning' && (
          <section className="space-y-4">
            <p className="text-sm text-zinc-300">Dedicated adaptive learning loop over the real SRS engine.</p>
            <SrsWorkbench />
          </section>
        )}

        {tab === 'hazard' && (
          <section className="space-y-4">
            <p className="text-sm text-zinc-300">Unified seismic + wildfire hazard views with live feeds and deterministic scoring.</p>
            <div className="rounded-2xl border border-white/10 bg-[#111] p-4">
              <SeismicHazardPanel />
            </div>
            <div className="rounded-2xl border border-white/10 bg-[#111] p-4">
              <FireIncidents />
            </div>
          </section>
        )}

        {tab === 'labor' && (
          <section className="space-y-4">
            <p className="text-sm text-zinc-300">BLS time-series + forecast workflows for labor and opportunity scanning.</p>
            <BlsSeriesExplorer />
            <div className="rounded-2xl border border-white/10 bg-[#111] p-4">
              <BlsWageForecast />
            </div>
          </section>
        )}

        {tab === 'misinfo' && (
          <section className="space-y-4">
            <p className="text-sm text-zinc-300">Claim verification and evidence aggregation workflows at operator scale.</p>
            <ClaimVerificationPanel />
            <FactGroundingWorkbench />
          </section>
        )}

        {tab === 'contacts' && (
          <section role="status" aria-label="Contact network status" className="rounded-xl border border-amber-700/30 bg-amber-600/10 p-4 sm:p-5">
            {/* No contact graph exists yet: honest empty state */}
            <h2 className="text-sm font-semibold text-amber-200">Honest status: foundational packaging only</h2>
            <p className="mt-2 text-sm text-amber-100/90">
              A dedicated contact+preference graph is not yet built. Use existing controls while the purpose-built network lands.
            </p>
            <div className="mt-3 flex flex-wrap gap-3 text-sm">
              <Link className="underline text-amber-100" href="/lenses/privacy">Open Privacy preferences</Link>
              <Link className="underline text-amber-100" href="/lenses/social">Open Social network controls</Link>
            </div>
          </section>
        )}

        {tab === 'golive' && (
          <section className="space-y-4">
            <p className="text-sm text-zinc-300">MCP/IDE rollout hardening with onboarding and live telemetry.</p>
            <div className="flex flex-col gap-2 text-sm sm:flex-row sm:flex-wrap sm:gap-3">
              <Link className="underline text-cyan-300" href="/lenses/dx-platform">DX onboarding flow</Link>
              <Link className="underline text-cyan-300" href="/lenses/integrations">Connector registry and workflows</Link>
            </div>
            <DevToolingPulse />
          </section>
        )}
        </LensErrorBoundary>
      </NorthStarFrame>
    </LensShell>
  );
}
