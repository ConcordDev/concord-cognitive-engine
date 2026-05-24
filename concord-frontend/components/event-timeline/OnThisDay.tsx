'use client';

import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Calendar, Loader2, ExternalLink, History } from 'lucide-react';
import { SaveAsDtuButton } from '@/components/dtu/SaveAsDtuButton';

interface Page {
  title: string;
  extract?: string;
  content_urls?: { desktop?: { page?: string } };
}

interface Event {
  year: number;
  text: string;
  pages?: Page[];
}

interface OnThisDayResponse {
  events?: Event[];
  births?: Event[];
  deaths?: Event[];
  holidays?: Event[];
  selected?: Event[];
}

const CATEGORIES = [
  { id: 'events', label: 'events' },
  { id: 'selected', label: 'selected' },
  { id: 'births', label: 'births' },
  { id: 'deaths', label: 'deaths' },
  { id: 'holidays', label: 'holidays' },
] as const;

export function OnThisDay() {
  const today = new Date();
  const [month, setMonth] = useState(today.getMonth() + 1);
  const [day, setDay] = useState(today.getDate());
  const [category, setCategory] = useState<typeof CATEGORIES[number]['id']>('events');

  const data = useQuery({
    queryKey: ['on-this-day', month, day],
    queryFn: async () => {
      const m = String(month).padStart(2, '0');
      const d = String(day).padStart(2, '0');
      const r = await fetch(`https://en.wikipedia.org/api/rest_v1/feed/onthisday/all/${m}/${d}`);
      if (!r.ok) throw new Error(`wiki ${r.status}`);
      return (await r.json()) as OnThisDayResponse;
    },
    staleTime: 6 * 60 * 60 * 1000,
  });

  const list = (data.data?.[category] || []).slice().sort((a, b) => b.year - a.year);
  const oldest = list.length > 0 ? Math.min(...list.map((e) => e.year)) : 0;
  const newest = list.length > 0 ? Math.max(...list.map((e) => e.year)) : 0;
  const span = newest - oldest;

  return (
    <div className="space-y-4">
      <header className="flex flex-wrap items-center justify-between gap-3 border-b border-cyan-500/15 pb-3">
        <div className="flex items-center gap-2">
          <History className="h-5 w-5 text-amber-400" />
          <h2 className="text-sm font-semibold text-white">Historical events — on this day</h2>
          <span className="rounded bg-zinc-800 px-1.5 py-0.5 font-mono text-[10px] uppercase tracking-wider text-zinc-400">wikipedia · /feed/onthisday</span>
        </div>
        <div className="flex items-center gap-2">
          <input type="number" min={1} max={12} value={month} onChange={(e) => setMonth(Math.max(1, Math.min(12, Number(e.target.value) || 1)))} className="w-12 rounded border border-zinc-800 bg-zinc-950 px-1 py-1 text-xs text-white" />
          <input type="number" min={1} max={31} value={day} onChange={(e) => setDay(Math.max(1, Math.min(31, Number(e.target.value) || 1)))} className="w-12 rounded border border-zinc-800 bg-zinc-950 px-1 py-1 text-xs text-white" />
          <select value={category} onChange={(e) => setCategory(e.target.value as typeof CATEGORIES[number]['id'])} className="rounded border border-zinc-800 bg-zinc-950 px-2 py-1 text-xs text-white">
            {CATEGORIES.map((c) => <option key={c.id} value={c.id}>{c.label}</option>)}
          </select>
          {list.length > 0 && (
            <SaveAsDtuButton
              compact
              apiSource="wikipedia-onthisday"
              apiUrl={`https://en.wikipedia.org/api/rest_v1/feed/onthisday/all/${String(month).padStart(2, '0')}/${String(day).padStart(2, '0')}`}
              title={`On this day ${month}/${day} — ${category} (${list.length})`}
              content={list.slice(0, 20).map((e) => `${e.year}: ${e.text}`).join('\n')}
              extraTags={['event-timeline', 'wikipedia', 'history', category]}
              rawData={{ month, day, category, items: list }}
            />
          )}
        </div>
      </header>
      {data.isError && <div className="rounded border border-red-500/20 bg-red-500/5 px-3 py-2 text-xs text-red-300">Wikipedia REST unreachable.</div>}
      <div className="grid grid-cols-3 gap-2">
        <div className="rounded border border-zinc-800 bg-zinc-950 px-2.5 py-1.5">
          <div className="text-[10px] uppercase tracking-wider text-zinc-400">Events</div>
          <div className="mt-0.5 font-mono text-lg text-amber-300">{list.length}</div>
        </div>
        <div className="rounded border border-zinc-800 bg-zinc-950 px-2.5 py-1.5">
          <div className="text-[10px] uppercase tracking-wider text-zinc-400">Span (yrs)</div>
          <div className="mt-0.5 font-mono text-lg text-amber-300">{span > 0 ? span.toLocaleString() : '—'}</div>
        </div>
        <div className="rounded border border-zinc-800 bg-zinc-950 px-2.5 py-1.5">
          <div className="text-[10px] uppercase tracking-wider text-zinc-400">Oldest</div>
          <div className="mt-0.5 font-mono text-lg text-amber-300">{oldest || '—'}</div>
        </div>
      </div>
      <div className="space-y-1.5 max-h-[500px] overflow-y-auto">
        {list.map((e, i) => {
          const url = e.pages?.[0]?.content_urls?.desktop?.page;
          const Wrapper = url ? 'a' : 'div';
          return (
            <Wrapper key={`${e.year}-${i}`} {...(url ? { href: url, target: '_blank', rel: 'noopener noreferrer' } : {})} className="block rounded-lg border border-amber-500/20 bg-amber-500/5 p-2.5 hover:border-amber-500/40">
              <div className="flex items-start gap-2">
                <span className="shrink-0 rounded bg-amber-500/20 px-1.5 py-0.5 font-mono text-[10px] text-amber-200">
                  <Calendar className="inline h-2.5 w-2.5 mr-0.5" />
                  {e.year}
                </span>
                <div className="flex-1 min-w-0">
                  <p className="text-[12px] text-zinc-100">{e.text}</p>
                </div>
                {url && <ExternalLink className="h-3 w-3 shrink-0 text-zinc-400" />}
              </div>
            </Wrapper>
          );
        })}
        {list.length === 0 && !data.isPending && !data.isError && (
          <div className="rounded border border-dashed border-zinc-800 p-4 text-center text-[11px] text-zinc-400">No entries for {month}/{day} ({category}).</div>
        )}
      </div>
      {data.isPending && <div className="flex items-center gap-2 text-xs text-zinc-400"><Loader2 className="h-4 w-4 animate-spin" /> Pulling Wikipedia…</div>}
    </div>
  );
}
