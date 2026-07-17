'use client';

/**
 * Supply Chain — control-tower rebuild (Frontend Rebuild Program, Wave 2).
 *
 * Reference target: SAP Integrated Business Planning (IBP) / a supply-chain
 * control tower — real-time visibility, KPI tracking, exception alerts,
 * demand/supply/inventory balancing, what-if scenario analysis. See
 * docs/lens-specs/supplychain-capability-map.md for the full researched
 * checklist and disposition of every item.
 *
 * This rebuild retires a generic multi-artifact-type CRUD library
 * (PurchaseOrder/Supplier/InventoryItem/... backed by generic DTU artifacts
 * unrelated to the real `supplychain` macros) that used to be the PRIMARY
 * surface of this page, with the real STATE-backed planning workbench
 * (`SupplyChainPlanner`, already wired to all 16 transactional macros)
 * buried below it as an afterthought. The real thing is now primary.
 *
 * Every number on this page traces to a live `supplychain` macro call.
 */

import { useState } from 'react';
import {
  Truck, LayoutDashboard, Network, ClipboardList, Newspaper, Users,
} from 'lucide-react';
import { LensShell } from '@/components/lens/LensShell';
import { FirstRunTour } from '@/components/lens/FirstRunTour';
import { DepthBadge } from '@/components/lens/DepthBadge';
import { useLensCommand } from '@/hooks/useLensCommand';
import { useLensNav } from '@/hooks/useLensNav';
import { cn } from '@/lib/utils';

import { SupplyChainOverview } from '@/components/supplychain/SupplyChainOverview';
import { SupplyChainPlanner } from '@/components/supplychain/SupplyChainPlanner';
import { SupplyChainActionPanel } from '@/components/supplychain/SupplyChainActionPanel';
import { SupplyChainFeed } from '@/components/supplychain/SupplyChainFeed';
import { OrgCollabPanel } from '@/components/supplychain/OrgCollabPanel';
import { PipingProvider } from '@/components/panel-polish';

type Destination = 'overview' | 'tower' | 'scorecards' | 'team' | 'pulse';

const DESTINATIONS: { id: Destination; label: string; icon: typeof Truck; desc: string }[] = [
  { id: 'overview', label: 'Overview', icon: LayoutDashboard, desc: 'Live control-tower KPIs & exceptions' },
  { id: 'tower', label: 'Control Tower', icon: Network, desc: 'Shipments · network · echelon · scenarios · forecast · procurement' },
  { id: 'scorecards', label: 'Scorecards & Analysis', icon: ClipboardList, desc: 'Lead time · EOQ · supplier scorecard · demand forecast' },
  { id: 'team', label: 'Team', icon: Users, desc: 'Planner · buyer · analyst collaboration on a shared firm' },
  { id: 'pulse', label: 'Industry Pulse', icon: Newspaper, desc: 'Real-world r/supplychain chatter' },
];

export default function SupplyChainLensPage() {
  useLensNav('supplychain');
  const [dest, setDest] = useState<Destination>('overview');

  // Real navigation shortcuts only — the old "/" focus-search binding
  // targeted the generic CRUD library's search box, which this rebuild
  // retires. Control Tower and Scorecards each own their own real search /
  // input fields; there is no single page-level search field to fake a
  // shortcut for, so none is registered here.
  useLensCommand(
    [
      { id: 'goto-overview', keys: 'g o', description: 'Go to Overview', category: 'navigation', action: () => setDest('overview') },
      { id: 'goto-tower', keys: 'g t', description: 'Go to Control Tower', category: 'navigation', action: () => setDest('tower') },
      { id: 'goto-scorecards', keys: 'g s', description: 'Go to Scorecards & Analysis', category: 'navigation', action: () => setDest('scorecards') },
      { id: 'goto-team', keys: 'g u', description: 'Go to Team', category: 'navigation', action: () => setDest('team') },
      { id: 'goto-pulse', keys: 'g p', description: 'Go to Industry Pulse', category: 'navigation', action: () => setDest('pulse') },
    ],
    { lensId: 'supplychain' }
  );

  return (
    <LensShell lensId="supplychain" asMain={false}>
      <FirstRunTour lensId="supplychain" />
      <div data-lens-theme="supplychain" className="space-y-6 p-6">
        <header className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex items-center gap-4">
            <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-teal-500 to-cyan-600 flex items-center justify-center">
              <Truck className="w-5 h-5 text-white" />
            </div>
            <div>
              <div className="flex items-center gap-2">
                <h1 className="text-2xl font-bold text-white">Supply Chain Control Tower</h1>
                <DepthBadge lensId="supplychain" size="sm" />
              </div>
              <p className="text-sm text-gray-400">
                End-to-end visibility, exception management, and what-if planning over your real shipment,
                network, inventory, and procurement state.
              </p>
            </div>
          </div>
        </header>

        <nav className="flex flex-wrap items-center gap-2 border-b border-lattice-border pb-3" aria-label="Supply chain destinations">
          {DESTINATIONS.map((d) => {
            const Icon = d.icon;
            const active = dest === d.id;
            return (
              <button
                key={d.id}
                type="button"
                onClick={() => setDest(d.id)}
                aria-current={active ? 'page' : undefined}
                className={cn(
                  'group flex flex-col items-start gap-0.5 rounded-lg px-3 py-2 text-left transition-colors min-w-[9rem]',
                  active ? 'bg-teal-500/15 border border-teal-500/40' : 'border border-transparent hover:bg-lattice-elevated hover:border-lattice-border'
                )}
              >
                <span className={cn('flex items-center gap-1.5 text-sm font-medium', active ? 'text-teal-200' : 'text-gray-300 group-hover:text-white')}>
                  <Icon className="w-4 h-4" /> {d.label}
                </span>
                <span className="text-[10px] text-gray-500 leading-tight">{d.desc}</span>
              </button>
            );
          })}
        </nav>

        {dest === 'overview' && <SupplyChainOverview onJump={(d) => setDest(d)} />}

        {dest === 'tower' && (
          <section aria-label="Control tower">
            <SupplyChainPlanner />
          </section>
        )}

        {dest === 'scorecards' && (
          <section aria-label="Scorecards and quick analysis" className="rounded-xl border border-zinc-800 bg-zinc-950/40 p-4">
            <PipingProvider>
              <SupplyChainActionPanel />
            </PipingProvider>
          </section>
        )}

        {dest === 'team' && (
          <section aria-label="Team collaboration">
            <OrgCollabPanel />
          </section>
        )}

        {dest === 'pulse' && (
          <section aria-label="Industry pulse" className="rounded-xl border border-zinc-800 bg-zinc-950/40 p-4">
            <SupplyChainFeed />
          </section>
        )}
      </div>

      {/* Accessibility skip-link sentinel — never visually displayed. */}
      <a href="#supplychain-skip" className="sr-only focus:not-sr-only focus:ring-2 focus:ring-amber-500 focus:outline-none">
        Skip to supply chain content
      </a>
    </LensShell>
  );
}
