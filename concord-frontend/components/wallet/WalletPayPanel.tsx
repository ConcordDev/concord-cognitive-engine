'use client';

import { WalletParityHub } from '@/components/wallet/WalletParityHub';
import { TransferFlow } from '@/components/wallet/TransferFlow';
import { ds } from '@/lib/design-system';
import { useWalletBalance, useWalletInvalidate } from './useWalletQueries';
import type { WalletPanelProps } from './wallet-model';

export function WalletPayPanel(_props: WalletPanelProps) {
  const { data: balanceData } = useWalletBalance();
  const invalidate = useWalletInvalidate();
  const balance = balanceData?.balance ?? balanceData?.tokens ?? 0;

  return (
    <div className="space-y-6">
      <TransferFlow balance={balance} mode="inline" onSuccess={invalidate} />
      <div className="space-y-2">
        <h2 className={ds.heading2}>Requests &amp; splits</h2>
        <p className={ds.textMuted}>
          Money requests, invoices, recurring sends, QR pay, and spending insights — live wallet macros.
        </p>
        <WalletParityHub />
      </div>
    </div>
  );
}
