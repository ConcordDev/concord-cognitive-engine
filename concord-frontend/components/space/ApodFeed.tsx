'use client';

/**
 * ApodFeed — NASA Astronomy Picture of the Day. Calls space.apod for
 * today's image plus a date picker and a random-gallery mode. Free
 * NASA API (keyless DEMO_KEY unless NASA_API_KEY is set server-side).
 */

import { useState, useEffect, useCallback } from 'react';
import { Image as ImageIcon, Loader2, AlertTriangle, Shuffle, Calendar } from 'lucide-react';
import { lensRun } from '@/lib/api/client';
import { cn } from '@/lib/utils';

interface ApodItem {
  date: string;
  title: string;
  explanation: string;
  mediaType: string;
  url: string;
  hdurl: string | null;
  copyright: string | null;
}

interface ApodResult {
  items: ApodItem[];
  count: number;
  usingDemoKey: boolean;
}

export function ApodFeed() {
  const [items, setItems] = useState<ApodItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [date, setDate] = useState('');
  const [active, setActive] = useState<ApodItem | null>(null);

  const fetchApod = useCallback(async (params: Record<string, unknown>) => {
    setLoading(true);
    setError(null);
    const r = await lensRun<ApodResult>('space', 'apod', params);
    if (r.data?.ok && r.data.result) {
      setItems(r.data.result.items);
      setActive(r.data.result.items[0] || null);
    } else {
      setError(r.data?.error || 'NASA imagery unavailable');
    }
    setLoading(false);
  }, []);

  useEffect(() => {
    fetchApod({});
  }, [fetchApod]);

  const today = new Date().toISOString().slice(0, 10);

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between flex-wrap gap-2">
        <h3 className="text-sm font-semibold text-white flex items-center gap-2">
          <ImageIcon className="w-4 h-4 text-sky-400" /> NASA Imagery · APOD
        </h3>
        <div className="flex items-center gap-2">
          <label className="flex items-center gap-1.5 text-[11px] text-zinc-400">
            <Calendar className="w-3.5 h-3.5" />
            <input
              type="date"
              max={today}
              value={date}
              onChange={(e) => {
                setDate(e.target.value);
                if (e.target.value) fetchApod({ date: e.target.value });
              }}
              className="bg-zinc-900 border border-zinc-800 rounded px-1.5 py-0.5 text-zinc-200 text-xs"
            />
          </label>
          <button
            onClick={() => {
              setDate('');
              fetchApod({ count: 9 });
            }}
            className="flex items-center gap-1.5 px-2.5 py-1.5 text-xs bg-sky-600 hover:bg-sky-500 text-white rounded-lg"
          >
            <Shuffle className="w-3.5 h-3.5" /> Random gallery
          </button>
        </div>
      </div>

      {error && (
        <div className="flex items-center gap-2 text-xs text-rose-400 bg-rose-500/10 rounded-lg p-3">
          <AlertTriangle className="w-4 h-4 shrink-0" /> {error}
        </div>
      )}

      {loading && (
        <div className="flex items-center justify-center py-8">
          <Loader2 className="w-5 h-5 animate-spin text-sky-400" />
        </div>
      )}

      {active && !loading && (
        <div className="bg-zinc-900 rounded-xl border border-zinc-800 overflow-hidden">
          {active.mediaType === 'image' ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              src={active.hdurl || active.url}
              alt={active.title}
              className="w-full max-h-[420px] object-contain bg-black"
            />
          ) : (
            <div className="aspect-video">
              <iframe
                src={active.url}
                title={active.title}
                allowFullScreen
                className="w-full h-full"
              />
            </div>
          )}
          <div className="p-4 space-y-1.5">
            <div className="flex items-baseline justify-between gap-2">
              <p className="text-sm font-semibold text-white">{active.title}</p>
              <span className="text-[11px] text-zinc-400 shrink-0">{active.date}</span>
            </div>
            <p className="text-xs text-zinc-400 leading-relaxed line-clamp-4">
              {active.explanation}
            </p>
            {active.copyright && (
              <p className="text-[11px] text-zinc-400">© {active.copyright.trim()}</p>
            )}
          </div>
        </div>
      )}

      {items.length > 1 && (
        <div className="grid grid-cols-3 sm:grid-cols-5 gap-2">
          {items.map((it, i) => (
            <button
              key={`${it.date}-${i}`}
              onClick={() => setActive(it)}
              className={cn(
                'rounded-lg overflow-hidden border aspect-square',
                active?.date === it.date && active?.title === it.title
                  ? 'border-sky-500'
                  : 'border-zinc-800 hover:border-zinc-600',
              )}
            >
              {it.mediaType === 'image' ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img src={it.url} alt={it.title} className="w-full h-full object-cover" />
              ) : (
                <div className="w-full h-full flex items-center justify-center bg-zinc-950 text-[10px] text-zinc-400">
                  video
                </div>
              )}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
