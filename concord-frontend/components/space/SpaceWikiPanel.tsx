'use client';

import { WikipediaSearchPanel } from '@/components/wiki/WikipediaSearchPanel';
import { ds } from '@/lib/design-system';

/** Folded from page accordion "Wikipedia · space topics". */
export function SpaceWikiPanel() {
  return (
    <div className="space-y-4">
      <div>
        <h2 className={ds.heading2}>Wikipedia · space</h2>
        <p className={ds.textMuted}>External reference for missions, satellites, agencies.</p>
      </div>
      <WikipediaSearchPanel domain="space" title="Wikipedia · space topics" />
    </div>
  );
}
