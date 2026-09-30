'use client';

/**
 * ArtWorkbenchPanel — colorHarmony / compositionScore / generatePalette /
 * styleClassify + publish actions (ArtActionPanel).
 */

import { ArtActionPanel } from '@/components/art/ArtActionPanel';
import { PipingProvider } from '@/components/panel-polish';
import { ds } from '@/lib/design-system';

export function ArtWorkbenchPanel() {
  return (
    <div className="space-y-3 px-4 py-2">
      <div>
        <h2 className={ds.heading2}>Workbench</h2>
        <p className={ds.textMuted}>Harmony, composition, palette, style — compute macros.</p>
      </div>
      <PipingProvider>
        <ArtActionPanel />
      </PipingProvider>
    </div>
  );
}
