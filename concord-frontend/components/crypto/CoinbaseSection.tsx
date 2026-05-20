'use client';

import { useEffect, useState } from 'react';
import { lensRun } from '@/lib/api/client';
import { CoinbaseShell, CryptoNav } from './CoinbaseShell';
import { PortfolioPanel } from './PortfolioPanel';
import { WatchlistPanel, RecurringBuysPanel, StakingPanel, NFTsPanel, ActivityPanel, TaxPanel, InsightsPanel } from './CryptoPanels';

export function CoinbaseSection() {
  const [nav, setNav] = useState<CryptoNav>('portfolio');
  const [summary, setSummary] = useState<{ totalValueUsd: number; unrealizedPnlPct: number; activeRecurringBuys: number; activeStakingPositions: number; watchlistSize: number; nftCount: number; priceAlertCount: number } | null>(null);

  useEffect(() => {
    lensRun({ domain: 'crypto', action: 'dashboard-summary', input: {} })
      .then(r => setSummary(r.data?.result || null))
      .catch(() => {});
  }, [nav]);

  const badges: Partial<Record<CryptoNav, number>> = summary ? {
    recurring: summary.activeRecurringBuys,
    staking: summary.activeStakingPositions,
    watchlist: summary.watchlistSize,
    nfts: summary.nftCount,
    alerts: summary.priceAlertCount,
  } : {};

  return (
    <CoinbaseShell
      activeNav={nav}
      onNavChange={setNav}
      badges={badges}
      totalValueUsd={summary?.totalValueUsd}
      unrealizedPnlPct={summary?.unrealizedPnlPct}
    >
      {nav === 'portfolio' && <PortfolioPanel />}
      {nav === 'watchlist' && <WatchlistPanel />}
      {nav === 'recurring' && <RecurringBuysPanel />}
      {nav === 'staking'   && <StakingPanel />}
      {nav === 'nfts'      && <NFTsPanel />}
      {nav === 'activity'  && <ActivityPanel />}
      {nav === 'tax'       && <TaxPanel />}
      {nav === 'insights'  && <InsightsPanel />}
      {nav === 'alerts'    && (
        <div className="p-6 text-center text-sm text-gray-400 bg-black/30 border border-white/10 rounded">
          Price alerts live in the existing <span className="text-blue-300">PriceAlerts</span> component below. CRUD via the existing <span className="font-mono">price-alerts-*</span> macros.
        </div>
      )}
      {nav === 'wallet'    && (
        <div className="p-6 text-center text-sm text-gray-400 bg-black/30 border border-white/10 rounded">
          Wallet tools — token search, swap, approvals manager, QR receive, address book — live in the existing components below this section.
        </div>
      )}
    </CoinbaseShell>
  );
}

export default CoinbaseSection;
