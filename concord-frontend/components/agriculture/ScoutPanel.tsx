'use client';

import { GbifPanel } from '@/components/environment/GbifPanel';
import { PestIdentifier } from './PestIdentifier';

/** Scouting desk: pest/disease ID plus GBIF occurrence search. */
export function ScoutPanel() {
  return (
    <div className="space-y-4">
      <section className="rounded-xl border border-zinc-800 bg-zinc-950/40 p-4">
        <PestIdentifier />
      </section>
      <section>
        <GbifPanel domain="agriculture" />
      </section>
    </div>
  );
}

export default ScoutPanel;
