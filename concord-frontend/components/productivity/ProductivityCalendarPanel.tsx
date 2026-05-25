'use client';

/**
 * ProductivityCalendarPanel — month-grid calendar of scheduled tasks
 * with two-way ICS sync. calendar-view builds the grid; calendar-export-ics
 * produces a downloadable .ics; calendar-import-ics ingests an ICS feed
 * (paste or http(s) URL — Google Calendar's "secret address in iCal format"
 * works). All tasks shown are the user's real scheduled tasks.
 */

import { useCallback, useEffect, useState } from 'react';
import { Loader2, ChevronLeft, ChevronRight, Download, Upload, CalendarDays } from 'lucide-react';
import { lensRun } from '@/lib/api/client';
import { cn } from '@/lib/utils';

interface DayCell {
  date: string;
  tasks: { id: string; content: string; priority: number; dueTime: string | null; done: boolean }[];
  reminders: { id: string; remindAt: string; note: string; kind: string }[];
}
interface CalendarResult {
  month: string;
  firstWeekday: number;
  daysInMonth: number;
  days: DayCell[];
  totalScheduled: number;
}

const WEEKDAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const PRIORITY_DOT: Record<number, string> = {
  1: 'bg-rose-500', 2: 'bg-amber-500', 3: 'bg-sky-500', 4: 'bg-zinc-600',
};

function shiftMonth(monthIso: string, delta: number): string {
  const [y, m] = monthIso.split('-').map(Number);
  const d = new Date(Date.UTC(y, m - 1 + delta, 1));
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}-01`;
}

export function ProductivityCalendarPanel({ onChange }: { onChange: () => void }) {
  const [anchor, setAnchor] = useState(() => new Date().toISOString().slice(0, 7) + '-01');
  const [cal, setCal] = useState<CalendarResult | null>(null);
  const [loading, setLoading] = useState(true);
  const [selected, setSelected] = useState<string | null>(null);
  const [icsText, setIcsText] = useState('');
  const [icsUrl, setIcsUrl] = useState('');
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ kind: 'ok' | 'err'; text: string } | null>(null);

  const refresh = useCallback(async () => {
    setLoading(true);
    const r = await lensRun('productivity', 'calendar-view', { month: anchor });
    setCal((r.data?.result as CalendarResult | null) || null);
    setLoading(false);
  }, [anchor]);

  useEffect(() => { void refresh(); }, [refresh]);

  const exportIcs = async () => {
    setBusy(true); setMsg(null);
    const r = await lensRun('productivity', 'calendar-export-ics', {});
    setBusy(false);
    if (r.data?.ok && r.data.result?.ics) {
      const blob = new Blob([r.data.result.ics], { type: 'text/calendar' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url; a.download = 'concord-tasks.ics';
      a.click();
      URL.revokeObjectURL(url);
      setMsg({ kind: 'ok', text: `Exported ${r.data.result.eventCount} event(s).` });
    } else {
      setMsg({ kind: 'err', text: r.data?.error || 'Export failed.' });
    }
  };
  const importIcs = async () => {
    if (!icsText.trim() && !icsUrl.trim()) { setMsg({ kind: 'err', text: 'Paste ICS text or a feed URL.' }); return; }
    setBusy(true); setMsg(null);
    const r = await lensRun('productivity', 'calendar-import-ics',
      icsText.trim() ? { ics: icsText } : { url: icsUrl.trim() });
    setBusy(false);
    if (r.data?.ok && r.data.result) {
      setMsg({ kind: 'ok', text: `Imported ${r.data.result.importedCount} of ${r.data.result.parsedEvents} event(s).` });
      setIcsText(''); setIcsUrl('');
      await refresh();
      onChange();
    } else {
      setMsg({ kind: 'err', text: r.data?.error || 'Import failed.' });
    }
  };

  if (loading) {
    return <div className="flex items-center justify-center py-10 text-zinc-400"><Loader2 className="w-5 h-5 animate-spin" /></div>;
  }

  const dayMap = new Map<string, DayCell>((cal?.days || []).map((d) => [d.date, d]));
  const lead = cal?.firstWeekday ?? 0;
  const cells: (DayCell | null)[] = [
    ...Array(lead).fill(null),
    ...(cal?.days || []),
  ];
  const selectedCell = selected ? dayMap.get(selected) : null;

  return (
    <div className="space-y-3">
      {/* Month nav */}
      <div className="flex items-center justify-between">
        <button type="button" onClick={() => setAnchor((a) => shiftMonth(a, -1))}
          className="p-1.5 rounded-lg bg-zinc-800 hover:bg-zinc-700 text-zinc-300" aria-label="Previous month">
          <ChevronLeft className="w-4 h-4" />
        </button>
        <div className="flex items-center gap-1.5 text-sm font-semibold text-zinc-100">
          <CalendarDays className="w-4 h-4 text-red-400" />
          {cal?.month} <span className="text-[11px] font-normal text-zinc-400">· {cal?.totalScheduled} scheduled</span>
        </div>
        <button type="button" onClick={() => setAnchor((a) => shiftMonth(a, 1))}
          className="p-1.5 rounded-lg bg-zinc-800 hover:bg-zinc-700 text-zinc-300" aria-label="Next month">
          <ChevronRight className="w-4 h-4" />
        </button>
      </div>

      {/* Grid */}
      <div className="grid grid-cols-7 gap-1">
        {WEEKDAYS.map((w) => (
          <div key={w} className="text-[10px] text-center text-zinc-400 uppercase tracking-wide py-1">{w}</div>
        ))}
        {cells.map((c, i) => {
          if (!c) return <div key={`pad-${i}`} />;
          const day = Number(c.date.slice(-2));
          const isToday = c.date === new Date().toISOString().slice(0, 10);
          const items = c.tasks.length + c.reminders.length;
          return (
            <button key={c.date} type="button" onClick={() => setSelected(c.date)}
              className={cn('aspect-square rounded-lg border p-1 flex flex-col items-start text-left',
                isToday ? 'border-red-700/60 bg-red-950/20' : 'border-zinc-800 bg-zinc-900/50 hover:bg-zinc-800/60',
                selected === c.date && 'ring-1 ring-red-500')}>
              <span className={cn('text-[10px]', isToday ? 'text-red-300 font-bold' : 'text-zinc-400')}>{day}</span>
              <div className="mt-auto flex flex-wrap gap-0.5">
                {c.tasks.slice(0, 4).map((t) => (
                  <span key={t.id} className={cn('w-1.5 h-1.5 rounded-full', PRIORITY_DOT[t.priority] || 'bg-zinc-600',
                    t.done && 'opacity-30')} />
                ))}
                {c.reminders.length > 0 && <span className="w-1.5 h-1.5 rounded-full bg-emerald-500" />}
              </div>
              {items > 4 && <span className="text-[8px] text-zinc-400">+{items - 4}</span>}
            </button>
          );
        })}
      </div>

      {/* Selected day detail */}
      {selectedCell && (
        <div className="rounded-xl border border-zinc-800 bg-zinc-900/60 p-3 space-y-1.5">
          <p className="text-xs font-semibold text-zinc-200">{selectedCell.date}</p>
          {selectedCell.tasks.length === 0 && selectedCell.reminders.length === 0 && (
            <p className="text-[11px] text-zinc-400 italic">Nothing scheduled.</p>
          )}
          {selectedCell.tasks.map((t) => (
            <p key={t.id} className="text-[11px] text-zinc-300 flex items-center gap-1.5">
              <span className={cn('w-1.5 h-1.5 rounded-full', PRIORITY_DOT[t.priority])} />
              <span className={cn(t.done && 'line-through text-zinc-600')}>{t.content}</span>
              {t.dueTime && <span className="text-zinc-400">{t.dueTime}</span>}
            </p>
          ))}
          {selectedCell.reminders.map((r) => (
            <p key={r.id} className="text-[11px] text-emerald-400">↻ {r.note || 'Reminder'} — {r.remindAt}</p>
          ))}
        </div>
      )}

      {/* ICS sync */}
      <div className="rounded-xl border border-zinc-800 bg-zinc-900/60 p-3 space-y-2">
        <p className="text-[10px] uppercase tracking-wide text-zinc-400">Calendar sync (ICS)</p>
        <button type="button" onClick={exportIcs} disabled={busy}
          className="flex items-center gap-1 px-3 py-1.5 text-xs font-medium bg-zinc-800 hover:bg-zinc-700 disabled:opacity-40 text-zinc-200 rounded-lg">
          <Download className="w-3.5 h-3.5" /> Export tasks as .ics
        </button>
        <input placeholder="Google Calendar iCal feed URL (https://…)" value={icsUrl}
          onChange={(e) => setIcsUrl(e.target.value)}
          className="w-full bg-zinc-950 border border-zinc-700 rounded-lg px-2.5 py-1.5 text-xs text-zinc-100" />
        <textarea placeholder="…or paste ICS text" value={icsText} onChange={(e) => setIcsText(e.target.value)}
          rows={3}
          className="w-full bg-zinc-950 border border-zinc-700 rounded-lg px-2.5 py-1.5 text-xs text-zinc-100 font-mono" />
        <button type="button" onClick={importIcs} disabled={busy}
          className="flex items-center gap-1 px-3 py-1.5 text-xs font-medium bg-red-600 hover:bg-red-500 disabled:opacity-40 text-white rounded-lg">
          {busy ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Upload className="w-3.5 h-3.5" />} Import calendar
        </button>
        {msg && (
          <p className={cn('text-[11px]', msg.kind === 'ok' ? 'text-emerald-400' : 'text-rose-400')}>{msg.text}</p>
        )}
      </div>
    </div>
  );
}
