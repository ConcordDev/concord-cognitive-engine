'use client';

/**
 * CouncilTheaterPanel
 *
 * Live-stream surface for council deliberations. Connects to the realtime
 * council:theater:* socket events and falls back to /api/council/theater
 * polling every 8s if sockets aren't connected.
 *
 * The panel shows:
 *   • The current proposal (topic + context)
 *   • Live transcript: each council voice as it speaks
 *   • Final verdict when the session completes
 *   • Countdown to the next scheduled session when idle
 */

import { useEffect, useRef, useState } from 'react';

interface VoiceEntry {
  voiceId: string;
  voiceName: string;
  response: string;
  ts: string;
}

interface TheaterSnapshot {
  current: {
    eventId: string;
    proposal: { id: string; topic: string; context?: unknown };
    transcript: VoiceEntry[];
    queued: number;
    startedAt: number;
  } | null;
  next: { startsAt: number; proposal: { id: string; topic: string } } | null;
  history: Array<{ eventId: string; proposal: { id: string; topic: string }; verdict: unknown; completedAt: number }>;
  lastTickAt: number;
}

const PANEL = 'rounded-lg border border-amber-500/30 bg-black/80 backdrop-blur-sm';

export default function CouncilTheaterPanel() {
  const [snap, setSnap] = useState<TheaterSnapshot | null>(null);
  const [now, setNow] = useState(Date.now());
  const wsRef = useRef<WebSocket | null>(null);

  useEffect(() => {
    const id = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(id);
  }, []);

  // HTTP polling — works without a socket; the socket events (below) update
  // the same state in faster time.
  useEffect(() => {
    let cancelled = false;
    async function load() {
      try {
        const r = await fetch('/api/council/theater', { credentials: 'include' });
        if (!r.ok) return;
        const data: TheaterSnapshot & { ok: boolean } = await r.json();
        if (!cancelled && data?.ok) setSnap(data);
      } catch { /* network silent */ }
    }
    load();
    const id = window.setInterval(load, 8_000);
    return () => { cancelled = true; window.clearInterval(id); };
  }, []);

  // Realtime: subscribe to socket.io events for low-latency voice updates.
  useEffect(() => {
    let mounted = true;
    type SocketLike = {
      on: (e: string, h: (p: unknown) => void) => void;
      off: (e: string, h: (p: unknown) => void) => void;
      disconnect?: () => void;
    };
    let socket: SocketLike | null = null;
    (async () => {
      try {
        const { io } = await import('socket.io-client');
        if (!mounted) return;
        socket = io('/', { withCredentials: true, transports: ['websocket', 'polling'] }) as unknown as SocketLike;

        const onVoice = (payload: unknown) => {
          const v = payload as VoiceEntry & { eventId: string };
          setSnap((s) => {
            if (!s?.current || s.current.eventId !== v.eventId) return s;
            return {
              ...s,
              current: {
                ...s.current,
                transcript: [...s.current.transcript, v],
                queued: Math.max(0, s.current.queued - 1),
              },
            };
          });
        };
        const onStarted = (payload: unknown) => {
          const p = payload as { eventId: string; proposal: { id: string; topic: string }; voiceCount: number };
          setSnap((s) => ({
            current: {
              eventId: p.eventId,
              proposal: p.proposal,
              transcript: [],
              queued: p.voiceCount,
              startedAt: Date.now(),
            },
            next: null,
            history: s?.history ?? [],
            lastTickAt: Date.now(),
          }));
        };
        const onScheduled = (payload: unknown) => {
          const p = payload as { eventId: string; proposal: { id: string; topic: string }; startsInMs: number };
          setSnap((s) => ({
            current: s?.current ?? null,
            next: { startsAt: Date.now() + p.startsInMs, proposal: p.proposal },
            history: s?.history ?? [],
            lastTickAt: Date.now(),
          }));
        };
        const onComplete = (payload: unknown) => {
          const p = payload as { eventId: string; verdict: unknown; fullTranscript: VoiceEntry[]; durationMs: number };
          setSnap((s) => {
            if (!s) return s;
            const finished = {
              eventId: p.eventId,
              proposal: s.current?.proposal ?? { id: p.eventId, topic: '' },
              verdict: p.verdict,
              completedAt: Date.now(),
            };
            return {
              ...s,
              current: null,
              history: [finished, ...(s.history ?? [])].slice(0, 10),
            };
          });
        };
        socket?.on('council:theater:voice', onVoice);
        socket?.on('council:theater:started', onStarted);
        socket?.on('council:theater:scheduled', onScheduled);
        socket?.on('council:theater:complete', onComplete);
        wsRef.current = socket as unknown as WebSocket;
      } catch { /* socket library not available — HTTP polling carries the load */ }
    })();
    return () => {
      mounted = false;
      try { (socket as unknown as { disconnect?: () => void })?.disconnect?.(); } catch { /* ok */ }
    };
  }, []);

  const cur = snap?.current;
  const next = snap?.next;

  return (
    <div className={`${PANEL} p-4 max-w-2xl`}>
      <div className="flex items-center gap-2 mb-3">
        <div className={`w-2 h-2 rounded-full ${cur ? 'bg-red-500 animate-pulse' : 'bg-gray-500'}`} />
        <h3 className="text-amber-300 font-semibold">Council Live Theater</h3>
      </div>

      {cur ? (
        <div>
          <div className="text-amber-200/80 text-sm mb-2">
            Now in session — <span className="opacity-70">queued: {cur.queued} voices</span>
          </div>
          <div className="text-white text-sm font-medium mb-3">
            {cur.proposal.topic}
          </div>
          <div className="space-y-2 max-h-[420px] overflow-y-auto">
            {cur.transcript.map((v, i) => (
              <div key={`${v.voiceId}-${i}`} className="border-l-2 border-amber-500/40 pl-3">
                <div className="text-amber-300 text-[11px] uppercase tracking-wider">{v.voiceName}</div>
                <div className="text-gray-200 text-sm">{v.response}</div>
              </div>
            ))}
            {cur.transcript.length === 0 && (
              <div className="text-gray-400 italic text-sm">Waiting for the first voice...</div>
            )}
          </div>
        </div>
      ) : next ? (
        <div className="text-gray-300">
          <div className="text-sm mb-1">Next deliberation in</div>
          <div className="text-2xl font-mono text-amber-300">
            {Math.max(0, Math.ceil((next.startsAt - now) / 1000))}s
          </div>
          <div className="text-sm mt-3 text-gray-400 italic">
            {next.proposal.topic}
          </div>
        </div>
      ) : (
        <div className="text-gray-400 italic text-sm">Council is in recess.</div>
      )}

      {snap?.history && snap.history.length > 0 && (
        <details className="mt-4 text-sm text-gray-400">
          <summary className="cursor-pointer hover:text-amber-300">Recent verdicts</summary>
          <ul className="mt-2 space-y-1 text-xs">
            {snap.history.slice(0, 5).map((h) => (
              <li key={h.eventId} className="truncate">
                <span className="text-amber-300/60">
                  {new Date(h.completedAt).toLocaleTimeString()}
                </span>{' '}
                {h.proposal.topic}
              </li>
            ))}
          </ul>
        </details>
      )}
    </div>
  );
}
