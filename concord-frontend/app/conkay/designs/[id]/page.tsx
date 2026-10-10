import type { Metadata } from 'next';
import { DesignResult } from '@/components/conkay/designs/DesignResult';

export const metadata: Metadata = {
  title: 'ConKay design result — Concord',
  description: 'A ConKay showcase design: drawings, solver checks with margins, values with sources and status, mass by state, and the physical tests still needed.',
};

export default async function ConKayDesignPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return <DesignResult id={id} />;
}
