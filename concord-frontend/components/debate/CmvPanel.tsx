'use client';

/**
 * CmvPanel — r/ChangeMyView-shape discussion feed. Thin wrapper for
 * active=cmv on the debate shell.
 */

import { CmvFeed } from '@/components/debate/CmvFeed';
import { isCommunityRedditEnabled } from '@/lib/community/reddit-flag';

export function CmvPanel() {
  if (!isCommunityRedditEnabled()) return null;
  return (
    <section className="rounded-xl border border-zinc-800 bg-zinc-950/40 p-4">
      <CmvFeed />
    </section>
  );
}

export default CmvPanel;
