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
import { NorthStarFrame } from '@/components/lens/NorthStarFrame';
import { useAuth } from '@/hooks/useAuth';
import { titleCaseDisplayName } from '@/components/chat/claudeCleanGreeting';

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

const TABS = DESTINATIONS.map((d) => ({ id: d.id, label: d.label, icon: d.icon, hint: d.desc }));

export default function SupplyChainLensPage() {
  useLensNav('supplychain');
  const { user } = useAuth();
  const who = titleCaseDisplayName(user?.username);
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

  const current = DESTINATIONS.find((d) => d.id === dest)!;
  const title = dest === 'overview' ? `Your supply chain${who ? `, ${who}` : ''}` : current.label;

  return (
    <LensShell lensId="supplychain" asMain={false}>
      <FirstRunTour lensId="supplychain" />
      <DepthBadge lensId="supplychain" size="sm" className="ml-2" />
      <NorthStarFrame
        lensId="supplychain"
        crumb="Supply chain"
        title={title}
        subtitle="End-to-end visibility, exception management and what-if planning over your real shipment, network, inventory and procurement state."
        tabs={TABS}
        activeTab={dest}
        onTab={(id) => setDest(id as Destination)}
        tabsLabel="Supply chain destinations"
        cta={{ label: 'Open control tower', icon: Network, onClick: () => setDest('tower'), title: 'Shipments, network, scenarios and procurement' }}
      >
        {dest === 'overview' && <SupplyChainOverview onJump={(d) => setDest(d)} />}

        {dest === 'tower' && (
          <section aria-label="Control tower">
            <SupplyChainPlanner />
          </section>
        )}

        {dest === 'scorecards' && (
          <section aria-label="Scorecards and quick analysis" className="rounded-2xl border border-white/10 bg-[#111] p-4">
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
          <section aria-label="Industry pulse" className="rounded-2xl border border-white/10 bg-[#111] p-4">
            <SupplyChainFeed />
          </section>
        )}
      </NorthStarFrame>
    </LensShell>
  );
}
