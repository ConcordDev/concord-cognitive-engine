'use client';

import { EsportsFeed } from '@/components/tournaments/EsportsFeed';

export function EsportsFeedPanel() {
  return (
    <div className="rounded-xl border border-zinc-800 bg-zinc-950/40 p-4">
      <h2 className="mb-3 text-sm font-semibold text-white">Esports discussion (external reference)</h2>
      <EsportsFeed />
    </div>
  );
}
