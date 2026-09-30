'use client';

/**
 * ArgumentMapPanel — Kialo-shape claim tree. Thin wrapper so the debate
 * page can route active=map without accordion stacking.
 */

import { KialoArgumentMap } from '@/components/debate/KialoArgumentMap';

export function ArgumentMapPanel() {
  return (
    <section className="rounded-xl border border-zinc-800 bg-zinc-950/40 p-4">
      <KialoArgumentMap />
    </section>
  );
}

export default ArgumentMapPanel;
