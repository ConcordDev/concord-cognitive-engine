'use client';

/**
 * RetailApp — the retail lens as one app (Shopify POS + admin shape).
 *
 * The lens body is a section rail plus the active section, filling the
 * space under the platform's left bar and top bar. One navigation state
 * (section + sub-view) drives everything; the Register is the default
 * because selling is the job. The non-register sections host the existing
 * macro-backed retail panels — each owns its own data, none is generic.
 */

import { useCallback, useEffect, useState } from 'react';
import { ShoppingCart, Receipt, Package, Users, Truck, Megaphone, BarChart3, LifeBuoy, Store } from 'lucide-react';
import { cn } from '@/lib/utils';
import { useLensCommand } from '@/hooks/useLensCommand';
import { useRealtimeLens } from '@/hooks/useRealtimeLens';
import { PipingProvider } from '@/components/panel-polish';
import { SECTIONS, sectionById, defaultSub, type RetailSection } from './sections';
import { Register } from './Register';
import { OrdersView } from './OrdersView';
import { LowStockView } from './LowStockView';
import { ProductCatalogPanel } from '../ProductCatalogPanel';
import CustomersPanel from '../CustomersPanel';
import ReturnsPanel from '../ReturnsPanel';
import RefundsPanel from '../RefundsPanel';
import AbandonedCartsPanel from '../AbandonedCartsPanel';
import CollectionsPanel from '../CollectionsPanel';
import InventoryTransfers from '../InventoryTransfers';
import FulfillmentBoard from '../FulfillmentBoard';
import ShippingLabelsPanel from '../ShippingLabelsPanel';
import ShippingZonesEditor from '../ShippingZonesEditor';
import DiscountsManager from '../DiscountsManager';
import CampaignsManager from '../CampaignsManager';
import GiftCardsPanel from '../GiftCardsPanel';
import DisplaysPanel from '../DisplaysPanel';
import SalesAnalytics from '../SalesAnalytics';
import { RetailActionPanel } from '../RetailActionPanel';
import TicketQueuePanel from '../TicketQueuePanel';
import ReviewsPanel from '../ReviewsPanel';
import PipelinePanel from '../PipelinePanel';
import StorefrontManager from '../StorefrontManager';
import ChannelsPanel from '../ChannelsPanel';
import { TaxRatesPanel } from '../TaxRatesPanel';
import StaffPanel from '../StaffPanel';
import { FeedItemsPanel } from '../FeedItemsPanel';
import LiveFeed from '@/components/lens/LiveFeed';
import { LensFeedButton } from '@/components/lens/LensFeedButton';

const ICONS: Record<RetailSection, typeof ShoppingCart> = {
  register: ShoppingCart, orders: Receipt, products: Package, customers: Users, fulfillment: Truck,
  marketing: Megaphone, analytics: BarChart3, service: LifeBuoy, store: Store,
};

const NAV_KEY = 'retail:nav';

export function RetailApp() {
  const [section, setSection] = useState<RetailSection>('register');
  const [sub, setSub] = useState<string | undefined>(undefined);

  // Restore the last section for this viewer (convenience only).
  useEffect(() => {
    try {
      const raw = window.localStorage.getItem(NAV_KEY);
      if (!raw) return;
      const v = JSON.parse(raw) as { section?: RetailSection; sub?: string };
      if (v.section && SECTIONS.some((s) => s.id === v.section)) { setSection(v.section); setSub(v.sub); }
    } catch { /* storage unavailable */ }
  }, []);

  const go = useCallback((s: RetailSection, nextSub?: string) => {
    const resolved = nextSub ?? defaultSub(s);
    setSection(s); setSub(resolved);
    try { window.localStorage.setItem(NAV_KEY, JSON.stringify({ section: s, sub: resolved })); } catch { /* ignore */ }
  }, []);

  useLensCommand(
    SECTIONS.map((s) => ({ id: `go-${s.id}`, keys: s.key, description: `Retail: ${s.label}`, category: 'navigation' as const, action: () => go(s.id) })),
    { lensId: 'retail' },
  );

  const def = sectionById(section);
  const activeSub = sub && def.subs?.some((x) => x.id === sub) ? sub : defaultSub(section);

  return (
    <div className="flex h-full min-h-0 flex-col bg-zinc-950 text-zinc-200 md:flex-row" data-lens-theme="retail">
      {/* Section rail */}
      <nav aria-label="Retail" className="flex flex-shrink-0 gap-0.5 overflow-x-auto border-b border-white/[0.06] px-2 py-1.5 md:w-[188px] md:flex-col md:overflow-visible md:border-b-0 md:border-r md:px-2 md:py-3">
        {SECTIONS.map((s) => {
          const Icon = ICONS[s.id];
          const active = s.id === section;
          return (
            <button
              key={s.id}
              type="button"
              onClick={() => go(s.id)}
              aria-current={active ? 'page' : undefined}
              className={cn(
                'group flex flex-shrink-0 items-center gap-2.5 rounded-md px-2.5 py-1.5 text-[13px] transition-colors',
                active ? 'bg-white/[0.08] text-zinc-50' : 'text-zinc-400 hover:bg-white/[0.04] hover:text-zinc-200',
              )}
            >
              <Icon className={cn('h-4 w-4', active ? 'text-emerald-400' : 'text-zinc-500 group-hover:text-zinc-300')} />
              <span className="flex-1 text-left">{s.label}</span>
              <kbd className="hidden font-mono text-[10px] text-zinc-600 md:inline">{s.key}</kbd>
            </button>
          );
        })}
      </nav>

      <div className="flex min-h-0 min-w-0 flex-1 flex-col">
        {def.subs && (
          <div className="flex flex-shrink-0 items-center gap-1 overflow-x-auto border-b border-white/[0.06] px-4" role="tablist" aria-label={`${def.label} views`}>
            <h1 className="mr-3 py-2.5 text-[14px] font-medium text-zinc-100">{def.label}</h1>
            {def.subs.map((x) => (
              <button key={x.id} type="button" role="tab" aria-selected={x.id === activeSub} onClick={() => go(section, x.id)}
                className={cn('-mb-px whitespace-nowrap border-b-2 px-2.5 py-2.5 text-[13px] transition-colors', x.id === activeSub ? 'border-emerald-400 text-zinc-50' : 'border-transparent text-zinc-500 hover:text-zinc-200')}>
                {x.label}
              </button>
            ))}
          </div>
        )}
        <main className="min-h-0 flex-1 overflow-y-auto" id="retail-content">
          <SectionBody section={section} sub={activeSub} go={go} />
        </main>
      </div>
    </div>
  );
}

/** Existing panels carry their own card chrome; give them a consistent page gutter. */
function Page({ children }: { children: React.ReactNode }) {
  return <div className="mx-auto w-full max-w-[1400px] px-6 py-5">{children}</div>;
}

function SectionBody({ section, sub, go }: { section: RetailSection; sub?: string; go: (s: RetailSection, sub?: string) => void }) {
  switch (section) {
    case 'register':
      return <Register onNavigate={go} />;
    case 'orders':
      if (sub === 'returns') return <Page><ReturnsPanel /></Page>;
      if (sub === 'refunds') return <Page><RefundsPanel /></Page>;
      if (sub === 'abandoned') return <Page><AbandonedCartsPanel /></Page>;
      return <OrdersView onOpenReturns={() => go('orders', 'returns')} />;
    case 'products':
      if (sub === 'lowstock') return <LowStockView onEditCatalog={() => go('products', 'catalog')} />;
      if (sub === 'collections') return <Page><CollectionsPanel /></Page>;
      if (sub === 'transfers') return <Page><InventoryTransfers /></Page>;
      return <Page><ProductCatalogPanel /></Page>;
    case 'customers':
      return <Page><CustomersPanel /></Page>;
    case 'fulfillment':
      if (sub === 'labels') return <Page><ShippingLabelsPanel /></Page>;
      if (sub === 'zones') return <Page><ShippingZonesEditor /></Page>;
      return <Page><FulfillmentBoard /></Page>;
    case 'marketing':
      if (sub === 'campaigns') return <Page><CampaignsManager /></Page>;
      if (sub === 'gift') return <Page><GiftCardsPanel /></Page>;
      if (sub === 'displays') return <Page><DisplaysPanel /></Page>;
      return <Page><DiscountsManager /></Page>;
    case 'analytics':
      if (sub === 'ops') return <Page><PipingProvider><RetailActionPanel /></PipingProvider></Page>;
      if (sub === 'market') return <MarketWire />;
      return <Page><SalesAnalytics /></Page>;
    case 'service':
      if (sub === 'reviews') return <Page><ReviewsPanel /></Page>;
      if (sub === 'pipeline') return <Page><PipelinePanel /></Page>;
      return <Page><TicketQueuePanel /></Page>;
    case 'store':
      if (sub === 'channels') return <Page><ChannelsPanel /></Page>;
      if (sub === 'taxes') return <Page><TaxRatesPanel /></Page>;
      if (sub === 'staff') return <Page><StaffPanel /></Page>;
      return <Page><StorefrontManager /></Page>;
    default:
      return null;
  }
}

/** External retail context: the BLS/Census wire + Open Beauty Facts product feed. */
function MarketWire() {
  const { latestData, isLive, lastUpdated } = useRealtimeLens('retail');
  return (
    <Page>
      <LiveFeed
        articles={(latestData as { articles?: Array<Record<string, unknown>> } | null)?.articles as React.ComponentProps<typeof LiveFeed>['articles']}
        domain="retail"
        isLive={isLive}
        lastUpdated={lastUpdated}
        limit={12}
      />
      <div className="mt-6 flex items-center justify-between"><h2 className="text-[14px] font-medium text-zinc-100">Product feed</h2><LensFeedButton domain="retail" label="Pull products" /></div>
      <div className="mt-3"><FeedItemsPanel /></div>
    </Page>
  );
}

export default RetailApp;
