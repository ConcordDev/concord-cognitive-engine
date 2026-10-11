import type { Metadata } from 'next';
import VerifyReceipt from '@/components/verify/VerifyReceipt';

export const metadata: Metadata = {
  title: 'Verify a receipt — Concord',
  description: 'Check an Ed25519 signature on a ConKay receipt. Verification also works offline with the published public key.',
};

export default function VerifyPage() {
  return <VerifyReceipt />;
}
