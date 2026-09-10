'use client';

/**
 * ModToolsPanel — forum.threadAnalysis / moderationQueue / communityHealth /
 * topicClustering workbench (ForumActionPanel) with piping.
 */

import { ForumActionPanel } from '@/components/forum/ForumActionPanel';
import { PipingProvider } from '@/components/panel-polish';
import { ds } from '@/lib/design-system';

export function ModToolsPanel() {
  return (
    <div className="space-y-3">
      <div>
        <h2 className={ds.heading2}>Mod tools</h2>
        <p className={ds.textMuted}>
          Thread analysis, moderation queue, community health, topic clustering.
        </p>
      </div>
      <PipingProvider>
        <ForumActionPanel />
      </PipingProvider>
    </div>
  );
}
