import type { Metadata } from 'next';
import { WorkshopPage } from '@/components/conkay/workshop/WorkshopPage';

export const metadata: Metadata = {
  title: 'ConKay demo — Concord',
  description: 'Size an I-beam and run real finite-element analysis in your browser. No account needed.',
};

export default function ConKayDemoPage() {
  return <WorkshopPage forceGuest initialView="table" />;
}
