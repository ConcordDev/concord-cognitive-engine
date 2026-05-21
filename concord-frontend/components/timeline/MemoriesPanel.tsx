'use client';

// MemoriesPanel — "On this day" view. Wires the timeline.memories macro.

import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Clock, History, Loader2, ThumbsUp, MessageCircle } from 'lucide-react';
import { lensRun } from '@/lib/api/client';
import type { Memory } from './types';

interface MemoriesResult {
  memories: Memory[];
  count: number;
  onThisDay: string;
}

export function MemoriesPanel() {
  // Optional date override — defaults to today on the server.
  const [date, setDate] = useState('');

  const { data, isLoading } = useQuery({
    queryKey: ['timeline-memories', date],
    queryFn: async () => {
      const r = await lensRun<MemoriesResult>('timeline', 'memories', date ? { date } : {});
      return r.data.result ?? { memories: [], count: 0, onThisDay: '' };
    },
  });

  return (
    <div className="space-y-3">
      <div className="bg-[#242526] rounded-lg p-4 flex items-center justify-between flex-wrap gap-2">
        <div className="flex items-center gap-2">
          <History className="w-5 h-5 text-amber-400" />
          <h3 className="font-semibold text-white">On This Day</h3>
          {data?.onThisDay && <span className="text-xs text-gray-500">{data.onThisDay}</span>}
        </div>
        <input
          type="date"
          value={date}
          onChange={(e) => setDate(e.target.value)}
          className="bg-[#3a3b3c] text-white text-xs rounded px-2 py-1.5 outline-none focus:ring-1 focus:ring-amber-500"
        />
      </div>

      {isLoading ? (
        <div className="bg-[#242526] rounded-lg p-6 text-center text-sm text-gray-500">
          <Loader2 className="w-5 h-5 animate-spin mx-auto" />
        </div>
      ) : (data?.count ?? 0) === 0 ? (
        <div className="bg-[#242526] rounded-lg p-8 text-center text-gray-500">
          <Clock className="w-10 h-10 mx-auto mb-3 opacity-40" />
          <p className="text-sm">No memories on this day. Posts you make today will resurface here in future years.</p>
        </div>
      ) : (
        (data?.memories ?? []).map((m) => (
          <article key={m.id} className="bg-[#242526] rounded-lg p-4">
            <div className="flex items-center gap-2 mb-2">
              <div className="px-2 py-0.5 rounded-full bg-amber-500/20 text-amber-400 text-xs font-medium">
                {m.yearsAgo} year{m.yearsAgo === 1 ? '' : 's'} ago
              </div>
              <span className="text-xs text-gray-500">{new Date(m.createdAt).toLocaleDateString()}</span>
            </div>
            <p className="text-sm text-gray-200 whitespace-pre-wrap">{m.content}</p>
            <div className="flex items-center gap-4 mt-2 pt-2 border-t border-gray-700 text-xs text-gray-400">
              <span className="inline-flex items-center gap-1">
                <ThumbsUp className="w-3.5 h-3.5" /> {m.reactionTotal}
              </span>
              <span className="inline-flex items-center gap-1">
                <MessageCircle className="w-3.5 h-3.5" /> {m.commentCount}
              </span>
            </div>
          </article>
        ))
      )}
    </div>
  );
}
