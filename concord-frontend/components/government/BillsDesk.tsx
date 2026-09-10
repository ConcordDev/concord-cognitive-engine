'use client';

/**
 * Congress.gov-shape bills desk: tracker (status/search) plus the
 * bills-list macro with Save-as-DTU. Both call government.bills-list.
 */

import { BillsList } from '@/components/government/BillsList';
import BillTracker from '@/components/government/BillTracker';

export function BillsDesk() {
  return (
    <div className="space-y-4">
      <BillTracker />
      <section className="rounded-xl border border-lattice-border bg-lattice-surface/40 p-4">
        <BillsList />
      </section>
    </div>
  );
}

export default BillsDesk;
