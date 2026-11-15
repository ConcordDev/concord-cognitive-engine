'use client';

import type { ReactNode } from 'react';
import { useParams, useRouter } from 'next/navigation';
import { useQuery } from '@tanstack/react-query';
import { api } from '@/lib/api/client';
import { UserProfile } from '@/components/social/UserProfile';
import { PostDetailInPlace } from '@/components/social/PostDetailInPlace';
import { useOpenPostInPlace } from '@/hooks/use-open-post-in-place';
import { LensShell } from '@/components/lens/LensShell';

interface MeResponse {
  ok?: boolean;
  user?: { id?: string; username?: string; displayName?: string };
}

interface ByUsername {
  ok?: boolean;
  user?: { id: string; username?: string };
  error?: string;
}

export default function SocialProfilePage() {
  const params = useParams<{ username: string }>();
  const router = useRouter();
  const username = decodeURIComponent(params?.username || '');
  // JOB 7: profile posts open in place (?post=<id> shallow-routed, same
  // machinery as the Social hub — Back/Escape/close return here with the
  // exact scroll position).
  const { openPostId, openPost, closePost } = useOpenPostInPlace();

  // FIX-social-014: the ['auth-me'] key is shared with the shell
  // (Topbar / RailAccount cache the full { ok, user } envelope under
  // it). This page used to cache only res.data.user under the same
  // key, so whichever shape landed first won: with the shell's
  // envelope in the cache, me.data?.id read undefined, the page
  // passed currentUserId=undefined to UserProfile, and the profile's
  // whole Follow/Message row vanished — only 'Copy ID' left in the
  // menu. Cache the envelope like every other consumer of the key,
  // and resolve the viewer tolerantly so an entry written in either
  // shape still yields the signed-in user.
  const me = useQuery({
    queryKey: ['auth-me'],
    queryFn: async () => {
      const res = await api.get<MeResponse>('/api/auth/me');
      return res.data || null;
    },
  });
  const meData = me.data as (MeResponse & { id?: string; username?: string; displayName?: string }) | null | undefined;
  const viewer = meData?.user || (meData?.id ? meData : null);

  const person = useQuery({
    queryKey: ['social-by-username', username],
    queryFn: async () => {
      const res = await api.get<ByUsername>(`/api/social/users/by-username/${encodeURIComponent(username)}`);
      if (!res.data?.ok || !res.data.user?.id) {
        throw new Error(res.data?.error || 'No profile for that name.');
      }
      return res.data.user;
    },
    enabled: username.length >= 2,
  });

  let body: ReactNode;
  if (!username || username.length < 2) {
    body = <p className="p-8 text-sm text-zinc-400">That profile link is incomplete.</p>;
  } else if (person.isLoading || me.isLoading) {
    body = <p className="p-8 text-sm text-zinc-400">Loading profile…</p>;
  } else if (person.isError || !person.data) {
    body = <p className="p-8 text-sm text-zinc-400">{person.error instanceof Error ? person.error.message : 'No profile for that name.'}</p>;
  } else {
    body = (
      <div className="mx-auto max-w-2xl p-6">
        {openPostId ? (
          <PostDetailInPlace
            postId={openPostId}
            username={viewer?.username || viewer?.displayName || viewer?.id || 'current-user'}
            currentUserId={viewer?.id || undefined}
            onClose={closePost}
            onOpenPost={openPost}
            onOpenHashtag={(tag) => router.push(`/lenses/social?tag=${encodeURIComponent(tag)}`)}
            onQuote={closePost}
          />
        ) : null}
        {/* The profile stays mounted but hidden while a post is open —
            closing restores it without a refetch. */}
        <div hidden={openPostId ? true : undefined}>
          <UserProfile
            userId={person.data.id}
            currentUserId={viewer?.id || undefined}
            onOpenPost={openPost}
          />
        </div>
      </div>
    );
  }

  return <LensShell lensId="social">{body}</LensShell>;
}
