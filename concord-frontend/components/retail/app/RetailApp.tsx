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
import './stall.css';
import { stallFontVars } from './stallFonts';
import { SECTIONS, SECTION_COPY, sectionById, defaultSub, type RetailSection } from './sections';
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
    <div className={cn('stall flex h-full min-h-0 flex-col md:flex-row', stallFontVars)} data-lens-theme="retail">
      {/* Section rail — the stall's chalk list */}
      <nav aria-label="Retail" className="flex flex-shrink-0 gap-0.5 overflow-x-auto border-b border-[color:var(--stall-line)] px-2 py-1.5 md:w-[180px] md:flex-col md:overflow-visible md:border-b-0 md:border-r md:px-2 md:py-3">
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
                'group flex flex-shrink-0 items-center gap-2.5 rounded-md px-2.5 py-1 font-[family-name:var(--stall-font-hand)] text-[19px] transition-colors',
                active ? 'bg-white/[0.07] text-[color:var(--stall-chalk)]' : 'text-[color:var(--stall-chalk-dim)] hover:bg-white/[0.04] hover:text-[color:var(--stall-chalk)]',
              )}
            >
              <Icon className={cn('h-4 w-4', active ? 'text-[color:var(--stall-brass)]' : 'text-[color:var(--stall-chalk-faint)] group-hover:text-[color:var(--stall-chalk-dim)]')} />
              <span className={cn('flex-1 text-left', active && 'underline decoration-[color:var(--stall-brass)] decoration-2 underline-offset-4')}>{s.label}</span>
              <kbd className="hidden font-mono text-[10px] text-[color:var(--stall-chalk-faint)] md:inline">{s.key}</kbd>
            </button>
          );
        })}
      </nav>

      <div className="flex min-h-0 min-w-0 flex-1 flex-col">
        {def.subs && (
          <div className="stall-board flex flex-shrink-0 items-center gap-1 overflow-x-auto border-b border-[color:var(--stall-line)] px-4" role="tablist" aria-label={`${def.label} views`}>
            <h1 className="mr-3 py-2 font-[family-name:var(--stall-font-marker)] text-[20px] text-[color:var(--stall-chalk)]">{def.label}</h1>
            {def.subs.map((x) => (
              <button key={x.id} type="button" role="tab" aria-selected={x.id === activeSub} onClick={() => go(section, x.id)}
                className={cn('-mb-px whitespace-nowrap border-b-2 px-2.5 py-2 font-[family-name:var(--stall-font-hand)] text-[18px] transition-colors', x.id === activeSub ? 'border-[color:var(--stall-brass)] text-[color:var(--stall-chalk)]' : 'border-transparent text-[color:var(--stall-chalk-faint)] hover:text-[color:var(--stall-chalk)]')}>
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

/**
 * A section view: the chalked header (SECTION_COPY) over the domain panel.
 * `.stall-page` maps the panel's palette onto the Stall tokens (stall.css).
 */
function PageShell({ copyKey, children }: { copyKey: string; children: React.ReactNode }) {
  const copy = SECTION_COPY[copyKey];
  return (
    <div className="stall-page mx-auto w-full max-w-[1400px] px-6 py-5">
      {copy && (
        <header className="mb-5">
          <h2 className="!font-[family-name:var(--stall-font-marker)] !text-[28px] !font-normal leading-tight">{copy.title}</h2>
          <p className="mt-0.5 font-[family-name:var(--stall-font-hand)] text-[19px] text-[color:var(--stall-chalk-dim)]">{copy.line}</p>
        </header>
      )}
      {children}
    </div>
  );
}

function SectionBody({ section, sub, go }: { section: RetailSection; sub?: string; go: (s: RetailSection, sub?: string) => void }) {
  // A plain helper (not a component defined in render) so panels keep their
  // identity — and their state — across re-renders.
  const page = (el: React.ReactNode) => <PageShell copyKey={`${section}:${sub ?? ''}`}>{el}</PageShell>;
  switch (section) {
    case 'register':
      return <Register onNavigate={go} />;
    case 'orders':
      if (sub === 'returns') return page(<ReturnsPanel />);
      if (sub === 'refunds') return page(<RefundsPanel />);
      if (sub === 'abandoned') return page(<AbandonedCartsPanel />);
      return <div className="stall-page h-full"><OrdersView onOpenReturns={() => go('orders', 'returns')} /></div>;
    case 'products':
      if (sub === 'lowstock') return page(<LowStockView onEditCatalog={() => go('products', 'catalog')} />);
      if (sub === 'collections') return page(<CollectionsPanel />);
      if (sub === 'transfers') return page(<InventoryTransfers />);
      return page(<ProductCatalogPanel />);
    case 'customers':
      return page(<CustomersPanel />);
    case 'fulfillment':
      if (sub === 'labels') return page(<ShippingLabelsPanel />);
      if (sub === 'zones') return page(<ShippingZonesEditor />);
      return page(<FulfillmentBoard />);
    case 'marketing':
      if (sub === 'campaigns') return page(<CampaignsManager />);
      if (sub === 'gift') return page(<GiftCardsPanel />);
      if (sub === 'displays') return page(<DisplaysPanel />);
      return page(<DiscountsManager />);
    case 'analytics':
      if (sub === 'ops') return page(<PipingProvider><RetailActionPanel /></PipingProvider>);
      if (sub === 'market') return <MarketWire />;
      return page(<SalesAnalytics />);
    case 'service':
      if (sub === 'reviews') return page(<ReviewsPanel />);
      if (sub === 'pipeline') return page(<PipelinePanel />);
      return page(<TicketQueuePanel />);
    case 'store':
      if (sub === 'channels') return page(<ChannelsPanel />);
      if (sub === 'taxes') return page(<TaxRatesPanel />);
      if (sub === 'staff') return page(<StaffPanel />);
      return page(<StorefrontManager />);
    default:
      return null;
  }
}

/** External retail context: the BLS/Census wire + Open Beauty Facts product feed. */
function MarketWire() {
  const { latestData, isLive, lastUpdated } = useRealtimeLens('retail');
  return (
    <PageShell copyKey="analytics:market">
      <LiveFeed
        articles={(latestData as { articles?: Array<Record<string, unknown>> } | null)?.articles as React.ComponentProps<typeof LiveFeed>['articles']}
        domain="retail"
        isLive={isLive}
        lastUpdated={lastUpdated}
        limit={12}
      />
      <div className="mt-6 flex items-center justify-between"><h2>Product feed</h2><LensFeedButton domain="retail" label="Pull products" /></div>
      <div className="mt-3"><FeedItemsPanel /></div>
    </PageShell>
  );
}

export default RetailApp;
