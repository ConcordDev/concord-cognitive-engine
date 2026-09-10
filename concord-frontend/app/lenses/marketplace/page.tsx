'use client';

import { LensShell } from '@/components/lens/LensShell';
import { MarketplaceApp } from '@/components/marketplace/MarketplaceApp';
import { MarketplaceProvider } from '@/components/marketplace/MarketplaceProvider';
import { useLensNav } from '@/hooks/useLensNav';

export default function MarketplaceLensPage() {
  useLensNav('marketplace');
  return (
    <LensShell lensId="marketplace" asMain={false} disableAgentFab={true}>
      <MarketplaceProvider>
        <MarketplaceApp />
      </MarketplaceProvider>
    </LensShell>
  );
}
