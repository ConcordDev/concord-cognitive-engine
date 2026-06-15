'use client';

import { useState } from 'react';
import { cn } from '@/lib/utils';
import StorefrontManager from './StorefrontManager';
import FulfillmentBoard from './FulfillmentBoard';
import ShippingLabelsPanel from './ShippingLabelsPanel';
import CampaignsManager from './CampaignsManager';
import ChannelsPanel from './ChannelsPanel';
import ReviewsPanel from './ReviewsPanel';
import StaffPanel from './StaffPanel';

type SuiteTab =
  | 'storefront' | 'fulfillment' | 'shipping' | 'campaigns'
  | 'channels' | 'reviews' | 'staff';

const TABS: { id: SuiteTab; label: string }[] = [
  { id: 'storefront', label: 'Storefront' },
  { id: 'fulfillment', label: 'Fulfillment' },
  { id: 'shipping', label: 'Labels' },
  { id: 'campaigns', label: 'Campaigns' },
  { id: 'channels', label: 'Channels' },
  { id: 'reviews', label: 'Reviews' },
  { id: 'staff', label: 'Staff' },
];

/**
 * CommerceSuite — the commerce-suite surface. Bundles the
 * buyer-facing storefront, order fulfillment, carrier labels, marketing
 * campaigns, multi-channel listing, product reviews and staff accounts
 * into one tabbed workbench. Each panel is real CRUD over the retail
 * domain macros — no seeded or mock data.
 */
export function CommerceSuite() {
  const [active, setActive] = useState<SuiteTab>('storefront');

  return (
    <section className="mt-6 space-y-3">
      <h2 className="text-sm font-semibold text-emerald-300 uppercase tracking-wider">Commerce suite</h2>
      <nav className="flex items-center gap-1 border-b border-emerald-900/30 pb-2 overflow-x-auto">
        {TABS.map(t => (
          <button
            key={t.id}
            onClick={() => setActive(t.id)}
            className={cn(
              'px-3 py-1.5 rounded-md text-xs font-mono whitespace-nowrap transition',
              active === t.id
                ? 'bg-emerald-500/15 text-emerald-300 border border-emerald-500/20'
                : 'text-gray-400 hover:text-emerald-300 hover:bg-emerald-900/10 border border-transparent',
            )}
          >
            {t.label}
          </button>
        ))}
      </nav>
      <div>
        {active === 'storefront' && <StorefrontManager />}
        {active === 'fulfillment' && <FulfillmentBoard />}
        {active === 'shipping' && <ShippingLabelsPanel />}
        {active === 'campaigns' && <CampaignsManager />}
        {active === 'channels' && <ChannelsPanel />}
        {active === 'reviews' && <ReviewsPanel />}
        {active === 'staff' && <StaffPanel />}
      </div>
    </section>
  );
}

export default CommerceSuite;
