'use client';

import { useEffect, useRef, useState } from 'react';

/**
 * The Badge Settlement (register A2): a badge must never paint an
 * UNSETTLED claim as a settled word. Callers feed this component a
 * boolean socket-health value (useRealtimeLens's isLive) that is false
 * throughout every load's connecting window — so the old render painted
 * a false "OFF" / "Disconnected" on every surface at load and flipped
 * to LIVE when the handshake landed (the flicker family: Commonsense
 * F8's twelfth surface, Metalearning F19's ninth).
 *
 * The settle discipline, applied here so every mount inherits it:
 *  - from mount, the claim is PENDING (a neutral "Connecting") until it
 *    settles;
 *  - isLive true settles LIVE at once — and once a badge has been live,
 *    a later false is a real disconnect, rendered OFF immediately;
 *  - isLive still false after BADGE_SETTLE_MS settles OFF: a genuinely
 *    unreachable socket is then a truth, not a transient.
 */

export const BADGE_SETTLE_MS = 3000;

export type BadgeClaim = 'pending' | 'live' | 'off';

export function badgeClaim(args: {
  isLive: boolean;
  hasBeenLive: boolean;
  mountedForMs: number;
}): BadgeClaim {
  if (args.isLive) return 'live';
  if (args.hasBeenLive) return 'off';
  return args.mountedForMs >= BADGE_SETTLE_MS ? 'off' : 'pending';
}

interface LiveIndicatorProps {
  isLive: boolean;
  lastUpdated: string | null;
  compact?: boolean;
}

export function LiveIndicator({ isLive, lastUpdated, compact }: LiveIndicatorProps) {
  const mountedAt = useRef(Date.now());
  const [hasBeenLive, setHasBeenLive] = useState(isLive);
  const [, setSettleTick] = useState(0);

  useEffect(() => {
    if (isLive && !hasBeenLive) setHasBeenLive(true);
  }, [isLive, hasBeenLive]);

  useEffect(() => {
    if (hasBeenLive || isLive) return;
    const remaining = BADGE_SETTLE_MS - (Date.now() - mountedAt.current);
    if (remaining <= 0) return;
    const t = setTimeout(() => setSettleTick((x) => x + 1), remaining);
    return () => clearTimeout(t);
  }, [hasBeenLive, isLive]);

  const claim = badgeClaim({
    isLive,
    hasBeenLive,
    mountedForMs: Date.now() - mountedAt.current,
  });

  const timeAgo = lastUpdated
    ? formatTimeAgo(new Date(lastUpdated))
    : null;

  if (compact) {
    return (
      <span className="inline-flex shrink-0 items-center gap-1 whitespace-nowrap text-xs">
        <span
          className={`w-2 h-2 rounded-full ${
            claim === 'live'
              ? 'bg-green-500 animate-pulse'
              : claim === 'pending'
                ? 'bg-zinc-500'
                : 'bg-gray-400'
          }`}
        />
        {claim === 'live' ? 'LIVE' : claim === 'pending' ? 'CONNECTING' : 'OFF'}
      </span>
    );
  }

  return (
    <div className="inline-flex items-center gap-2 px-2 py-1 rounded-md bg-zinc-800/50 text-xs">
      <span
        className={`w-2 h-2 rounded-full ${
          claim === 'live'
            ? 'bg-green-500 animate-pulse'
            : claim === 'pending'
              ? 'bg-zinc-500'
              : 'bg-gray-400'
        }`}
      />
      <span className={claim === 'live' ? 'text-green-400' : 'text-zinc-400'}>
        {claim === 'live' ? 'LIVE' : claim === 'pending' ? 'Connecting' : 'Disconnected'}
      </span>
      {timeAgo && (
        <span className="text-zinc-400">
          {timeAgo}
        </span>
      )}
    </div>
  );
}

function formatTimeAgo(date: Date): string {
  const seconds = Math.floor((Date.now() - date.getTime()) / 1000);
  if (seconds < 10) return 'just now';
  if (seconds < 60) return `${seconds}s ago`;
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  return `${hours}h ago`;
}
