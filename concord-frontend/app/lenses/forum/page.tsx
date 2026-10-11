'use client';

/**
 * Forum — one shared board.
 *
 * Reference: Discourse topic list. One heading, one primary action.
 * Moderation is a tab inside the board and only for moderator roles.
 */

import { Plus } from 'lucide-react';
import { LensShell } from '@/components/lens/LensShell';
import { SessionRail } from '@/components/lens/SessionRail';
import { CrossLensRecentsPanel } from '@/components/lens/CrossLensRecentsPanel';
import { DepthBadge } from '@/components/lens/DepthBadge';
import { useLensNav } from '@/hooks/useLensNav';
import { useLensCommand } from '@/hooks/useLensCommand';
import { useLensIdentity } from '@/hooks/useLensIdentity';
import { useRealtimeLens } from '@/hooks/useRealtimeLens';
import { LiveIndicator } from '@/components/lens/LiveIndicator';
import { DTUExportButton } from '@/components/lens/DTUExportButton';
import { useAuth } from '@/hooks/useAuth';
import { titleCaseDisplayName } from '@/components/chat/claudeCleanGreeting';
import { ForumSection } from '@/components/forum/ForumSection';
import { requestForumCompose } from '@/components/forum/FmTopicsPanel';

export default function ForumLensPage() {
  useLensNav('forum');
  useLensIdentity('forum');
  const { latestData: realtimeData, alerts: realtimeAlerts, isLive, lastUpdated } = useRealtimeLens('forum');
  const { user } = useAuth();
  const who = titleCaseDisplayName(user?.username);

  const startDiscussion = () => {
    requestForumCompose();
  };

  useLensCommand(
    [
      { id: 'forum-new-topic', keys: 'n', description: 'Start a discussion', category: 'actions' as const, action: startDiscussion },
    ],
    { lensId: 'forum' },
  );

  return (
    <LensShell lensId="forum" asMain={false}>
      <DepthBadge lensId="forum" size="sm" className="ml-2" />
      <div data-lens-theme="forum" className="relative min-h-full px-8 pb-28 pt-6">
        <div className="flex items-start justify-between gap-4">
          <div className="min-w-0">
            <p className="text-[14px] text-zinc-500">Forum</p>
            <h1 className="mb-5 mt-1 font-vault text-[2.25rem] leading-tight text-zinc-100 sm:text-5xl">
              What&apos;s worth reading{who ? `, ${who}` : ''}
            </h1>
          </div>
          <div className="flex shrink-0 items-center gap-3 pt-2">
            {realtimeAlerts.length > 0 && (
              <span className="rounded-full bg-amber-400/10 px-2.5 py-1 text-[12px] text-amber-300">
                {realtimeAlerts.length} alert{realtimeAlerts.length !== 1 ? 's' : ''}
              </span>
            )}
            <LiveIndicator isLive={isLive} lastUpdated={lastUpdated} compact />
            <DTUExportButton domain="forum" data={realtimeData || {}} compact />
          </div>
        </div>

        <ForumSection />

        <section className="mt-6">
          <SessionRail lensId="forum" hideWhenEmpty />
        </section>
        <CrossLensRecentsPanel lensId="forum" sinceDays={7} limit={6} hideWhenEmpty className="mt-6" />

        <button
          type="button"
          onClick={startDiscussion}
          title="Start a discussion (N)"
          className="fixed bottom-8 right-8 z-30 inline-flex items-center gap-2 rounded-full bg-teal-400 px-6 py-3.5 text-[15px] font-medium text-black shadow-[0_8px_32px_rgba(45,212,191,0.25)] transition-colors hover:bg-teal-300"
        >
          <Plus className="h-4 w-4" />
          Start a discussion
        </button>
      </div>
    </LensShell>
  );
}
