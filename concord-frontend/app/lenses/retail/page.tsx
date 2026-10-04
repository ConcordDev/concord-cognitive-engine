'use client';

import { LensShell } from '@/components/lens/LensShell';
import { LensFeedButton } from '@/components/lens/LensFeedButton';
import { NorthStarFrame } from '@/components/lens/NorthStarFrame';
import { useAuth } from '@/hooks/useAuth';
import { titleCaseDisplayName } from '@/components/chat/claudeCleanGreeting';
import { FirstRunTour } from '@/components/lens/FirstRunTour';
import { DepthBadge } from '@/components/lens/DepthBadge';
import { useState } from 'react';
import { useLensNav } from '@/hooks/useLensNav';
import { useLensCommand } from '@/hooks/useLensCommand';
import { cn } from '@/lib/utils';
import { ShoppingCart } from 'lucide-react';
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
import ReturnsPanel from '@/components/retail/ReturnsPanel';
import RefundsPanel from '@/components/retail/RefundsPanel';
import CollectionsPanel from '@/components/retail/CollectionsPanel';
import InventoryTransfers from '@/components/retail/InventoryTransfers';
import SalesAnalytics from '@/components/retail/SalesAnalytics';
import CommerceSuite from '@/components/retail/CommerceSuite';
import { ShellPreview } from '@/components/lens/ShellPreview';

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
  const { user } = useAuth();
  const who = titleCaseDisplayName(user?.username);

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
      <NorthStarFrame
        lensId="retail"
        crumb="Retail & Commerce"
        title={`Run the register${who ? `, ${who}` : ''}`}
        subtitle="Point of sale, catalog, fulfillment, storefront & ops — one real backend, no seeded data."
        actions={(
          <>
            <LiveIndicator isLive={isLive} lastUpdated={lastUpdated} compact />
            <DTUExportButton domain="retail" data={{}} compact />
          </>
        )}
        cta={{ label: 'Retail Workbench', icon: ShoppingCart, onClick: () => setWorkbenchOpen(true), title: 'Retail Workbench — POS register, catalog, orders, low stock (press W)' }}
      >
      <div>
        <ShellPreview lensId="retail" defaultOpen={true} />

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

        {/* Point of sale */}
        <section className="mt-6 rounded-2xl border border-white/10 bg-[#111] p-4">
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
      </div>
      </NorthStarFrame>
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
    { id: 'refunds', label: 'Refunds & returns' },
    { id: 'collections', label: 'Collections' },
    { id: 'transfers', label: 'Transfers' },
  ] as const;
  return (
    <section className="mt-6 space-y-3">
      <h2 className="font-vault text-2xl text-zinc-100">Retail workbench</h2>
      <nav className="inline-flex max-w-full items-center gap-1 overflow-x-auto rounded-full border border-white/10 bg-white/[0.03] p-1" aria-label="Retail workbench views">
        {TABS.map(t => (
          <button
            key={t.id}
            type="button"
            onClick={() => setActive(t.id)}
            aria-current={active === t.id ? 'page' : undefined}
            className={cn(
              'whitespace-nowrap rounded-full px-4 py-1.5 text-[14px] transition-colors',
              active === t.id ? 'bg-white/10 text-zinc-50' : 'text-zinc-500 hover:text-zinc-200',
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
        {active === 'refunds' && (
          <div className="grid gap-4 xl:grid-cols-2">
            <RefundsPanel />
            <ReturnsPanel />
          </div>
        )}
        {active === 'collections' && <CollectionsPanel />}
        {active === 'transfers' && <InventoryTransfers />}
      </div>
    </section>
  );
}
