import type { Metadata } from 'next';
import { DesignBuilder } from '@/components/conkay/designs/DesignBuilder';

export const metadata: Metadata = {
  title: 'ConKay design — Concord',
  description: 'One ConKay design as a working surface: the 3D model beside ConKay chat (real check counts from every edit), the live build stream, the workbench knobs, and the snapshot’s solver checks, values and mass.',
};

export default async function ConKayDesignPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return <DesignBuilder id={id} />;
}
