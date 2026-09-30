'use client';

import { PipingProvider } from '@/components/panel-polish';
import { WalletActionPanel } from '@/components/wallet/WalletActionPanel';
import { WalletMarkets } from '@/components/wallet/WalletMarkets';
import { ds } from '@/lib/design-system';
import type { WalletPanelProps } from './wallet-model';

export function WalletToolsPanel(_props: WalletPanelProps) {
  return (
    <div className="space-y-6">
      <PipingProvider>
        <WalletActionPanel />
      </PipingProvider>
      <section className={ds.panel}>
        <WalletMarkets />
      </section>
    </div>
  );
}
