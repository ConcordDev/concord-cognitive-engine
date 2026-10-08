import type { Metadata } from 'next';
import { ConKayDemo } from '@/components/conkay/demo/ConKayDemo';

export const metadata: Metadata = {
  title: 'ConKay demo — Concord',
  description: 'Size an I-beam and run real finite-element analysis in your browser. No account needed.',
};

export default function ConKayDemoPage() {
  return <ConKayDemo />;
}
