'use client';

// ReactionBreakdown — modal showing "who reacted" per kind for a post.
// Wires the timeline.reactions-breakdown macro.

import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { motion } from 'framer-motion';
import { ThumbsUp, Heart, Laugh, Frown, Angry, X, Loader2 } from 'lucide-react';
import { cn } from '@/lib/utils';
import { lensRun } from '@/lib/api/client';
import type { ReactionKind } from './types';

interface Reactor {
  userId: string;
  kind: ReactionKind;
  at: string;
}
interface BreakdownResult {
  total: number;
  counts: Record<ReactionKind, number>;
  byKind: Record<ReactionKind, { userId: string; at: string }[]>;
  reactors: Reactor[];
}

const KINDS: { id: ReactionKind; icon: typeof ThumbsUp; color: string; label: string }[] = [
  { id: 'like', icon: ThumbsUp, color: 'text-blue-500', label: 'Like' },
  { id: 'love', icon: Heart, color: 'text-red-500', label: 'Love' },
  { id: 'haha', icon: Laugh, color: 'text-yellow-500', label: 'Haha' },
  { id: 'sad', icon: Frown, color: 'text-yellow-500', label: 'Sad' },
  { id: 'angry', icon: Angry, color: 'text-orange-500', label: 'Angry' },
];

export function ReactionBreakdown({ postId, onClose }: { postId: string; onClose: () => void }) {
  const [tab, setTab] = useState<'all' | ReactionKind>('all');

  const { data, isLoading } = useQuery({
    queryKey: ['timeline-reactions', postId],
    queryFn: async () => {
      const r = await lensRun<BreakdownResult>('timeline', 'reactions-breakdown', { postId });
      return r.data.result;
    },
  });

  const reactors: Reactor[] =
    tab === 'all'
      ? data?.reactors ?? []
      : (data?.byKind?.[tab] ?? []).map((r) => ({ ...r, kind: tab }));

  return (
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm"
      onClick={onClose}
    >
      <motion.div
        initial={{ scale: 0.95, opacity: 0 }}
        animate={{ scale: 1, opacity: 1 }}
        exit={{ scale: 0.95, opacity: 0 }}
        className="bg-[#242526] border border-gray-700 rounded-xl w-full max-w-md max-h-[70vh] flex flex-col"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between p-4 border-b border-gray-700">
          <h3 className="font-bold text-white">Reactions {data ? `· ${data.total}` : ''}</h3>
          <button onClick={onClose} className="p-1 rounded hover:bg-[#3a3b3c] text-gray-400" aria-label="Close">
            <X className="w-5 h-5" />
          </button>
        </div>

        <div className="flex gap-1 px-3 py-2 border-b border-gray-700 overflow-x-auto">
          <button
            onClick={() => setTab('all')}
            className={cn(
              'px-3 py-1 rounded-full text-xs font-medium whitespace-nowrap',
              tab === 'all' ? 'bg-blue-600 text-white' : 'text-gray-400 hover:bg-[#3a3b3c]',
            )}
          >
            All {data?.total ?? 0}
          </button>
          {KINDS.map((k) => {
            const n = data?.counts?.[k.id] ?? 0;
            if (n === 0) return null;
            const Icon = k.icon;
            return (
              <button
                key={k.id}
                onClick={() => setTab(k.id)}
                className={cn(
                  'px-3 py-1 rounded-full text-xs font-medium whitespace-nowrap inline-flex items-center gap-1',
                  tab === k.id ? 'bg-blue-600 text-white' : 'text-gray-400 hover:bg-[#3a3b3c]',
                )}
              >
                <Icon className={cn('w-3.5 h-3.5', k.color)} />
                {n}
              </button>
            );
          })}
        </div>

        <div className="flex-1 overflow-y-auto p-3 space-y-1">
          {isLoading ? (
            <div className="flex items-center gap-2 text-sm text-gray-400 py-3">
              <Loader2 className="w-4 h-4 animate-spin" /> Loading…
            </div>
          ) : reactors.length === 0 ? (
            <p className="text-sm text-gray-400 text-center py-6">No reactions yet.</p>
          ) : (
            reactors.map((r, i) => {
              const meta = KINDS.find((k) => k.id === r.kind);
              const Icon = meta?.icon ?? ThumbsUp;
              return (
                <div key={`${r.userId}-${i}`} className="flex items-center gap-3 p-2 rounded-lg hover:bg-[#3a3b3c]">
                  <div className="relative">
                    <div className="w-9 h-9 rounded-full bg-gradient-to-br from-purple-500 to-pink-500" />
                    <div className="absolute -bottom-1 -right-1 w-5 h-5 rounded-full bg-[#242526] flex items-center justify-center">
                      <Icon className={cn('w-3.5 h-3.5', meta?.color)} />
                    </div>
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className="text-sm text-white font-medium truncate">{r.userId}</p>
                    <p className="text-[11px] text-gray-400">{new Date(r.at).toLocaleString()}</p>
                  </div>
                </div>
              );
            })
          )}
        </div>
      </motion.div>
    </motion.div>
  );
}
