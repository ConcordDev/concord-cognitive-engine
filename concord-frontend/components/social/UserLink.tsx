'use client';

/**
 * UserLink — tiny clickable username chip that routes to /profile/[username]
 * (or /profile/<userId> when only an id is known).
 *
 * Phase 10e: the pan-social UX primitive every social-mention surface
 * should use so user identity becomes a first-class navigation target.
 *
 *   <UserLink username="kai" displayName="Kai" />
 *   <UserLink userId="u_abc123" />
 *   <UserLink username="kai" prefix="@" tone="muted" />
 *
 * Falls back to plain span when neither identifier is present so it's
 * safe to drop into surfaces with messy data.
 */

import Link from 'next/link';
import { cn } from '@/lib/utils';

export interface UserLinkProps {
  username?: string | null;
  userId?: string | null;
  displayName?: string | null;
  /** Optional prefix character — most callers want '@' for mentions. */
  prefix?: string;
  /** Visual tone. */
  tone?: 'default' | 'muted' | 'accent';
  className?: string;
}

export function UserLink({
  username,
  userId,
  displayName,
  prefix = '',
  tone = 'default',
  className,
}: UserLinkProps) {
  const handle = username || userId;
  const label = displayName || username || (userId ? userId.slice(0, 12) : 'unknown');

  const toneCls =
    tone === 'muted'
      ? 'text-zinc-400 hover:text-zinc-100'
      : tone === 'accent'
      ? 'text-indigo-300 hover:text-indigo-200'
      : 'text-zinc-200 hover:text-indigo-300';

  if (!handle) {
    return (
      <span className={cn('font-medium', toneCls, className)}>
        {prefix}{label}
      </span>
    );
  }

  return (
    <Link
      href={`/profile/${encodeURIComponent(handle)}`}
      className={cn(
        'font-medium underline-offset-2 hover:underline transition-colors',
        toneCls,
        className,
      )}
      title={label}
    >
      {prefix}{label}
    </Link>
  );
}

export default UserLink;
