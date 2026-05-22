'use client';

/**
 * MarketingCalendarPanel — unified scheduling view across campaigns,
 * content, social posts and sent emails.
 * Wires: campaign-calendar.
 */

import { useCallback, useEffect, useState } from 'react';
import { Loader2, CalendarDays, Megaphone, PenTool, Share2, Mail } from 'lucide-react';
import { lensRun } from '@/lib/api/client';
import { TimelineView, type TimelineEvent } from '@/components/viz';

interface CalEntry { kind: string; id: string; title: string; date: string; channel: string; marker: string }

const KIND_ICON: Record<string, typeof Megaphone> = {
  campaign: Megaphone, content: PenTool, social: Share2, email: Mail,
};
const KIND_TONE: Record<string, TimelineEvent['tone']> = {
  campaign: 'info', content: 'good', social: 'warn', email: 'default',
};

export function MarketingCalendarPanel() {
  const [entries, setEntries] = useState<CalEntry[]>([]);
  const [byDate, setByDate] = useState<Record<string, CalEntry[]>>({});
  const [days, setDays] = useState<string[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');

  const refresh = useCallback(async (range?: { from?: string; to?: string }) => {
    setLoading(true);
    const params: Record<string, unknown> = {};
    if (range?.from) params.from = range.from;
    if (range?.to) params.to = range.to;
    const r = await lensRun('marketing', 'campaign-calendar', params);
    if (r.data?.ok === false) { setError(r.data?.error || 'Failed'); setLoading(false); return; }
    setEntries(r.data?.result?.entries || []);
    setByDate(r.data?.result?.byDate || {});
    setDays(r.data?.result?.days || []);
    setError(null);
    setLoading(false);
  }, []);

  useEffect(() => { void refresh(); }, [refresh]);

  if (loading) {
    return <div className="flex items-center justify-center py-10 text-zinc-500"><Loader2 className="w-5 h-5 animate-spin" /></div>;
  }

  const timelineEvents: TimelineEvent[] = entries.map((e) => ({
    id: `${e.kind}-${e.id}-${e.date}-${e.marker}`,
    label: e.title,
    time: e.date,
    tone: KIND_TONE[e.kind] || 'default',
    detail: `${e.kind} · ${e.channel} · ${e.marker}`,
  }));

  return (
    <div className="space-y-4">
      {error && <div className="text-xs text-rose-400 bg-rose-950/40 border border-rose-900/50 rounded-lg px-3 py-2">{error}</div>}

      <div className="flex items-center justify-between flex-wrap gap-2">
        <h3 className="flex items-center gap-1.5 text-xs font-semibold text-zinc-300">
          <CalendarDays className="w-3.5 h-3.5 text-orange-400" /> Campaign calendar
        </h3>
        <div className="flex items-center gap-2">
          <input type="date" value={from} onChange={(e) => setFrom(e.target.value)}
            className="bg-zinc-950 border border-zinc-700 rounded-lg px-2 py-1 text-xs text-zinc-100" />
          <span className="text-zinc-600 text-xs">to</span>
          <input type="date" value={to} onChange={(e) => setTo(e.target.value)}
            className="bg-zinc-950 border border-zinc-700 rounded-lg px-2 py-1 text-xs text-zinc-100" />
          <button type="button" onClick={() => refresh({ from, to })}
            className="text-xs bg-orange-600 hover:bg-orange-500 text-white rounded-lg px-3 py-1">Apply</button>
        </div>
      </div>

      {entries.length === 0 ? (
        <p className="text-[11px] text-zinc-500 italic">
          No scheduled items. Campaigns, content, social posts and sent emails appear here.
        </p>
      ) : (
        <>
          <div className="bg-zinc-900/70 border border-zinc-800 rounded-xl p-3">
            <TimelineView events={timelineEvents} height={110} />
          </div>
          <div className="space-y-2">
            {days.map((day) => (
              <div key={day} className="bg-zinc-900/70 border border-zinc-800 rounded-xl p-3">
                <p className="text-xs font-semibold text-zinc-200 mb-1.5">{day}</p>
                <ul className="space-y-1">
                  {(byDate[day] || []).map((e) => {
                    const Icon = KIND_ICON[e.kind] || CalendarDays;
                    return (
                      <li key={`${e.kind}-${e.id}-${e.marker}`} className="flex items-center gap-2 text-[11px] text-zinc-300">
                        <Icon className="w-3.5 h-3.5 text-orange-400 shrink-0" />
                        <span className="truncate">{e.title}</span>
                        <span className="text-zinc-500 ml-auto shrink-0">{e.channel} · {e.marker}</span>
                      </li>
                    );
                  })}
                </ul>
              </div>
            ))}
          </div>
        </>
      )}
    </div>
  );
}
