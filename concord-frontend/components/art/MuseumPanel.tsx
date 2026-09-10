'use client';

/**
 * MuseumPanel — Met Open Access + Art Institute explorer (Save-as-DTU).
 */

import { ArtExplorer } from '@/components/art/ArtExplorer';
import { MetMuseumPanel } from '@/components/art/MetMuseumPanel';
import { ds } from '@/lib/design-system';

export function MuseumPanel() {
  return (
    <div className="space-y-4 px-4 py-2">
      <div>
        <h2 className={ds.heading2}>Museum</h2>
        <p className={ds.textMuted}>Met Museum + Art Institute open-access references.</p>
      </div>
      <MetMuseumPanel domain="art" />
      <section className="rounded-xl border border-zinc-800 bg-zinc-950/40 p-4">
        <ArtExplorer />
      </section>
    </div>
  );
}
