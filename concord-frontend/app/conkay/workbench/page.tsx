import type { Metadata } from 'next';
import { WorkbenchStart } from '@/components/conkay/workbench/WorkbenchPages';

export const metadata: Metadata = { title: 'ConKay Workbench — Concord', description: 'Design variables, locks, the design graph and every check’s receipt.' };

export default function WorkbenchStartPage() {
  return <WorkbenchStart />;
}
