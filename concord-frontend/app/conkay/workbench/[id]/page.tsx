import type { Metadata } from 'next';
import { WorkbenchById } from '@/components/conkay/workbench/WorkbenchPages';

export const metadata: Metadata = { title: 'ConKay Workbench — Concord', description: 'Design variables, locks, the design graph and every check’s receipt.' };

export default async function WorkbenchDesignPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return <WorkbenchById id={id} />;
}
