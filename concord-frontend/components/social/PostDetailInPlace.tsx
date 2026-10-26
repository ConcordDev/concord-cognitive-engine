'use client';

/**
 * PostDetailInPlace — the same-page post detail panel used by the Social
 * hub and the profile pages (JOB 7).
 *
 * Reuses the existing PostDetail (real `social.postDetail` macro + the
 * same comment thread) and adds only the open-in-place plumbing:
 *
 *  - view-transition-name matching the tapped feed card's name
 *    (`social-post-<id>`), so `document.startViewTransition` morphs the
 *    tapped card into this panel and back out on close (the opener hook,
 *    useOpenPostInPlace, drives the transitions).
 *  - Focus moves into the panel when it opens; the opener returns focus
 *    to the originating card on close.
 *  - PostDetail's back control is the close control (aria-label
 *    "Close post", ≥44px tap target).
 *  - Where the View Transitions API is missing, the panel gets the plain
 *    CSS cross-fade class `social-post-open-fade` (globals.css); where
 *    the API exists the browser drives the morph and the class is never
 *    applied. Feature-detection happens after mount so server and client
 *    markup match.
 */

import { useEffect, useRef, useState } from 'react';
import { cn } from '@/lib/utils';
import { PostDetail } from './feed/PostDetail';

/** Shared-element name for the card→detail morph. Feed cards set the
 *  same name (see the feed surfaces) so the browser pairs them. Post ids
 *  are `post_<ts>_<n>` from the server; the sanitize keeps the value a
 *  valid CSS <custom-ident> no matter what reaches the client. */
export function socialPostViewTransitionName(postId: string): string {
  return `social-post-${String(postId || '').replace(/[^a-zA-Z0-9_-]/g, '')}`;
}

interface PostDetailInPlaceProps {
  postId: string;
  username: string;
  currentUserId?: string;
  onClose: () => void;
  onOpenPost: (postId: string) => void;
  onOpenHashtag: (tag: string) => void;
  onQuote: () => void;
}

export function PostDetailInPlace({
  postId,
  username,
  currentUserId,
  onClose,
  onOpenPost,
  onOpenHashtag,
  onQuote,
}: PostDetailInPlaceProps) {
  const panelRef = useRef<HTMLElement | null>(null);
  const [useFallbackFade, setUseFallbackFade] = useState(false);

  useEffect(() => {
    // Feature-detect after mount (keeps SSR markup and hydration stable):
    // no View Transitions API → plain CSS cross-fade instead. The state
    // must render as false during hydration and flip after mount, so this
    // cannot be a render-time read or a useState initializer.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setUseFallbackFade(typeof document.startViewTransition !== 'function');
  }, []);

  // Focus moves into the detail view on open (and on in-place navigation
  // to another post, i.e. a quoted post).
  useEffect(() => {
    panelRef.current?.focus();
  }, [postId]);

  return (
    <section
      ref={panelRef}
      aria-label="Post detail"
      data-testid="social-post-detail-inplace"
      tabIndex={-1}
      className={cn('space-y-3 outline-none', useFallbackFade && 'social-post-open-fade')}
      style={{ viewTransitionName: socialPostViewTransitionName(postId) }}
    >
      <PostDetail
        postId={postId}
        username={username}
        currentUserId={currentUserId}
        onBack={onClose}
        backLabel="Close post"
        onOpenHashtag={onOpenHashtag}
        onOpenDetail={onOpenPost}
        onQuote={onQuote}
      />
    </section>
  );
}