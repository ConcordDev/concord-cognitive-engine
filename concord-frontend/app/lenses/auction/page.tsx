'use client';

/**
 * Auction — one auction-house desk.
 *
 * Single view union (board | market | buy-orders) in the north-star look.
 * The surfaces live in panels; the page is a thin shell.
 */

import { useCallback, useState } from 'react';
import { Gavel, BarChart3, ShoppingCart } from 'lucide-react';
import { LensShell } from '@/components/lens/LensShell';
import { NorthStarFrame } from '@/components/lens/NorthStarFrame';
import { FirstRunTour } from '@/components/lens/FirstRunTour';
import { DepthBadge } from '@/components/lens/DepthBadge';
import { useLensCommand } from '@/hooks/useLensCommand';
import { useAuth } from '@/hooks/useAuth';
import { titleCaseDisplayName } from '@/components/chat/claudeCleanGreeting';
import { BoardPanel } from '@/components/auction/BoardPanel';
import { MarketPanel } from '@/components/auction/MarketPanel';
import { BuyOrdersPanel } from '@/components/auction/BuyOrdersPanel';

type AuctionView = 'board' | 'market' | 'buy-orders';

const VIEWS: { id: AuctionView; label: string; keys: string; title: string; hint: string; icon: typeof Gavel }[] = [
  { id: 'board', label: 'Board', keys: '1', title: 'What is on the block', hint: 'Active auctions', icon: Gavel },
  { id: 'market', label: 'Market', keys: '2', title: 'Where prices are heading', hint: 'Price history and depth', icon: BarChart3 },
  { id: 'buy-orders', label: 'Buy orders', keys: '3', title: 'Wait for the right price', hint: 'Escrowed standing buy orders', icon: ShoppingCart },
];

export default function AuctionLensPage() {
  const { user } = useAuth();
  const who = titleCaseDisplayName(user?.username);
  const [active, setActive] = useState<AuctionView>('board');
  const [marketSeed, setMarketSeed] = useState('');

  const goMarket = useCallback((itemId: string) => {
    setMarketSeed(itemId);
    setActive('market');
  }, []);

  useLensCommand(
    VIEWS.map((v) => ({
      id: `view-${v.id}`,
      keys: v.keys,
      description: `${v.label}: ${v.hint}`,
      category: 'navigation' as const,
      action: () => setActive(v.id),
    })),
    { lensId: 'auction' },
  );

  const current = VIEWS.find((v) => v.id === active)!;

  return (
    <LensShell lensId="auction" asMain={false}>
      <FirstRunTour lensId="auction" />
      <DepthBadge lensId="auction" size="sm" className="ml-2" />
      <NorthStarFrame
        lensId="auction"
        crumb="Auction house"
        title={`${current.title}${active === 'board' && who ? `, ${who}` : ''}`}
        subtitle="Time-bound bidding with 60s snipe protection and a 5% platform fee."
        tabs={VIEWS.map((v) => ({ id: v.id, label: v.label, icon: v.icon, keys: v.keys, hint: v.hint }))}
        activeTab={active}
        onTab={(id) => setActive(id as AuctionView)}
        tabsLabel="Auction views"
        cta={{ label: 'Check the market', icon: BarChart3, onClick: () => goMarket(marketSeed), title: 'Price history and market depth' }}
      >
        {active === 'board' && <BoardPanel onCheckMarket={goMarket} />}
        {active === 'market' && <MarketPanel initialItemId={marketSeed} />}
        {active === 'buy-orders' && <BuyOrdersPanel onCheckMarket={goMarket} />}
      </NorthStarFrame>
    </LensShell>
  );
}
