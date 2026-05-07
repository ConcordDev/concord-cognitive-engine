'use client';

/**
 * CreatorLink — Universal creator profile link for any content.
 *
 * Shows the creator's handle/name with a link to their profile.
 * Appears on every piece of user-generated content.
 */

import Link from 'next/link';
import Image from 'next/image';
import { User } from 'lucide-react';
import { cn } from '@/lib/utils';

interface CreatorLinkProps {
  creatorId: string;
  creatorName?: string;
  creatorHandle?: string;
  showAvatar?: boolean;
  avatarUrl?: string;
  size?: 'sm' | 'md' | 'lg';
  className?: string;
}

export function CreatorLink({
  creatorId,
  creatorName,
  creatorHandle,
  showAvatar = true,
  avatarUrl,
  size = 'sm',
  className,
}: CreatorLinkProps) {
  const displayName = creatorName || creatorHandle || creatorId;
  const handle = creatorHandle ? `@${creatorHandle}` : null;

  const sizeClasses = {
    sm: 'text-sm gap-1.5',
    md: 'text-base gap-2',
    lg: 'text-lg gap-2.5',
  };

  const avatarSizes = {
    sm: 'w-5 h-5',
    md: 'w-7 h-7',
    lg: 'w-9 h-9',
  };

  return (
    <Link
      href={`/profile/${creatorHandle || creatorId}`}
      className={cn(
        'inline-flex items-center min-h-[44px] transition-colors',
        'text-[var(--text-secondary,#9B978F)] hover:text-[var(--accent-cool,#5B8DEF)]',
        sizeClasses[size],
        className,
      )}
      title={`View ${displayName}'s profile`}
    >
      {showAvatar && (
        avatarUrl ? (
          <Image
            src={avatarUrl}
            alt={displayName}
            width={size === 'lg' ? 36 : size === 'md' ? 28 : 20}
            height={size === 'lg' ? 36 : size === 'md' ? 28 : 20}
            className={cn('rounded-full object-cover', avatarSizes[size])}
          />
        ) : (
          <div className={cn(
            'rounded-full bg-[var(--bg-raised,#1C1C20)] flex items-center justify-center',
            avatarSizes[size],
          )}>
            <User className={cn(size === 'sm' ? 'w-3 h-3' : 'w-4 h-4', 'text-[var(--text-tertiary,#5C584F)]')} />
          </div>
        )
      )}
      <span className="truncate max-w-[150px]">
        {handle || displayName}
      </span>
    </Link>
  );
}
