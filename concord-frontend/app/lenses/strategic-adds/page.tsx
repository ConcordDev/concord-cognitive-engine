'use client';

import { useState } from 'react';
import Link from 'next/link';
import { Layers, Shield, Brain, GraduationCap, AlertTriangle, Briefcase, BadgeCheck, Users, Rocket } from 'lucide-react';
import { LensShell } from '@/components/lens/LensShell';
import { FirstRunTour } from '@/components/lens/FirstRunTour';
import { DepthBadge } from '@/components/lens/DepthBadge';
import { useLensNav } from '@/hooks/useLensNav';
import { useLensCommand } from '@/hooks/useLensCommand';
import { DataControlsPanel } from '@/components/privacy/DataControlsPanel';
import { ConnectorCatalog } from '@/components/integrations/ConnectorCatalog';
import { FocusToolkit } from '@/components/attention/FocusToolkit';
import { SrsWorkbench } from '@/components/srs/SrsWorkbench';
import { SeismicHazardPanel } from '@/components/geology/SeismicHazardPanel';
import { FireIncidents } from '@/components/forestry/FireIncidents';
import { BlsSeriesExplorer } from '@/components/hr/BlsSeriesExplorer';
import { BlsWageForecast } from '@/components/hr/BlsWageForecast';
import { ClaimVerificationPanel } from '@/components/grounding/ClaimVerificationPanel';
import { FactGroundingWorkbench } from '@/components/grounding/FactGroundingWorkbench';
import { DevToolingPulse } from '@/components/dx-platform/DevToolingPulse';

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
      <FirstRunTour lensId="strategic-adds" />      <DepthBadge lensId="strategic-adds" size="sm" className="ml-2" />

      <div data-lens-theme="command" className="p-6 space-y-6">
        <header className="space-y-2">
          <h1 className="text-2xl font-bold text-white">Strategic Adds Launchpad</h1>
          <p className="text-sm text-zinc-400">
            Productized hub for the eight next adds. Each tab is wired to real substrate already in the repo.
          </p>
        </header>

        <nav className="flex flex-wrap gap-2 border-b border-zinc-800 pb-3" aria-label="Strategic add tracks">
          {TABS.map(({ id, label, icon: Icon }) => {
            const active = tab === id;
            return (
              <button
                key={id}
                type="button"
                onClick={() => setTab(id)}
                className={`flex items-center gap-2 rounded-lg border px-3 py-2 text-xs transition-colors ${
                  active
                    ? 'border-cyan-500/50 bg-cyan-500/10 text-cyan-200'
                    : 'border-zinc-800 bg-zinc-950/40 text-zinc-400 hover:text-zinc-200'
                }`}
              >
                <Icon className="h-3.5 w-3.5" />
                {label}
              </button>
            );
          })}
        </nav>

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
            <div className="rounded-xl border border-zinc-800 bg-zinc-950/40 p-4">
              <SeismicHazardPanel />
            </div>
            <div className="rounded-xl border border-zinc-800 bg-zinc-950/40 p-4">
              <FireIncidents />
            </div>
          </section>
        )}

        {tab === 'labor' && (
          <section className="space-y-4">
            <p className="text-sm text-zinc-300">BLS time-series + forecast workflows for labor and opportunity scanning.</p>
            <BlsSeriesExplorer />
            <div className="rounded-xl border border-zinc-800 bg-zinc-950/40 p-4">
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
          <section className="rounded-xl border border-amber-700/30 bg-amber-600/10 p-4">
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
            <div className="flex flex-wrap gap-3 text-sm">
              <Link className="underline text-cyan-300" href="/lenses/dx-platform">DX onboarding flow</Link>
              <Link className="underline text-cyan-300" href="/lenses/integrations">Connector registry and workflows</Link>
            </div>
            <DevToolingPulse />
          </section>
        )}
      </div>
    </LensShell>
  );
}
