'use client';

/**
 * usePagePresence — drives the real-time multi-cursor presence for a
 * docs page. Pings docs.presence-ping on a heartbeat (carrying the
 * block the local user is focused on) and polls docs.presence-list to
 * surface other editors' cursors. Calls docs.presence-leave on unmount.
 */

import { useCallback, useEffect, useRef, useState } from 'react';
import { lensRun } from '@/lib/api/client';
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

  useEffect(() => {
    if (!pageId) { setCursors([]); return; }
    const pid = pageId;
    const sid = sessionRef.current;
    let alive = true;

    void sendPing(pid);
    const poll = async () => {
      const r = await lensRun('docs', 'presence-list', { pageId: pid, sessionId: sid });
      if (alive) setCursors((r.data?.result?.cursors as Cursor[]) || []);
    };
    void poll();

    const hb = setInterval(() => { void sendPing(pid); }, HEARTBEAT_MS);
    const pl = setInterval(() => { void poll(); }, POLL_MS);

    return () => {
      alive = false;
      clearInterval(hb);
      clearInterval(pl);
      void lensRun('docs', 'presence-leave', { pageId: pid, sessionId: sid });
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pageId]);

  return { cursors, ping, sessionId: sessionRef.current };
}
