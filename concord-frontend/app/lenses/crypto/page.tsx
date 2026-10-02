'use client';

import { NorthGate } from '@/components/lens/NorthStarChrome';
import { CryptoWalletWorkspace } from '@/components/crypto/CryptoWalletWorkspace';
import { TheWallet } from '@/components/crypto/TheWallet';

export function CryptoDesk() {
  return <CryptoWalletWorkspace />;
}

export default function CryptoPage() {
  return (
    <NorthGate
      backLabel="Crypto"
      desk={<CryptoDesk />}
      star={(openDesk) => <TheWallet onOpenDesk={openDesk} />}
    />
  );
}
