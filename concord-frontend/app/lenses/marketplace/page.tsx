'use client';

import { LensShell } from '@/components/lens/LensShell';
import { NorthGate } from '@/components/lens/NorthStarChrome';
import { MarketplaceApp } from '@/components/marketplace/MarketplaceApp';
import { MarketplaceProvider } from '@/components/marketplace/MarketplaceProvider';
import { ForSale } from '@/components/marketplace/ForSale';
import { useLensNav } from '@/hooks/useLensNav';

export function MarketplaceDesk() {
  useLensNav('marketplace');
  return (
    <LensShell lensId="marketplace" asMain={false} disableAgentFab={true}>
      <MarketplaceProvider>
        <MarketplaceApp />
      </MarketplaceProvider>
    </LensShell>
  );
}

export default function MarketplacePage() {
  return (
    <NorthGate
      backLabel="Marketplace"
      desk={<MarketplaceDesk />}
      star={(openDesk) => <ForSale onOpenDesk={openDesk} />}
    />
  );
}
