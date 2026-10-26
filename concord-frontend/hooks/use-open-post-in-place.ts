'use client';

/**
 * useOpenPostInPlace — Social JOB 7 machinery: tapping a post in any
 * Social feed opens that post's detail view IN PLACE (same page, no full
 * navigation), with a shareable URL and an exact scroll-position return.
 *
 * URL contract: the open post is carried in the `post` query param of the
 * current page (shallow routing via window.history.pushState — Next 14.1+
 * patches history so usePathname/useSearchParams stay in sync and the
 * same-page popstate never reloads). A reload at `?post=<id>` re-opens
 * the post directly (the page seeds state from the param); the dedicated
 * /lenses/social/post/<id> permalink route remains the canonical share
 * URL and keeps working.
 *
 * What this hook owns:
 *  - openPost(postId): saves the current scroll position + the focused
 *    element (the tapped card), pushes `?post=<id>`, and — via the native
 *    View Transitions API when available and motion is allowed — morphs
 *    the tapped card into the detail panel (the card and the panel share
 *    a view-transition-name; see PostDetailInPlace).
 *  - closePost(): Back control / Escape. Pops our pushed history entry so
 *    the browser Back stack stays honest (the popstate listener applies
 *    the close); on a deep link (no entry of ours to pop) it strips the
 *    param with replaceState instead.
 *  - popstate: browser Back/Forward both ways — back closes and restores
 *    the feed's exact scroll position without remounting/refetching it;
 *    forward re-opens.
 *  - Escape key while a post is open.
 *  - Reduced motion (prefers-reduced-motion via framer's useReducedMotion
 *    — the app is already wrapped in <MotionConfig reducedMotion="user">
 *    — plus the in-app accessibility flag the AccessibilityDOMApplier
 *    mirrors onto window.__CONCORD_REDUCE_MOTION__): NO morph and NO
 *    reveal — the detail swaps instantly.
 *
 * The caller renders the detail panel itself (PostDetailInPlace) when
 * openPostId is non-null, keeping the feed mounted but hidden so no
 * list state or react-query cache is lost on the round trip.
 */

import { useCallback, useEffect, useRef, useState } from 'react';
import { flushSync } from 'react-dom';
import { usePathname, useSearchParams } from 'next/navigation';
import { useReducedMotion } from 'framer-motion';

/** Marker key our pushed history entries carry, so closePost can tell
 *  "this entry is ours — pop it" from "deep link — strip the param". */
const HISTORY_STATE_KEY = '__concordSocialPost';

/** The in-app reduce-motion toggle's imperative mirror (set by
 *  AccessibilityDOMApplier; see components/accessibility). */
function inAppReducedMotion(): boolean {
  if (typeof window === 'undefined') return false;
  return (window as unknown as { __CONCORD_REDUCE_MOTION__?: boolean }).__CONCORD_REDUCE_MOTION__ === true;
}

function postFromLocation(): string | null {
  if (typeof window === 'undefined') return null;
  try {
    return new URLSearchParams(window.location.search).get('post') || null;
  } catch {
    return null;
  }
}

export function useOpenPostInPlace() {
  const pathname = usePathname() || '/lenses/social';
  const searchParams = useSearchParams();
  const postParam = searchParams?.get('post') || null;
  const osReduceMotion = useReducedMotion();

  const [openPostId, setOpenPostId] = useState<string | null>(postParam);
  const openPostIdRef = useRef<string | null>(postParam);
  const savedScrollRef = useRef(0);
  const originFocusRef = useRef<HTMLElement | null>(null);
  const closingRef = useRef(false);

  const setOpenId = useCallback((id: string | null) => {
    openPostIdRef.current = id;
    setOpenPostId(id);
  }, []);

  /** Apply a state swap through the View Transitions API when the
   *  browser supports it and motion is allowed; otherwise swap instantly
   *  (plain fallback — never throws where the API is missing). */
  const runTransition = useCallback((update: () => void) => {
    const reduced = osReduceMotion === true || inAppReducedMotion();
    const doc = typeof document !== 'undefined' ? document : undefined;
    if (!reduced && doc && typeof doc.startViewTransition === 'function') {
      doc.startViewTransition(() => flushSync(update));
    } else {
      update();
    }
  }, [osReduceMotion]);

  const applyOpen = useCallback((postId: string) => {
    if (openPostIdRef.current === postId) return;
    setOpenId(postId);
  }, [setOpenId]);

  const applyClose = useCallback(() => {
    if (openPostIdRef.current === null) return;
    closingRef.current = true;
    setOpenId(null);
  }, [setOpenId]);

  /** Open a post in place. Keeps the current query params (place/tab
   *  state survives the round trip) and adds `post=<id>`. */
  const openPost = useCallback((postId: string | null | undefined) => {
    const id = String(postId || '');
    if (!id || openPostIdRef.current === id) return;
    savedScrollRef.current = typeof window !== 'undefined' ? window.scrollY : 0;
    if (typeof document !== 'undefined') {
      const active = document.activeElement as HTMLElement | null;
      originFocusRef.current = active && active !== document.body ? active : null;
    }
    let q = '';
    try {
      const sp = new URLSearchParams(searchParams?.toString() || '');
      sp.set('post', id);
      q = sp.toString();
    } catch { /* fall through without other params */ }
    const url = q ? `${pathname}?${q}` : pathname;
    window.history.pushState({ [HISTORY_STATE_KEY]: id }, '', url);
    runTransition(() => setOpenId(id));
  }, [pathname, searchParams, runTransition, setOpenId]);

  /** Close: Back control / Escape. If the current history entry is one we
   *  pushed, pop it (browser Back stays consistent); the popstate listener
   *  applies the state change. On a deep link there is nothing to pop, so
   *  strip the param in place. */
  const closePost = useCallback(() => {
    if (openPostIdRef.current === null) return;
    const st = window.history.state as Record<string, unknown> | null;
    if (st && typeof st === 'object' && HISTORY_STATE_KEY in st) {
      window.history.back();
    } else {
      let q = '';
      try {
        const sp = new URLSearchParams(window.location.search);
        sp.delete('post');
        q = sp.toString();
      } catch { /* fall through without other params */ }
      window.history.replaceState(st, '', q ? `${pathname}?${q}` : pathname);
      runTransition(() => applyClose());
    }
  }, [applyClose, pathname, runTransition]);

  // Browser Back/Forward: apply whatever the URL says, both directions.
  useEffect(() => {
    const onPop = () => {
      const id = postFromLocation();
      runTransition(() => { if (id) applyOpen(id); else applyClose(); });
    };
    window.addEventListener('popstate', onPop);
    return () => window.removeEventListener('popstate', onPop);
  }, [applyOpen, applyClose, runTransition]);

  // Next-mediated param changes (e.g. a place switch replaced the URL):
  // keep the panel in sync with the router's searchParams. This path is
  // already a router transition, so the swap is instant (no view
  // transition, and no flushSync inside a React effect).
  useEffect(() => {
    if (postParam === openPostIdRef.current) return;
    if (postParam) applyOpen(postParam);
    else applyClose();
  }, [postParam, applyOpen, applyClose]);

  // After a close commits (the feed is visible again): restore the exact
  // scroll position and return focus to the card that opened the post.
  useEffect(() => {
    if (openPostId !== null || !closingRef.current) return;
    closingRef.current = false;
    window.scrollTo(0, savedScrollRef.current);
    const el = originFocusRef.current;
    originFocusRef.current = null;
    if (el && typeof el.focus === 'function' && document.contains(el)) {
      el.focus({ preventScroll: true });
    }
  }, [openPostId]);

  // Escape closes the open post.
  useEffect(() => {
    if (openPostId === null) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') closePost();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [openPostId, closePost]);

  return { openPostId, openPost, closePost };
}