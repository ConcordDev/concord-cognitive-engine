'use client';

/**
 * ConnectPanel — external mail/chat bridges + messaging repos.
 * Extracted from lenses/message/page.tsx during consolidation.
 */

import { GmailSection } from '@/components/message/GmailSection';
import { SlackSection } from '@/components/message/SlackSection';
import { MessagingRepos } from '@/components/message/MessagingRepos';

export function ConnectPanel() {
  return (
    <div className="space-y-4 px-1 py-2">
      <GmailSection />
      <SlackSection />
      <section className="rounded-xl border border-lattice-border bg-lattice-surface/40 p-4">
        <MessagingRepos />
      </section>
    </div>
  );
}
