import type { Metadata } from 'next';
import { WorkshopPage } from '@/components/conkay/workshop/WorkshopPage';

export const metadata: Metadata = {
  title: 'ConKay live build — Concord',
  description: 'Watch a ConKay design get made: each iteration, the check that failed, the candidates run with their margins, what changed and why, and the body after each step.',
};

export default async function ConKayLiveBuildPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return <WorkshopPage initialView="hood" designId={id} />;
}
