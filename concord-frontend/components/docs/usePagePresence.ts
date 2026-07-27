'use client';

/**
 * usePagePresence — drives the real-time multi-cursor presence for a
 * docs page. Pings docs.presence-ping on a heartbeat (carrying the
 * block the local user is focused on) and polls docs.presence-list to
 * surface other editors' cursors. Calls docs.presence-leave on unmount.
 */

import { useCallback, useEffect, useRef, useState } from 'react';
import { lensRun } from '@/lib/api/client';
import { useSmartPolling } from '@/hooks/useSmartPolling';
import type { Cursor } from './types';

const HEARTBEAT_MS = 8000;
const POLL_MS = 5000;

function makeSessionId(): string {
  return `s_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
}

export function usePagePresence(pageId: string | null) {
  const [cursors, setCursors] = useState<Cursor[]>([]);
  const sessionRef = useRef<string>(makeSessionId());
  const blockRef = useRef<string | null>(null);
  const aliveRef = useRef(true);

  const sendPing = useCallback(async (pid: string) => {
    await lensRun('docs', 'presence-ping', {
      pageId: pid,
      sessionId: sessionRef.current,
      blockId: blockRef.current,
    });
  }, []);

  const ping = useCallback((blockId: string | null) => {
    blockRef.current = blockId;
    if (pageId) void sendPing(pageId);
  }, [pageId, sendPing]);

  const poll = useCallback(async () => {
    if (!pageId) return;
    const r = await lensRun('docs', 'presence-list', { pageId, sessionId: sessionRef.current });
    if (aliveRef.current) setCursors((r.data?.result?.cursors as Cursor[]) || []);
  }, [pageId]);

  // Initial ping + poll on mount/pageId-change, and presence-leave on
  // unmount/pageId-change - unaffected by hidden-tab pausing below, since
  // leaving is an explicit navigation-away, not a visibility signal.
  useEffect(() => {
    aliveRef.current = true;
    if (!pageId) { setCursors([]); return; }
    const pid = pageId;
    const sid = sessionRef.current;
    void sendPing(pid);
    void poll();
    return () => {
      aliveRef.current = false;
      void lensRun('docs', 'presence-leave', { pageId: pid, sessionId: sid });
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pageId]);

  // Heartbeat + cursor-list poll, tab-visibility-paused + jittered (see
  // hooks/useSmartPolling.ts). Server's PRESENCE_TTL_MS is 30s
  // (server/domains/docs.js) against an 8s heartbeat - a 3.75x margin, so
  // pausing while hidden is not just safe, it's the CORRECT presence
  // semantic: after ~30s backgrounded, other users' cursor lists naturally
  // stop showing you, matching how Google Docs/Figma/Notion treat a
  // backgrounded tab as "stepped away." Before this fix the heartbeat kept
  // firing forever on a hidden tab, so presence never expired for
  // collaborators even though nobody was looking - arguably the honesty
  // gap, not this fix. `immediate: false` on both since the effect above
  // already covers the initial fire.
  useSmartPolling(() => { if (pageId) void sendPing(pageId); }, HEARTBEAT_MS, { enabled: !!pageId, immediate: false });
  useSmartPolling(poll, POLL_MS, { enabled: !!pageId, immediate: false });

  return { cursors, ping, sessionId: sessionRef.current };
}
