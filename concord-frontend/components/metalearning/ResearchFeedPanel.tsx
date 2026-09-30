'use client';

import { MetalearningFeed } from '@/components/metalearning/MetalearningFeed';

export function ResearchFeedPanel() {
  return (
    <section className="rounded-xl border border-zinc-800 bg-zinc-950/40 p-4">
      <h2 className="text-sm font-semibold text-white mb-3">Meta-learning research (external reference)</h2>
      <MetalearningFeed />
    </section>
  );
}
