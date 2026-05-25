'use client';

/**
 * FashionCalendarPanel — log what was worn on a date and review the
 * month's wear calendar.
 */

import { useCallback, useEffect, useState } from 'react';
import { Loader2, CalendarDays, Plus } from 'lucide-react';
import { lensRun } from '@/lib/api/client';
import { cn } from '@/lib/utils';

interface Outfit { id: string; name: string }
interface Item { id: string; name: string }
interface CalEntry { date: string; label: string; kind: string }

function monthNow(): string { return new Date().toISOString().slice(0, 7); }

export function FashionCalendarPanel({ onChange }: { onChange: () => void }) {
  const [outfits, setOutfits] = useState<Outfit[]>([]);
  const [items, setItems] = useState<Item[]>([]);
  const [entries, setEntries] = useState<CalEntry[]>([]);
  const [month, setMonth] = useState(monthNow());
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [form, setForm] = useState({ kind: 'outfit', refId: '', date: new Date().toISOString().slice(0, 10) });

  const refreshLists = useCallback(async () => {
    const [o, i] = await Promise.all([
      lensRun('fashion', 'outfit-list', {}),
      lensRun('fashion', 'item-list', {}),
    ]);
    setOutfits(o.data?.result?.outfits || []);
    setItems(i.data?.result?.items || []);
  }, []);

  const refreshCalendar = useCallback(async () => {
    setLoading(true);
    const r = await lensRun('fashion', 'calendar-view', { month });
    setEntries(r.data?.result?.entries || []);
    setLoading(false);
  }, [month]);

  useEffect(() => { void refreshLists(); }, [refreshLists]);
  useEffect(() => { void refreshCalendar(); }, [refreshCalendar]);

  const log = async () => {
    if (!form.refId) { setError('Choose an outfit or item.'); return; }
    const params = form.kind === 'outfit'
      ? { outfitId: form.refId, date: form.date }
      : { itemId: form.refId, date: form.date };
    const r = await lensRun('fashion', 'calendar-log', params);
    if (r.data?.ok === false) { setError(r.data?.error || 'Failed'); return; }
    setForm({ ...form, refId: '' });
    setError(null);
    await refreshCalendar(); onChange();
  };

  return (
    <div className="space-y-3">
      {error && <div className="text-xs text-rose-400 bg-rose-950/40 border border-rose-900/50 rounded-lg px-3 py-2">{error}</div>}

      {/* Log a wear */}
      <div className="grid grid-cols-4 gap-2 bg-zinc-900/70 border border-zinc-800 rounded-xl p-3">
        <select value={form.kind} onChange={(e) => setForm({ ...form, kind: e.target.value, refId: '' })}
          className="bg-zinc-950 border border-zinc-700 rounded-lg px-2 py-1.5 text-xs text-zinc-100">
          <option value="outfit">Outfit</option>
          <option value="item">Item</option>
        </select>
        <select value={form.refId} onChange={(e) => setForm({ ...form, refId: e.target.value })}
          className="bg-zinc-950 border border-zinc-700 rounded-lg px-2 py-1.5 text-xs text-zinc-100">
          <option value="">— choose —</option>
          {(form.kind === 'outfit' ? outfits : items).map((x) => <option key={x.id} value={x.id}>{x.name}</option>)}
        </select>
        <input type="date" value={form.date} onChange={(e) => setForm({ ...form, date: e.target.value })}
          className="bg-zinc-950 border border-zinc-700 rounded-lg px-2 py-1.5 text-xs text-zinc-100" />
        <button type="button" onClick={log}
          className="flex items-center justify-center gap-1 bg-fuchsia-600 hover:bg-fuchsia-500 text-white text-xs font-medium rounded-lg">
          <Plus className="w-3.5 h-3.5" /> Log
        </button>
      </div>

      {/* Month picker */}
      <div className="flex items-center gap-2">
        <CalendarDays className="w-3.5 h-3.5 text-fuchsia-400" />
        <input type="month" value={month} onChange={(e) => setMonth(e.target.value)}
          className="bg-zinc-950 border border-zinc-700 rounded-lg px-2 py-1 text-xs text-zinc-100" />
        <span className="text-[11px] text-zinc-400">{entries.length} wears logged</span>
      </div>

      {loading ? (
        <div className="flex items-center justify-center py-8 text-zinc-400"><Loader2 className="w-5 h-5 animate-spin" /></div>
      ) : entries.length === 0 ? (
        <div className="text-center text-zinc-400 text-sm italic py-10 border border-zinc-800 rounded-xl">
          Nothing logged for {month}. Log what you wear to build your style history.
        </div>
      ) : (
        <ul className="space-y-1">
          {entries.map((e, idx) => (
            <li key={idx} className="flex items-center justify-between bg-zinc-900/70 border border-zinc-800 rounded-lg px-3 py-2">
              <span className="text-xs text-zinc-200">{e.label}</span>
              <span className="flex items-center gap-2">
                <span className={cn('text-[10px] uppercase', e.kind === 'outfit' ? 'text-fuchsia-400' : 'text-zinc-400')}>{e.kind}</span>
                <span className="text-[11px] text-zinc-400">{e.date}</span>
              </span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
