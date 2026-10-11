'use client';

import type { ReactNode } from 'react';
import { isCommunityRedditEnabled } from '@/lib/community/reddit-flag';

/**
 * Renders nothing when the Reddit community flag is off, including the
 * children. Callers wrap the panel and its chrome so no empty card remains.
 */
export function CommunityRedditSlot({ children }: { children: ReactNode }) {
  if (!isCommunityRedditEnabled()) return null;
  return children;
}
