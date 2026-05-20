'use client';

import { useEffect, useState } from 'react';
import { CalendarDays, Loader2 } from 'lucide-react';
import { lensRun } from '@/lib/api/client';

interface Event {
  listingId: string; address: string; date: string;
  startTime: string; endTime: string; price: number;
}

export function OpenHouseCalendar() {
  const [events, setEvents] = useState<Event[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => { refresh(); }, []);

  async function refresh() {
    setLoading(true);
    try {
      const res = await lensRun({ domain: 'realestate', action: 'open-houses-upcoming', input: { days: 21 } });
      setEvents((res.data?.result?.events || []) as Event[]);
    } catch (e) { console.error('[OpenHouses] failed', e); }
    finally { setLoading(false); }
  }

  return (
    <div className="bg-[#0d1117] border border-cyan-500/20 rounded-lg overflow-hidden">
      <header className="px-4 py-2 border-b border-white/10 flex items-center gap-2">
        <CalendarDays className="w-4 h-4 text-cyan-400" />
        <span className="text-xs uppercase font-semibold text-gray-300 tracking-wider">Open houses · 21 days</span>
        <span className="ml-auto text-[10px] text-gray-500">{events.length}</span>
      </header>
      <div className="max-h-96 overflow-y-auto">
        {loading ? (
          <div className="flex items-center justify-center py-6 text-xs text-gray-500"><Loader2 className="w-4 h-4 animate-spin mr-2" /> Loading…</div>
        ) : events.length === 0 ? (
          <div className="px-3 py-10 text-center text-xs text-gray-500"><CalendarDays className="w-6 h-6 mx-auto mb-2 opacity-30" />No upcoming open houses.</div>
        ) : (
          <ul className="divide-y divide-white/5">
            {events.map((e, i) => (
              <li key={i} className="px-3 py-2 hover:bg-white/[0.03] flex items-center gap-3">
                <div className="w-10 h-10 rounded bg-cyan-500/10 flex flex-col items-center justify-center text-[10px] text-cyan-300 font-mono">
                  <span className="text-[8px] uppercase">{e.date.slice(5, 7)}</span>
                  <span className="font-bold">{e.date.slice(8)}</span>
                </div>
                <div className="flex-1 min-w-0">
                  <div className="text-sm text-white truncate">{e.address}</div>
                  <div className="text-[10px] text-gray-500">{e.startTime} – {e.endTime}</div>
                </div>
                <span className="font-mono text-sm text-cyan-300 tabular-nums">${e.price.toLocaleString()}</span>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}

export default OpenHouseCalendar;
