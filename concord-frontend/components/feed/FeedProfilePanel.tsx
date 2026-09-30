'use client';

import { UserProfile } from '@/components/social/UserProfile';

export function FeedProfilePanel({
  onNavigateToUser,
}: {
  onNavigateToUser?: (uid: string) => void;
}) {
  return (
    <div className="flex-1 min-w-0 max-w-2xl border-r border-lattice-border">
      <UserProfile
        userId="current-user"
        currentUserId="current-user"
        onNavigateToUser={onNavigateToUser}
      />
    </div>
  );
}
