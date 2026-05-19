'use client';

import { useEffect, useState } from 'react';
import { api } from '@/lib/api/client';
import { EtsyShell, ShopNav } from './EtsyShell';
import { ShopDashboard } from './ShopDashboard';
import { ListingsPanel } from './ListingsPanel';
import { OrdersPanel } from './OrdersPanel';
import { StatsPanel, SearchVisibilityPanel } from './StatsPanel';
import { MarketingPanel } from './MarketingPanel';
import { InsightsPanel } from './InsightsPanel';
import { ShopSettingsPanel } from './ShopSettingsPanel';

interface Shop { id: string; name: string; currency: string }

export function EtsySection() {
  const [nav, setNav] = useState<ShopNav>('home');
  const [shop, setShop] = useState<Shop | null>(null);
  const [badges, setBadges] = useState<Partial<Record<ShopNav, number>>>({});

  useEffect(() => {
    api.post('/api/lens/run', { domain: 'marketplace', action: 'shop-get', input: {} })
      .then(r => setShop(r.data?.result?.shop || null))
      .catch(() => {});
  }, []);
  useEffect(() => { refreshBadges(); }, [nav]);

  async function refreshBadges() {
    try {
      const r = await api.post('/api/lens/run', { domain: 'marketplace', action: 'dashboard-summary', input: {} });
      const d = r.data?.result;
      if (d) {
        setBadges({
          listings: d.draftCount > 0 ? d.draftCount : 0,
          orders: d.pendingOrders || 0,
          marketing: d.activePromos || 0,
        });
      }
    } catch {}
  }

  return (
    <EtsyShell
      activeNav={nav}
      onNavChange={setNav}
      badges={badges}
      shopName={shop?.name}
      currency={shop?.currency}
    >
      {nav === 'home'       && <ShopDashboard onJumpTo={setNav} />}
      {nav === 'listings'   && <ListingsPanel />}
      {nav === 'orders'     && <OrdersPanel />}
      {nav === 'stats'      && <StatsPanel />}
      {nav === 'visibility' && <SearchVisibilityPanel />}
      {nav === 'marketing'  && <MarketingPanel />}
      {nav === 'insights'   && <InsightsPanel />}
      {nav === 'tools'      && (
        <div className="p-6 text-center text-sm text-gray-400 bg-black/30 border border-white/10 rounded">
          AI tools live inline on each listing — open Listings, expand a row, and use the orange "AI optimize listing" + green "AI price suggest" buttons. The existing TrendingListings + Listing-score panels also live below this section.
        </div>
      )}
      {nav === 'shop'       && <ShopSettingsPanel onUpdated={setShop} />}
    </EtsyShell>
  );
}

export default EtsySection;
