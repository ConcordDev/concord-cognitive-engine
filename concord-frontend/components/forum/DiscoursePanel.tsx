'use client';

/**
 * DiscoursePanel — Discourse-shaped community forum (topics, communities,
 * trending, inbox, categories, moderation, profile) via ForumSection macros.
 */

import { ForumSection } from '@/components/forum/ForumSection';
import { ds } from '@/lib/design-system';

export function DiscoursePanel() {
  return (
    <div className="space-y-3">
      <div>
        <h2 className={ds.heading2}>Discourse</h2>
        <p className={ds.textMuted}>
          Categories, topics, voting, flags, awards — live forum macros.
        </p>
      </div>
      <ForumSection />
    </div>
  );
}
