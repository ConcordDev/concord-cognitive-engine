'use client';

import { StackOverflowSearch } from '@/components/answers/StackOverflowSearch';
import { ds } from '@/lib/design-system';

/** External Stack Overflow search — folded from page accordion. */
export function StackOverflowPanel() {
  return (
    <div className="space-y-4">
      <div>
        <h2 className={ds.heading2}>Stack Overflow search</h2>
        <p className={ds.textMuted}>External reference search (live API).</p>
      </div>
      <StackOverflowSearch />
    </div>
  );
}
