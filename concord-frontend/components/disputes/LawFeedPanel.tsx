'use client';

/**
 * LawFeedPanel — live legal-news / precedent feed beside the ODR desk.
 */

import { LawStackFeed } from '@/components/disputes/LawStackFeed';

export function LawFeedPanel() {
  return (
    <section className="rounded-xl border border-zinc-800 bg-zinc-950/40 p-4">
      <LawStackFeed />
    </section>
  );
}

export default LawFeedPanel;
