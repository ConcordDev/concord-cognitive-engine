'use client';

/**
 * Social post permalink page — /lenses/social/post/:postId
 *
 * Backlog item 5: a sharable permalink that resolves a single post via
 * the social.postDetail macro and renders its full detail view.
 */

import { useRouter, useParams } from 'next/navigation';
import { useQuery } from '@tanstack/react-query';
import { Globe2 } from 'lucide-react';
import { LensShell } from '@/components/lens/LensShell';
import { api } from '@/lib/api/client';
import { PostDetail } from '@/components/social/feed/PostDetail';

interface MeResponse {
  ok: boolean;
  user?: { id: string; username: string; displayName?: string };
}

export default function SocialPostPermalinkPage() {
  const router = useRouter();
  const params = useParams<{ postId: string }>();
  const postId = String(params?.postId || '');

  const { data: me } = useQuery<MeResponse | null>({
    queryKey: ['me'],
    queryFn: async () => {
      try { const r = await api.get<MeResponse>('/api/auth/me'); return r?.data; }
      catch { return null; }
    },
    staleTime: 60 * 1000,
  });

  const currentUserId = me?.user?.id || 'current-user';
  const username = me?.user?.username || me?.user?.displayName || currentUserId;

  return (
    <LensShell lensId="social" asMain={false}>
      <div className="min-h-screen bg-lattice-void text-zinc-100">
        <header className="sticky top-0 z-30 border-b border-zinc-800 bg-zinc-950/80 backdrop-blur">
          <div className="max-w-2xl mx-auto px-4 py-2.5 flex items-center gap-2">
            <Globe2 className="w-5 h-5 text-indigo-300" />
            <h1 className="text-base font-semibold">Social · Post</h1>
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
