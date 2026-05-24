'use client';

/**
 * RfOnThisDayPanel — entries from this calendar day in previous years.
 */

import { useCallback, useEffect, useState } from 'react';
import { Loader2, CalendarClock } from 'lucide-react';

import { lensRun } from '@/lib/api/client';

interface Entry {
  id: string; title: string | null; text: string; date: string;
  mood: string | null; tags: string[]; wordCount: number; yearsAgo: number;
}

export function RfOnThisDayPanel() {
  const [entries, setEntries] = useState<Entry[]>([]);
  const [loading, setLoading] = useState(true);

  const refresh = useCallback(async () => {
    setLoading(true);
    const r = await lensRun('reflection', 'on-this-day', {});
    setEntries(r.data?.result?.entries || []);
    setLoading(false);
  }, []);

  useEffect(() => { void refresh(); }, [refresh]);

  if (loading) {
    return <div className="flex items-center justify-center py-10 text-zinc-400"><Loader2 className="w-5 h-5 animate-spin" /></div>;
  }

  return (
    <div className="space-y-3">
      <h3 className="flex items-center gap-1 text-xs font-semibold text-zinc-300">
        <CalendarClock className="w-3.5 h-3.5 text-indigo-400" /> On this day in past years
      </h3>
      {entries.length === 0 ? (
        <p className="text-[11px] text-zinc-400 italic py-8 text-center">
          No past entries on this date yet. Keep journaling — next year this will be a memory.
        </p>
      ) : (
        <ul className="space-y-2">
          {entries.map((e) => (
            <li key={e.id} className="bg-zinc-900/70 border border-zinc-800 rounded-xl p-3">
              <div className="flex items-center justify-between">
                <span className="text-[11px] font-semibold text-indigo-300">
                  {e.yearsAgo} year{e.yearsAgo > 1 ? 's' : ''} ago
                </span>
                <span className="text-[10px] text-zinc-400">{e.date}</span>
              </div>
              {e.title && <p className="text-sm font-semibold text-zinc-100 mt-1">{e.title}</p>}
              <p className="text-xs text-zinc-300 mt-1 whitespace-pre-wrap line-clamp-5">{e.text}</p>
              <div className="flex flex-wrap gap-x-3 gap-y-1 mt-2 text-[10px] text-zinc-400">
                <span>{e.wordCount} words</span>
                {e.mood && <span className="uppercase">{e.mood}</span>}
                {e.tags.map((t) => <span key={t} className="text-indigo-400">#{t}</span>)}
              </div>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
