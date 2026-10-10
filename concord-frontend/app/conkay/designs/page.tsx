import type { Metadata } from 'next';
import { DesignsIndex } from '@/components/conkay/designs/DesignsIndex';

export const metadata: Metadata = {
  title: 'ConKay results — Concord',
  description: 'Showcase designs run through ConKay: drawings, solver checks with margins, every value with its source, and what still needs physical testing. No account needed.',
};

export default function ConKayDesignsPage() {
  return <DesignsIndex />;
}
