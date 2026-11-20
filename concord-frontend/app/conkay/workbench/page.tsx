import type { Metadata } from 'next';
import { WorkshopPage } from '@/components/conkay/workshop/WorkshopPage';

export const metadata: Metadata = { title: 'ConKay Workbench — Concord', description: 'Design variables, locks, the design graph and every check’s receipt — in the ConKay workshop.' };

export default function WorkbenchStartPage() {
  return <WorkshopPage initialView="table" />;
}
