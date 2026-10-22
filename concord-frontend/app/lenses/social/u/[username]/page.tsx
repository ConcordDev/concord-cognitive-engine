'use client';

import type { ReactNode } from 'react';
import { useParams } from 'next/navigation';
import { useQuery } from '@tanstack/react-query';
import { api } from '@/lib/api/client';
import { UserProfile } from '@/components/social/UserProfile';
import { LensShell } from '@/components/lens/LensShell';

interface MeResponse {
  user?: { id?: string };
}

interface ByUsername {
  ok?: boolean;
  user?: { id: string; username?: string };
  error?: string;
}

export default function SocialProfilePage() {
  const params = useParams<{ username: string }>();
  const username = decodeURIComponent(params?.username || '');

  const me = useQuery({
    queryKey: ['auth-me'],
    queryFn: async () => {
      const res = await api.get<MeResponse>('/api/auth/me');
      return res.data?.user?.id || '';
    },
  });

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
        <UserProfile userId={person.data.id} currentUserId={me.data || undefined} />
      </div>
    );
  }

  return <LensShell lensId="social">{body}</LensShell>;

}
