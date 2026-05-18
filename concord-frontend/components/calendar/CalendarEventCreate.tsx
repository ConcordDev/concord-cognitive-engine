'use client';

import { useState, useEffect, useCallback } from 'react';
import { callCalendarMacro, type Calendar } from '@/lib/api/calendar';
import { X, Loader2, Plus, Repeat } from 'lucide-react';

interface Props {
  open: boolean;
  onClose: () => void;
  calendars: Calendar[];
  defaultDate?: string | null;
  onCreated: () => void;
}

const RRULE_PRESETS: { label: string; rrule: string | null }[] = [
  { label: "Doesn't repeat", rrule: null },
  { label: "Daily", rrule: "FREQ=DAILY" },
  { label: "Weekly", rrule: "FREQ=WEEKLY" },
  { label: "Weekdays (M-F)", rrule: "FREQ=WEEKLY;BYDAY=MO,TU,WE,TH,FR" },
  { label: "Monthly (same day)", rrule: "FREQ=MONTHLY" },
  { label: "Yearly", rrule: "FREQ=YEARLY" },
];

export function CalendarEventCreate({ open, onClose, calendars, defaultDate, onCreated }: Props) {
  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [location, setLocation] = useState('');
  const [date, setDate] = useState(defaultDate || new Date().toISOString().slice(0, 10));
  const [startTime, setStartTime] = useState('09:00');
  const [endTime, setEndTime] = useState('10:00');
  const [allDay, setAllDay] = useState(false);
  const [calendarId, setCalendarId] = useState<string>('');
  const [rrule, setRrule] = useState<string | null>(null);
  const [conferencingUrl, setConferencingUrl] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (open) {
      setTitle(''); setDescription(''); setLocation('');
      setDate(defaultDate || new Date().toISOString().slice(0, 10));
      setStartTime('09:00'); setEndTime('10:00'); setAllDay(false);
      setRrule(null); setConferencingUrl(''); setError(null);
      const def = calendars.find((c) => c.kind === 'personal') || calendars[0];
      setCalendarId(def?.id || '');
    }
  }, [open, defaultDate, calendars]);

  const submit = useCallback(async () => {
    if (!title.trim() || !calendarId) return;
    setBusy(true); setError(null);
    try {
      const startAt = allDay
        ? Math.floor(new Date(`${date}T00:00:00Z`).getTime() / 1000)
        : Math.floor(new Date(`${date}T${startTime}:00`).getTime() / 1000);
      const endAt = allDay
        ? Math.floor(new Date(`${date}T23:59:59Z`).getTime() / 1000)
        : Math.floor(new Date(`${date}T${endTime}:00`).getTime() / 1000);
      const r = await callCalendarMacro<{ id?: string; reason?: string }>('event_create', {
        calendarId, title, descriptionHtml: description ? `<p>${description.replace(/\n+/g, '</p><p>')}</p>` : null,
        location: location || null,
        startAt, endAt, allDay,
        rrule: rrule || null,
        conferencingUrl: conferencingUrl || null,
        defaultReminderMinutes: 15,
      });
      if (r.ok) onCreated();
      else setError(r.reason || 'create_failed');
    } catch (e: unknown) {
      setError((e as Error)?.message || 'create_failed');
    } finally { setBusy(false); }
  }, [title, calendarId, description, location, date, startTime, endTime, allDay, rrule, conferencingUrl, onCreated]);

  if (!open) return null;
  return (
    <div className="fixed inset-0 bg-black/70 z-50 flex items-start justify-center pt-24 p-4">
      <div className="bg-zinc-900 border border-white/10 rounded-lg w-full max-w-xl">
        <div className="flex items-center justify-between p-3 border-b border-white/10">
          <h3 className="text-sm font-semibold text-white">New event</h3>
          <button onClick={onClose} className="p-1 rounded hover:bg-white/10 text-white/60">
            <X className="w-4 h-4" />
          </button>
        </div>
        <div className="p-4 space-y-3">
          <input
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            autoFocus
            placeholder="Event title"
            onKeyDown={(e) => { if ((e.metaKey || e.ctrlKey) && e.key === 'Enter') submit(); }}
            className="w-full px-2 py-1.5 text-sm bg-white/5 border border-white/10 rounded text-white"
          />
          <select
            value={calendarId}
            onChange={(e) => setCalendarId(e.target.value)}
            className="w-full px-2 py-1.5 text-sm bg-white/5 border border-white/10 rounded text-white"
          >
            {calendars.map((c) => <option key={c.id} value={c.id} className="bg-black">{c.name} ({c.kind})</option>)}
          </select>
          <div className="grid grid-cols-3 gap-2 items-end">
            <div>
              <label className="text-xs text-white/40">Date</label>
              <input type="date" value={date} onChange={(e) => setDate(e.target.value)} className="w-full mt-1 px-2 py-1 text-sm bg-white/5 border border-white/10 rounded text-white" />
            </div>
            {!allDay && (
              <>
                <div>
                  <label className="text-xs text-white/40">Start</label>
                  <input type="time" value={startTime} onChange={(e) => setStartTime(e.target.value)} className="w-full mt-1 px-2 py-1 text-sm bg-white/5 border border-white/10 rounded text-white" />
                </div>
                <div>
                  <label className="text-xs text-white/40">End</label>
                  <input type="time" value={endTime} onChange={(e) => setEndTime(e.target.value)} className="w-full mt-1 px-2 py-1 text-sm bg-white/5 border border-white/10 rounded text-white" />
                </div>
              </>
            )}
          </div>
          <label className="flex items-center gap-2 text-sm text-white/80 cursor-pointer">
            <input type="checkbox" checked={allDay} onChange={(e) => setAllDay(e.target.checked)} className="accent-cyan-400" />
            All-day event
          </label>
          <input value={location} onChange={(e) => setLocation(e.target.value)} placeholder="Location (optional)" className="w-full px-2 py-1.5 text-sm bg-white/5 border border-white/10 rounded text-white" />
          <input value={conferencingUrl} onChange={(e) => setConferencingUrl(e.target.value)} placeholder="Conferencing URL (optional)" className="w-full px-2 py-1.5 text-sm bg-white/5 border border-white/10 rounded text-white" />
          <textarea value={description} onChange={(e) => setDescription(e.target.value)} placeholder="Description (optional)" rows={2} className="w-full px-2 py-1.5 text-sm bg-white/5 border border-white/10 rounded text-white resize-none" />
          <div>
            <label className="text-xs text-white/40 flex items-center gap-1"><Repeat className="w-3 h-3" /> Recurrence</label>
            <select value={rrule || ''} onChange={(e) => setRrule(e.target.value || null)} className="w-full mt-1 px-2 py-1.5 text-sm bg-white/5 border border-white/10 rounded text-white">
              {RRULE_PRESETS.map((p) => <option key={p.label} value={p.rrule || ''} className="bg-black">{p.label}</option>)}
            </select>
          </div>
          {error && <div className="text-xs text-red-400">{error}</div>}
        </div>
        <div className="flex justify-end gap-2 p-3 border-t border-white/10">
          <button onClick={onClose} className="px-3 py-1.5 rounded hover:bg-white/10 text-white/70 text-sm">Cancel</button>
          <button onClick={submit} disabled={busy || !title.trim() || !calendarId} className="px-4 py-1.5 rounded bg-cyan-500/20 hover:bg-cyan-500/30 text-cyan-200 text-sm font-medium disabled:opacity-40 flex items-center gap-2">
            {busy ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Plus className="w-3.5 h-3.5" />}
            Create
          </button>
        </div>
      </div>
    </div>
  );
}
