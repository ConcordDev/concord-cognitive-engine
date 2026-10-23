'use client';

/**
 * Social post permalink page — /lenses/social/post/:postId
 *
 * Backlog item 5: a sharable permalink that resolves a single post via
 * the social.postDetail macro and renders its full detail view.
 */

import { useRouter, useParams } from 'next/navigation';
import { Globe2 } from 'lucide-react';
import { LensShell } from '@/components/lens/LensShell';
import { useCurrentUser } from '@/hooks/use-current-user';
import { PostDetail } from '@/components/social/feed/PostDetail';

export default function SocialPostPermalinkPage() {
  const router = useRouter();
  const params = useParams<{ postId: string }>();
  const postId = String(params?.postId || '');

  // Shared session query (hooks/use-current-user) — same ['me'] key as the
  // social hub, so both pages read one cached session instead of racing two
  // queryFns over the same key.
  const { data: me, isLoading: meLoading } = useCurrentUser();

  const currentUserId = me?.user?.id || 'current-user';
  const username = me?.user?.username || me?.user?.displayName || currentUserId;

  return (
    <LensShell lensId="social" asMain={false}>
      <div className="min-h-screen bg-lattice-void text-zinc-100">
        <header className="sticky top-0 z-30 border-b border-zinc-800 bg-zinc-950/80 backdrop-blur">
          <div className="max-w-2xl mx-auto px-4 py-2.5 flex items-center gap-2">
            <Globe2 className="w-5 h-5 text-indigo-300" />
            <h1 className="text-base font-semibold">Social · Post</h1>
            {meLoading && <span className="ml-auto text-[11px] text-zinc-500">Loading session…</span>}
          </div>
        </header>
        <div className="max-w-2xl mx-auto px-4 py-4">
          <PostDetail
            postId={postId}
            username={username}
            onBack={() => router.push('/lenses/social')}
            onOpenHashtag={(tag) => router.push(`/lenses/social?tag=${encodeURIComponent(tag)}`)}
            onOpenDetail={(id) => router.push(`/lenses/social/post/${id}`)}
            onQuote={() => router.push('/lenses/social')}
          />
        </div>
      </div>
    </LensShell>
  );
}
