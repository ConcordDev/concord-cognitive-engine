'use client';

/**
 * StudioPanel — Procreate/Krita studio (ArtStudioSection) with live artwork macros.
 */

import { ArtStudioSection } from '@/components/art/ArtStudioSection';
import { ArtGenerateFromText } from '@/components/art/ArtGenerateFromText';
import { ds } from '@/lib/design-system';

export function StudioPanel() {
  return (
    <div className="space-y-3">
      <div className="px-4 pt-2">
        <h2 className={ds.heading2}>Studio</h2>
        <p className={ds.textMuted}>Layers, brushes, filters, concept board — real art macros.</p>
      </div>
      <div className="px-4">
        <ArtGenerateFromText />
      </div>
      <ArtStudioSection />
    </div>
  );
}
