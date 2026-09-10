'use client';

import { LensShell } from '@/components/lens/LensShell';
import { LensFeedButton } from '@/components/lens/LensFeedButton';
import { CrossLensRecentsPanel } from '@/components/lens/CrossLensRecentsPanel';
import { FirstRunTour } from '@/components/lens/FirstRunTour';
import { DepthBadge } from '@/components/lens/DepthBadge';
import { useState } from 'react';
import { useLensNav } from '@/hooks/useLensNav';
import { useLensCommand } from '@/hooks/useLensCommand';
import { ds } from '@/lib/design-system';
import { cn } from '@/lib/utils';
import { Store, ShoppingCart } from 'lucide-react';
import { useRealtimeLens } from '@/hooks/useRealtimeLens';
import { LiveIndicator } from '@/components/lens/LiveIndicator';
import { DTUExportButton } from '@/components/lens/DTUExportButton';
import { RealtimeDataPanel } from '@/components/lens/RealtimeDataPanel';
import LiveFeed from '@/components/lens/LiveFeed';
import RetailWorkbench from '@/components/retail/RetailWorkbench';
import { TaxRatesPanel } from '@/components/retail/TaxRatesPanel';
import { LivePosTerminal } from '@/components/retail/LivePosTerminal';
import { RetailActionPanel } from '@/components/retail/RetailActionPanel';
import { PipingProvider } from '@/components/panel-polish';
import CustomersPanel from '@/components/retail/CustomersPanel';
import PipelinePanel from '@/components/retail/PipelinePanel';
import TicketQueuePanel from '@/components/retail/TicketQueuePanel';
import DisplaysPanel from '@/components/retail/DisplaysPanel';
import DiscountsManager from '@/components/retail/DiscountsManager';
import AbandonedCartsPanel from '@/components/retail/AbandonedCartsPanel';
import ShippingZonesEditor from '@/components/retail/ShippingZonesEditor';
import GiftCardsPanel from '@/components/retail/GiftCardsPanel';
import RefundsPanel from '@/components/retail/RefundsPanel';
import CollectionsPanel from '@/components/retail/CollectionsPanel';
import InventoryTransfers from '@/components/retail/InventoryTransfers';
import SalesAnalytics from '@/components/retail/SalesAnalytics';
import CommerceSuite from '@/components/retail/CommerceSuite';
import { ShellPreview } from '@/components/lens/ShellPreview';
import { ChevronDown } from 'lucide-react';

/* ------------------------------------------------------------------ */
/*  Page                                                               */
/*                                                                      */
/*  Every panel below reads/writes through a registered `retail.*`     */
/*  macro (server/domains/retail.js, 85 macros) — no generic artifact  */
/*  CRUD store, no client-invented data. See                           */
/*  docs/lens-specs/retail-capability-map.md for the full audit.       */
/* ------------------------------------------------------------------ */

export default function RetailLensPage() {
  useLensNav('retail');
  const { latestData: realtimeData, isLive, lastUpdated, insights } = useRealtimeLens('retail');
  const [workbenchOpen, setWorkbenchOpen] = useState(false);

  useLensCommand(
    [
      { id: 'open-workbench', keys: 'w', description: 'Open Retail Workbench (POS/catalog/orders)', category: 'navigation', action: () => setWorkbenchOpen(true) },
    ],
    { lensId: 'retail' },
  );

  return (
    <LensShell lensId="retail" asMain={false}>
      <FirstRunTour lensId="retail" />
      <DepthBadge lensId="retail" size="sm" className="ml-2" />
      <div data-lens-theme="retail" className={ds.pageContainer}>
        <ShellPreview lensId="retail" defaultOpen={true} />

        {/* Header */}
        <header className={ds.sectionHeader}>
          <div className="flex items-center gap-3">
            <Store className="w-7 h-7 text-neon-purple" />
            <div>
              <div className="flex items-center gap-2">
                <h1 className={ds.heading1}>Retail &amp; Commerce</h1>
                <LiveIndicator isLive={isLive} lastUpdated={lastUpdated} />
              </div>
              <p className={ds.textMuted}>Point of sale, catalog, fulfillment, storefront &amp; ops — one real backend, no seeded data.</p>
            </div>
          </div>
          <button
            type="button"
            onClick={() => setWorkbenchOpen(true)}
            className="inline-flex items-center gap-2 px-4 py-2.5 rounded-full bg-rose-500 hover:bg-rose-400 text-rose-50 shadow-lg text-sm font-medium"
            title="Retail Workbench — POS register, catalog, orders, low stock (press W)"
          >
            <ShoppingCart className="w-4 h-4" /> Retail Workbench <kbd className="ml-1 px-1.5 py-0.5 rounded bg-black/20 text-[10px] font-mono">W</kbd>
          </button>
        </header>
        <RetailWorkbench open={workbenchOpen} onClose={() => setWorkbenchOpen(false)} />

        {/* Retail Wire — BLS CPI + Census Retail live feed */}
        <LiveFeed
          articles={(realtimeData as { articles?: Array<Record<string, unknown>> } | null)?.articles as React.ComponentProps<typeof LiveFeed>['articles']}
          domain="retail"
          isLive={isLive}
          lastUpdated={lastUpdated}
          limit={10}
        />
        <RealtimeDataPanel domain="retail" data={realtimeData} isLive={isLive} lastUpdated={lastUpdated} insights={insights} compact />
        <DTUExportButton domain="retail" data={{}} compact />

        {/* Point of sale */}
        <section className="mt-6 rounded-xl border border-lattice-border bg-lattice-deep/40 p-4">
          <LivePosTerminal />
        </section>

        {/* Retail workbench — analytics / customers / discounts / abandoned carts /
            shipping zones / gift cards / refunds / collections / transfers */}
        <RetailWorkbenchSection />

        {/* Commerce suite — storefront / fulfillment / shipping labels /
            campaigns / channels / reviews / staff */}
        <CommerceSuite />

        {/* Store ops bench — reorderCheck / pipelineValue / customerLTV / slaStatus */}
        <PipingProvider>
          <section className="mt-6">
            <RetailActionPanel />
          </section>
          <section className="mt-6"><TaxRatesPanel /></section>
        </PipingProvider>

        <section className="mt-4"><LensFeedButton domain="retail" label="Live product feed" /></section>
          <CrossLensRecentsPanel lensId="retail" sinceDays={7} limit={6} hideWhenEmpty className="mt-3" />

      </div>
    </LensShell>
  );
}

/* ------------------------------------------------------------------ */
/*  Retail workbench section                                          */
/* ------------------------------------------------------------------ */

function RetailWorkbenchSection() {
  const [active, setActive] = useState<'analytics' | 'customers' | 'pipeline' | 'tickets' | 'displays' | 'discounts' | 'abandoned' | 'shipping' | 'gift' | 'refunds' | 'collections' | 'transfers'>('analytics');
  const TABS = [
    { id: 'analytics', label: 'Analytics' },
    { id: 'customers', label: 'Customers' },
    { id: 'pipeline', label: 'Pipeline' },
    { id: 'tickets', label: 'Tickets' },
    { id: 'displays', label: 'Displays' },
    { id: 'discounts', label: 'Discounts' },
    { id: 'abandoned', label: 'Abandoned' },
    { id: 'shipping', label: 'Shipping' },
    { id: 'gift', label: 'Gift cards' },
    { id: 'refunds', label: 'Refunds' },
    { id: 'collections', label: 'Collections' },
    { id: 'transfers', label: 'Transfers' },
  ] as const;
  return (
    <section className="mt-6 space-y-3">
      <h2 className="text-sm font-semibold text-emerald-300 uppercase tracking-wider">Retail workbench</h2>
      <nav className="flex items-center gap-1 border-b border-emerald-900/30 pb-2 overflow-x-auto">
        {TABS.map(t => (
          <button
            key={t.id}
            onClick={() => setActive(t.id)}
            className={cn(
              'px-3 py-1.5 rounded-md text-xs font-mono whitespace-nowrap transition',
              active === t.id
                ? 'bg-emerald-500/15 text-emerald-300 border border-emerald-500/20'
                : 'text-gray-400 hover:text-emerald-300 hover:bg-emerald-900/10 border border-transparent'
            )}
          >
            {t.label}
          </button>
        ))}
      </nav>
      <div>
        {active === 'analytics' && <SalesAnalytics />}
        {active === 'customers' && <CustomersPanel />}
        {active === 'pipeline' && <PipelinePanel />}
        {active === 'tickets' && <TicketQueuePanel />}
        {active === 'displays' && <DisplaysPanel />}
        {active === 'discounts' && <DiscountsManager />}
        {active === 'abandoned' && <AbandonedCartsPanel />}
        {active === 'shipping' && <ShippingZonesEditor />}
        {active === 'gift' && <GiftCardsPanel />}
        {active === 'refunds' && <RefundsPanel />}
        {active === 'collections' && <CollectionsPanel />}
        {active === 'transfers' && <InventoryTransfers />}
      </div>
    </section>
  );
}
