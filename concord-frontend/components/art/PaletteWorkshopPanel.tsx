'use client';

/**
 * PaletteWorkshopPanel — color harmony / generatePalette workbench.
 */

import { PaletteWorkshop } from '@/components/art/PaletteWorkshop';
import { ds } from '@/lib/design-system';

export function PaletteWorkshopPanel() {
  return (
    <div className="space-y-3 px-4 py-2">
      <div>
        <h2 className={ds.heading2}>Palettes</h2>
        <p className={ds.textMuted}>Harmony analysis and palette generation macros.</p>
      </div>
      <section className="rounded-xl border border-zinc-800 bg-zinc-950/40 p-4">
        <PaletteWorkshop />
      </section>
    </div>
  );
}
