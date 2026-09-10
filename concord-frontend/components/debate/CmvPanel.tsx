'use client';

/**
 * CmvPanel — r/ChangeMyView-shape discussion feed. Thin wrapper for
 * active=cmv on the debate shell.
 */

import { CmvFeed } from '@/components/debate/CmvFeed';

export function CmvPanel() {
  return (
    <section className="rounded-xl border border-zinc-800 bg-zinc-950/40 p-4">
      <CmvFeed />
    </section>
  );
}

export default CmvPanel;
