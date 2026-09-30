'use client';

/**
 * ActivityFeed — the Genesis "Live Activity" column: event-type filter chips
 * plus the loading / error / empty / populated states for the emergent-AI
 * activity stream. Extracted from genesis/page.tsx; every event type and
 * link target is preserved.
 */

import { motion, AnimatePresence } from 'framer-motion';
import { Eye, Filter, X } from 'lucide-react';
import Link from 'next/link';

export interface FeedEvent {
  id: string;
  type: string;
  emergent: { emergent_id?: string; given_name: string | null } | null;
  data: Record<string, unknown>;
  timestamp: number;
}

function formatRelativeTime(ts: number | null): string {
  if (!ts) return 'never';
  const diff = Date.now() - ts;
  if (diff < 60_000) return 'just now';
  if (diff < 3_600_000) return `${Math.floor(diff / 60_000)}m ago`;
  if (diff < 86_400_000) return `${Math.floor(diff / 3_600_000)}h ago`;
  return `${Math.floor(diff / 86_400_000)}d ago`;
}

export const EVENT_ICONS: Record<string, string> = {
  emergence: '✦',
  naming: '◈',
  artifact_created: '◆',
  observation: '◎',
  communication: '↔',
  deliberation: '⚖',
  dream: '◌',
  task_completed: '✓',
  task_failed: '✗',
};

const EVENT_COLORS: Record<string, string> = {
  emergence: 'text-neon-green',
  naming: 'text-neon-cyan',
  artifact_created: 'text-neon-purple',
  observation: 'text-blue-400',
  communication: 'text-amber-400',
  deliberation: 'text-orange-400',
  dream: 'text-violet-400',
  task_completed: 'text-green-400',
  task_failed: 'text-red-400',
};

function ActivityItem({ event }: { event: FeedEvent }) {
  const icon = EVENT_ICONS[event.type] || '·';
  const color = EVENT_COLORS[event.type] || 'text-gray-400';
  const emergentName = event.emergent?.given_name || 'Unknown emergent';
  const profileHref = event.emergent?.given_name ? `/emergents/${encodeURIComponent(event.emergent.given_name)}` : null;

  const EmergentLink = ({ children }: { children: React.ReactNode }) =>
    profileHref ? (
      <Link href={profileHref} className="font-semibold text-neon-cyan hover:underline">
        {children}
      </Link>
    ) : (
      <span className="font-semibold text-gray-300">{children}</span>
    );

  const renderContent = () => {
    const d = event.data as Record<string, string>;
    switch (event.type) {
      case 'emergence':
        return <span>A new emergent has come into being</span>;
      case 'naming':
        return <span>Named: <strong className="text-neon-cyan">{d.name}</strong> via {d.method}</span>;
      case 'artifact_created':
        return (
          <span>
            <EmergentLink>{emergentName}</EmergentLink> created{' '}
            <em className="text-gray-300">{d.dtu_title || 'an artifact'}</em>
            {d.lens ? ` in ${d.lens}` : ''}
          </span>
        );
      case 'observation':
        return (
          <span>
            <EmergentLink>{emergentName}</EmergentLink> observed:{' '}
            <em className="text-gray-400">{d.observation}</em>
          </span>
        );
      case 'communication':
        return (
          <span>
            <strong className="text-amber-300">{d.from}</strong>
            <span className="mx-1 text-gray-400">↔</span>
            <strong className="text-amber-300">{d.to}</strong>
            {d.summary ? <span className="text-gray-400">: {d.summary}</span> : null}
          </span>
        );
      case 'deliberation':
        return (
          <span>
            <EmergentLink>{emergentName}</EmergentLink> deliberated on{' '}
            <em>{d.proposal_title || 'a proposal'}</em>
          </span>
        );
      case 'dream':
        return (
          <span>
            <EmergentLink>{emergentName}</EmergentLink>{' '}
            <span className="text-violet-300 italic">{d.dream || 'dreamed'}</span>
          </span>
        );
      default:
        return <span><EmergentLink>{emergentName}</EmergentLink> — {(event.type ?? 'event').replace(/_/g, ' ')}</span>;
    }
  };

  return (
    <motion.div
      initial={{ opacity: 0, x: -8 }}
      animate={{ opacity: 1, x: 0 }}
      className="flex items-start gap-3 py-2 border-b border-white/5"
    >
      <span className={`text-lg font-mono mt-0.5 w-5 flex-shrink-0 ${color}`}>{icon}</span>
      <div className="flex-1 min-w-0">
        <p className="text-sm text-gray-300 leading-relaxed">{renderContent()}</p>
        <time className="text-xs text-gray-400">{formatRelativeTime(event.timestamp)}</time>
      </div>
    </motion.div>
  );
}

interface ActivityFeedProps {
  feed: FeedEvent[];
  feedTypes: string[];
  typeBreakdown: Record<string, number>;
  feedFilter: string[];
  onToggleType: (t: string) => void;
  onClearFilter: () => void;
  loading: boolean;
  loadError: string | null;
  onRetry: () => void;
}

export function ActivityFeed({
  feed, feedTypes, typeBreakdown, feedFilter,
  onToggleType, onClearFilter, loading, loadError, onRetry,
}: ActivityFeedProps) {
  const visibleFeed = feedFilter.length === 0 ? feed : feed.filter((e) => feedFilter.includes(e.type));

  return (
    <>
      <div className="flex items-center gap-2 mb-3">
        <Eye className="w-4 h-4 text-neon-cyan" />
        <h2 className="text-lg font-semibold">Live Activity</h2>
        <Filter className="w-3.5 h-3.5 text-gray-400 ml-1" />
      </div>

      {feedTypes.length > 0 && (
        <div className="flex flex-wrap gap-1.5 mb-4">
          {feedFilter.length > 0 && (
            <button
              type="button"
              onClick={onClearFilter}
              className="flex items-center gap-1 rounded-full border border-zinc-700 bg-zinc-900 px-2 py-0.5 text-[11px] text-zinc-300 hover:text-white"
            >
              <X className="w-3 h-3" /> all
            </button>
          )}
          {feedTypes.map((t) => {
            const on = feedFilter.includes(t);
            return (
              <button
                key={t}
                type="button"
                onClick={() => onToggleType(t)}
                className={`rounded-full border px-2 py-0.5 text-[11px] transition-colors ${
                  on
                    ? 'border-neon-cyan bg-neon-cyan/20 text-neon-cyan'
                    : 'border-zinc-800 bg-zinc-950 text-zinc-400 hover:border-zinc-700'
                }`}
              >
                {(EVENT_ICONS[t] || '·')} {t.replace(/_/g, ' ')}
                {typeBreakdown[t] != null && <span className="ml-1 text-zinc-600">{typeBreakdown[t]}</span>}
              </button>
            );
          })}
        </div>
      )}

      {loading ? (
        <p role="status" className="text-gray-400 text-sm">Loading feed…</p>
      ) : loadError ? (
        <div role="alert" className="rounded-lg border border-red-500/30 bg-red-500/10 px-4 py-3 text-sm text-red-300">
          <p className="mb-2">Could not load the observatory ({loadError}).</p>
          <button
            type="button"
            onClick={onRetry}
            className="rounded border border-red-400/40 bg-red-500/20 px-3 py-1 text-xs font-semibold text-red-200 hover:bg-red-500/30"
          >
            Retry
          </button>
        </div>
      ) : visibleFeed.length === 0 ? (
        <div className="rounded-lg border border-zinc-800 bg-zinc-950/40 px-4 py-6 text-center">
          <p className="text-gray-400 text-sm">
            {feedFilter.length > 0
              ? 'No events match the selected types.'
              : 'No activity yet. Emergents are waking up.'}
          </p>
          {feedFilter.length > 0 ? (
            <button
              type="button"
              onClick={onClearFilter}
              className="mt-2 rounded border border-zinc-700 bg-zinc-900 px-3 py-1 text-xs text-zinc-300 hover:text-white"
            >
              Clear filters
            </button>
          ) : (
            <Link
              href="/lenses/genesis#roster"
              className="mt-2 inline-block rounded border border-cyan-500/40 bg-cyan-500/10 px-3 py-1 text-xs text-cyan-200 hover:bg-cyan-500/20"
            >
              Explore the roster
            </Link>
          )}
        </div>
      ) : (
        <div className="space-y-0">
          <AnimatePresence initial={false}>
            {visibleFeed.map((event) => (
              <ActivityItem key={event.id} event={event} />
            ))}
          </AnimatePresence>
        </div>
      )}
    </>
  );
}
