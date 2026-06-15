'use client';

import { useEffect, useState } from 'react';
import { lensRun } from '@/lib/api/client';
import { ShopfrontShell, ShopNav } from './ShopfrontShell';
import { ShopDashboard } from './ShopDashboard';
import { ListingsPanel } from './ListingsPanel';
import { OrdersPanel } from './OrdersPanel';
import { StatsPanel, SearchVisibilityPanel } from './StatsPanel';
import { MarketingPanel } from './MarketingPanel';
import { InsightsPanel } from './InsightsPanel';
import { ShopSettingsPanel } from './ShopSettingsPanel';
import { StorefrontPanel } from './StorefrontPanel';
import { ReviewsPanel } from './ReviewsPanel';
import { MessagesPanel } from './MessagesPanel';
import { VariationsPanel } from './VariationsPanel';
import { ShippingProfilesPanel } from './ShippingProfilesPanel';
import { CouponsPanel } from './CouponsPanel';
import { InventoryAlertsPanel } from './InventoryAlertsPanel';

interface Shop { id: string; name: string; currency: string }

export function ShopfrontSection() {
  const [nav, setNav] = useState<ShopNav>('home');
  const [shop, setShop] = useState<Shop | null>(null);
  const [badges, setBadges] = useState<Partial<Record<ShopNav, number>>>({});

  useEffect(() => {
    lensRun({ domain: 'marketplace', action: 'shop-get', input: {} })
      .then(r => setShop(r.data?.result?.shop || null))
      .catch(() => {});
  }, []);
  useEffect(() => { refreshBadges(); }, [nav]);

  async function refreshBadges() {
    try {
      const [summary, alerts, threads] = await Promise.all([
        lensRun({ domain: 'marketplace', action: 'dashboard-summary', input: {} }),
        lensRun({ domain: 'marketplace', action: 'inventory-alerts', input: {} }),
        lensRun({ domain: 'marketplace', action: 'messages-threads', input: {} }),
      ]);
      const d = summary.data?.result;
      const next: Partial<Record<ShopNav, number>> = {};
      if (d) {
        next.listings = d.draftCount > 0 ? d.draftCount : 0;
        next.orders = d.pendingOrders || 0;
        next.marketing = d.activePromos || 0;
      }
      const alertTotal = alerts.data?.result?.total;
      if (typeof alertTotal === 'number' && alertTotal > 0) next.inventory = alertTotal;
      const threadList = threads.data?.result?.threads;
      if (Array.isArray(threadList)) {
        const unread = threadList.filter((t: { unread?: boolean }) => t.unread).length;
        if (unread > 0) next.messages = unread;
      }
      setBadges(next);
    } catch {}
  }

  return (
    <ShopfrontShell
      activeNav={nav}
      onNavChange={setNav}
      badges={badges}
      shopName={shop?.name}
      currency={shop?.currency}
    >
      {nav === 'home'       && <ShopDashboard onJumpTo={setNav} />}
      {nav === 'storefront' && <StorefrontPanel />}
      {nav === 'listings'   && <ListingsPanel />}
      {nav === 'variations' && <VariationsPanel />}
      {nav === 'orders'     && <OrdersPanel />}
      {nav === 'messages'   && <MessagesPanel />}
      {nav === 'reviews'    && <ReviewsPanel />}
      {nav === 'stats'      && <StatsPanel />}
      {nav === 'visibility' && <SearchVisibilityPanel />}
      {nav === 'marketing'  && <MarketingPanel />}
      {nav === 'coupons'    && <CouponsPanel />}
      {nav === 'insights'   && <InsightsPanel />}
      {nav === 'shipping'   && <ShippingProfilesPanel />}
      {nav === 'inventory'  && <InventoryAlertsPanel />}
      {nav === 'tools'      && (
        <div className="p-6 text-center text-sm text-gray-400 bg-black/30 border border-white/10 rounded">
          AI tools live inline on each listing — open Listings, expand a row, and use the orange "AI optimize listing" + green "AI price suggest" buttons. The existing TrendingListings + Listing-score panels also live below this section.
        </div>
      )}
      {nav === 'shop'       && <ShopSettingsPanel onUpdated={setShop} />}
    </ShopfrontShell>
  );
}

export default ShopfrontSection;
