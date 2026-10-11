'use client';

import { EsportsFeed } from '@/components/tournaments/EsportsFeed';
import { isCommunityRedditEnabled } from '@/lib/community/reddit-flag';

export function EsportsFeedPanel() {
  if (!isCommunityRedditEnabled()) return null;
  return (
    <div className="rounded-xl border border-zinc-800 bg-zinc-950/40 p-4">
      <h2 className="mb-3 text-sm font-semibold text-white">Esports discussion (external reference)</h2>
      <EsportsFeed />
    </div>
  );
}
