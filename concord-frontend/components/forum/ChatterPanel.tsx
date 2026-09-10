'use client';

/**
 * ChatterPanel — live discussion chatter surface for the forum lens.
 */

import { ForumChatter } from '@/components/forum/ForumChatter';
import { ds } from '@/lib/design-system';

export function ChatterPanel() {
  return (
    <div className="space-y-3">
      <div>
        <h2 className={ds.heading2}>Chatter</h2>
        <p className={ds.textMuted}>Live thread chatter alongside the board.</p>
      </div>
      <section className="rounded-xl border border-zinc-800 bg-zinc-950/40 p-4">
        <ForumChatter />
      </section>
    </div>
  );
}
