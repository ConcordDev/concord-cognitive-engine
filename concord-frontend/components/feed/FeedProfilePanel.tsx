'use client';

import Link from 'next/link';
import { UserProfile } from '@/components/social/UserProfile';

export function FeedProfilePanel({
  userId,
  onNavigateToUser,
}: {
  userId?: string | null;
  onNavigateToUser?: (uid: string) => void;
}) {
  const id = userId || null;
  return (
    <div className="flex-1 min-w-0 max-w-2xl border-r border-lattice-border">
      {id ? (
        <UserProfile
          userId={id}
          currentUserId={id}
          onNavigateToUser={onNavigateToUser}
        />
      ) : (
        <p className="p-6 text-sm text-zinc-400">Sign in to see your profile.</p>
      )}
      <p className="px-6 pb-6 text-sm">
        <Link href="/lenses/social" className="text-teal-300 hover:text-teal-200">Open this profile on Social</Link>
      </p>
    </div>
  );
}
