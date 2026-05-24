'use client';

/**
 * WikipediaOnThisDayPanel — real Wikipedia "On This Day" content for
 * the history lens.
 *
 * Phase 4 of the 10-dimension UX completeness sprint. Same pattern as
 * NasaLivePanel + UsgsQuakePanel. Proves the REAL_FREE tier for the
 * history domain via Wikimedia's free On This Day REST API.
 */

import { useEffect, useState, useCallback } from 'react';
import { Loader2, Calendar, Cake, Skull, BookOpen, PartyPopper, RefreshCw, AlertTriangle, ExternalLink } from 'lucide-react';
import { api } from '@/lib/api/client';
import { cn } from '@/lib/utils';

interface PageRef {
  title: string;
  extract: string;
  thumbnail: string | null;
  url: string | null;
}

interface OtdEntry {
  kind: 'selected' | 'birth' | 'death' | 'event' | 'holiday';
  year: number;
  text: string;
  pages: PageRef[];
}

type Tab = 'selected' | 'events' | 'births' | 'deaths' | 'holidays';

const TAB_LABELS: Record<Tab, string> = {
  selected: 'Featured',
  events: 'Events',
  births: 'Births',
  deaths: 'Deaths',
  holidays: 'Holidays',
};

const TAB_ICON: Record<Tab, typeof Calendar> = {
  selected: Calendar,
  events: BookOpen,
  births: Cake,
  deaths: Skull,
  holidays: PartyPopper,
};

async function runMacro<T>(name: string, input: Record<string, unknown> = {}): Promise<T | null> {
  try {
    const r = await api.post('/api/lens/run', { domain: 'history', name, input });
    return r?.data as T;
  } catch {
    return null;
  }
}

export function WikipediaOnThisDayPanel({ className }: { className?: string }) {
  const [tab, setTab] = useState<Tab>('selected');
  const [data, setData] = useState<{
    selected: OtdEntry[];
    events: OtdEntry[];
    births: OtdEntry[];
    deaths: OtdEntry[];
    holidays: OtdEntry[];
  } | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [updatedAt, setUpdatedAt] = useState<number | null>(null);
  const [dateLabel, setDateLabel] = useState<string>('');

  const fetchData = useCallback(async () => {
    setLoading(true);
    setError(null);
    const r = await runMacro<{
      ok: boolean; reason?: string; date?: string; fetchedAt?: number;
      selected?: OtdEntry[]; events?: OtdEntry[]; births?: OtdEntry[];
      deaths?: OtdEntry[]; holidays?: OtdEntry[];
    }>('live_wiki_otd');
    if (r?.ok) {
      setData({
        selected: r.selected || [],
        events: r.events || [],
        births: r.births || [],
        deaths: r.deaths || [],
        holidays: r.holidays || [],
      });
      setUpdatedAt(r.fetchedAt || Math.floor(Date.now() / 1000));
      setDateLabel(r.date || '');
    } else {
      setError(r?.reason || 'fetch_failed');
    }
    setLoading(false);
  }, []);

  useEffect(() => { void fetchData(); }, [fetchData]);

  const items = data ? data[tab] : [];
  const TabIcon = TAB_ICON[tab];

  return (
    <section className={cn('rounded-lg border border-zinc-800 bg-zinc-950/80 overflow-hidden', className)}>
      <header className="flex items-center gap-2 px-3 py-2 border-b border-zinc-800/80 bg-zinc-900/40">
        <Calendar className="w-4 h-4 text-violet-300" aria-hidden="true" />
        <h3 className="text-sm font-medium text-zinc-100 flex-1">Wikipedia · On This Day{dateLabel ? ` · ${dateLabel}` : ''}</h3>
        <span className="text-[10px] text-emerald-400 font-mono">REAL data</span>
        <button
          type="button"
          onClick={() => void fetchData()}
          disabled={loading}
          className="p-1 text-zinc-400 hover:text-zinc-200 transition-colors"
          aria-label="Refresh"
        >
          <RefreshCw className={cn('w-3.5 h-3.5', loading && 'animate-spin')} />
        </button>
      </header>

      <nav className="flex border-b border-zinc-800/80 text-xs overflow-x-auto" role="tablist">
        {(Object.keys(TAB_LABELS) as Tab[]).map((t) => {
          const Icon = TAB_ICON[t];
          const count = data ? data[t].length : 0;
          return (
            <button
              key={t}
              type="button"
              role="tab"
              aria-selected={tab === t}
              onClick={() => setTab(t)}
              className={cn(
                'px-3 py-2 font-medium transition-colors flex items-center gap-1.5 shrink-0',
                tab === t
                  ? 'text-violet-300 border-b-2 border-violet-400'
                  : 'text-zinc-400 hover:text-zinc-200 border-b-2 border-transparent',
              )}
            >
              <Icon className="w-3 h-3" aria-hidden="true" />
              {TAB_LABELS[t]}
              {count > 0 && <span className="text-[10px] text-zinc-400 font-mono">{count}</span>}
            </button>
          );
        })}
      </nav>

      <div className="min-h-[300px] max-h-[700px] overflow-y-auto">
        {loading && !data && (
          <div className="flex items-center justify-center py-16">
            <Loader2 className="w-5 h-5 animate-spin text-zinc-400" aria-hidden="true" />
          </div>
        )}
        {error && (
          <div className="px-3 py-4 text-xs text-rose-300/80">
            <AlertTriangle className="inline w-3.5 h-3.5 mr-1" aria-hidden="true" />
            Wikipedia unreachable ({error})
          </div>
        )}
        {!error && items.length === 0 && !loading && (
          <div className="px-3 py-8 text-xs text-zinc-400 italic text-center">
            No <TabIcon className="inline w-3 h-3 -mt-0.5" /> {TAB_LABELS[tab].toLowerCase()} found for this date.
          </div>
        )}
        {items.length > 0 && (
          <ul className="divide-y divide-zinc-800/40">
            {items.map((entry, idx) => (
              <li key={`${entry.kind}-${entry.year}-${idx}`} className="px-3 py-3">
                <div className="flex items-baseline gap-2">
                  <span className="font-mono text-[11px] text-violet-300 shrink-0 w-12 text-right">{entry.year}</span>
                  <p className="text-xs text-zinc-200 leading-snug flex-1">{entry.text}</p>
                </div>
                {entry.pages.length > 0 && (
                  <ul className="mt-2 ml-14 space-y-1.5">
                    {entry.pages.map((p, pIdx) => (
                      <li key={pIdx} className="flex items-start gap-2 text-[11px]">
                        {p.thumbnail && (
                          // eslint-disable-next-line @next/next/no-img-element
                          <img src={p.thumbnail} alt="" className="w-10 h-10 object-cover rounded border border-zinc-800 shrink-0" loading="lazy" />
                        )}
                        <div className="flex-1 min-w-0">
                          <div className="flex items-center gap-1">
                            <span className="text-zinc-300 font-medium truncate">{p.title}</span>
                            {p.url && (
                              <a href={p.url} target="_blank" rel="noopener noreferrer" className="text-zinc-400 hover:text-violet-300 shrink-0" aria-label={`Open ${p.title} on Wikipedia`}>
                                <ExternalLink className="w-3 h-3" />
                              </a>
                            )}
                          </div>
                          {p.extract && <p className="text-zinc-400 text-[10px] leading-tight line-clamp-2 mt-0.5">{p.extract}</p>}
                        </div>
                      </li>
                    ))}
                  </ul>
                )}
              </li>
            ))}
          </ul>
        )}
      </div>

      <footer className="px-3 py-1.5 text-[10px] text-zinc-400 border-t border-zinc-800/40">
        Source: Wikimedia · {updatedAt && new Date(updatedAt * 1000).toLocaleTimeString()}
      </footer>
    </section>
  );
}

export default WikipediaOnThisDayPanel;
