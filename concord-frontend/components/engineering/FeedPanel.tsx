'use client';

import { HnEngineeringFeed } from './HnEngineeringFeed';

/** HN engineering discussion — was an accordion under the welded page. */
export function FeedPanel() {
  return (
    <section className="rounded-xl border border-zinc-800 bg-zinc-950/40 p-4">
      <HnEngineeringFeed />
    </section>
  );
}
