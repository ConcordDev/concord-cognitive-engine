'use client';

interface LiveIndicatorProps {
  isLive: boolean;
  lastUpdated: string | null;
  compact?: boolean;
}

export function LiveIndicator({ isLive, lastUpdated, compact }: LiveIndicatorProps) {
  const timeAgo = lastUpdated
    ? formatTimeAgo(new Date(lastUpdated))
    : null;

  if (compact) {
    return (
      <span className="inline-flex items-center gap-1 text-xs">
        <span
          className={`w-2 h-2 rounded-full ${
            isLive ? 'bg-green-500 animate-pulse' : 'bg-gray-400'
          }`}
        />
        {isLive ? 'LIVE' : 'OFF'}
      </span>
    );
  }

  return (
    <div className="inline-flex items-center gap-2 px-2 py-1 rounded-md bg-zinc-800/50 text-xs">
      <span
        className={`w-2 h-2 rounded-full ${
          isLive ? 'bg-green-500 animate-pulse' : 'bg-gray-400'
        }`}
      />
      <span className={isLive ? 'text-green-400' : 'text-zinc-400'}>
        {isLive ? 'LIVE' : 'Disconnected'}
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
