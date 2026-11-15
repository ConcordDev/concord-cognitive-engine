'use client';

import { PipingProvider } from '@/components/panel-polish';
import { WalletActionPanel } from '@/components/wallet/WalletActionPanel';
import { WalletCapturesPanel } from '@/components/wallet/WalletCapturesPanel';
import { WalletMarkets } from '@/components/wallet/WalletMarkets';
import { ds } from '@/lib/design-system';
import type { WalletPanelProps } from './wallet-model';

export function WalletToolsPanel(_props: WalletPanelProps) {
  return (
    <div className="space-y-6">
      <PipingProvider>
        <WalletActionPanel />
      </PipingProvider>
      {/* FIX-wallet-009: Quick capture notes get their home here. */}
      <section className={ds.panel}>
        <WalletCapturesPanel />
      </section>
      <section className={ds.panel}>
        <WalletMarkets />
      </section>
    </div>
  );
}
