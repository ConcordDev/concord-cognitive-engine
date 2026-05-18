'use client';

import { useState, useEffect, useCallback } from 'react';
import { callCalendarMacro, type Calendar } from '@/lib/api/calendar';
import { X, Loader2, Plus, Copy, Check, Trash2, Link2 } from 'lucide-react';

interface BookingLink {
  id: string;
  slug: string;
  title: string;
  description?: string | null;
  duration_minutes: number;
  buffer_minutes: number;
  target_calendar_id: string;
  window_days_ahead: number;
  work_start_hour: number;
  work_end_hour: number;
  include_weekends: number;
  active: number;
  booking_count: number;
}

interface Props { open: boolean; onClose: () => void; calendars: Calendar[]; }

export function CalendarBookingPanel({ open, onClose, calendars }: Props) {
  const [links, setLinks] = useState<BookingLink[]>([]);
  const [creating, setCreating] = useState(false);
  const [draft, setDraft] = useState({
    title: '', durationMinutes: 30, bufferMinutes: 5,
    targetCalendarId: '', windowDaysAhead: 14,
    workStartHour: 9, workEndHour: 17, includeWeekends: false,
  });
  const [busy, setBusy] = useState(false);
  const [copied, setCopied] = useState<string | null>(null);

  const load = useCallback(async () => {
    const r = await callCalendarMacro<{ links?: BookingLink[] }>('booking_link_list');
    if (r?.links) setLinks(r.links);
  }, []);

  useEffect(() => { if (open) load(); }, [open, load]);

  useEffect(() => {
    if (creating && !draft.targetCalendarId && calendars.length > 0) {
      const def = calendars.find((c) => c.kind === 'personal') || calendars[0];
      setDraft((d) => ({ ...d, targetCalendarId: def.id }));
    }
  }, [creating, calendars, draft.targetCalendarId]);

  const submit = useCallback(async () => {
    if (!draft.title.trim() || !draft.targetCalendarId) return;
    setBusy(true);
    try {
      await callCalendarMacro('booking_link_create', draft);
      setCreating(false);
      setDraft({ ...draft, title: '' });
      load();
    } finally { setBusy(false); }
  }, [draft, load]);

  const remove = useCallback(async (id: string) => {
    if (!confirm('Delete this booking link?')) return;
    setBusy(true);
    try { await callCalendarMacro('booking_link_delete', { id }); load(); }
    finally { setBusy(false); }
  }, [load]);

  const copyLink = useCallback((slug: string) => {
    const url = `${typeof window !== 'undefined' ? window.location.origin : ''}/book/${slug}`;
    navigator.clipboard.writeText(url);
    setCopied(slug);
    setTimeout(() => setCopied(null), 1500);
  }, []);

  if (!open) return null;
  return (
    <div className="fixed inset-0 bg-black/70 z-50 flex items-center justify-center p-4">
      <div className="bg-zinc-900 border border-white/10 rounded-lg w-full max-w-2xl flex flex-col" style={{ maxHeight: '85vh' }}>
        <div className="flex items-center justify-between p-3 border-b border-white/10">
          <h3 className="text-sm font-semibold text-white flex items-center gap-2">
            <Link2 className="w-4 h-4 text-cyan-400" /> Booking links
          </h3>
          <div className="flex gap-2">
            {!creating && (
              <button onClick={() => setCreating(true)} className="px-2 py-1 text-xs rounded bg-cyan-500/20 hover:bg-cyan-500/30 text-cyan-200 flex items-center gap-1">
                <Plus className="w-3 h-3" /> New
              </button>
            )}
            <button onClick={onClose} className="p-1 rounded hover:bg-white/10 text-white/60"><X className="w-4 h-4" /></button>
          </div>
        </div>
        <div className="flex-1 overflow-y-auto p-3 space-y-2">
          {creating && (
            <div className="border border-cyan-500/30 rounded p-3 space-y-2 bg-cyan-500/5">
              <input value={draft.title} onChange={(e) => setDraft({ ...draft, title: e.target.value })} placeholder="Link title (e.g. '30-min intro')" autoFocus className="w-full px-2 py-1.5 text-sm bg-white/5 border border-white/10 rounded text-white" />
              <div className="grid grid-cols-3 gap-2">
                <div>
                  <label className="text-xs text-white/40">Duration (min)</label>
                  <input type="number" value={draft.durationMinutes} onChange={(e) => setDraft({ ...draft, durationMinutes: Number(e.target.value) || 30 })} className="w-full mt-1 px-2 py-1 text-sm bg-white/5 border border-white/10 rounded text-white" />
                </div>
                <div>
                  <label className="text-xs text-white/40">Buffer (min)</label>
                  <input type="number" value={draft.bufferMinutes} onChange={(e) => setDraft({ ...draft, bufferMinutes: Number(e.target.value) || 0 })} className="w-full mt-1 px-2 py-1 text-sm bg-white/5 border border-white/10 rounded text-white" />
                </div>
                <div>
                  <label className="text-xs text-white/40">Window (days)</label>
                  <input type="number" value={draft.windowDaysAhead} onChange={(e) => setDraft({ ...draft, windowDaysAhead: Number(e.target.value) || 14 })} className="w-full mt-1 px-2 py-1 text-sm bg-white/5 border border-white/10 rounded text-white" />
                </div>
              </div>
              <div className="grid grid-cols-3 gap-2">
                <div>
                  <label className="text-xs text-white/40">Start hour</label>
                  <input type="number" min="0" max="23" value={draft.workStartHour} onChange={(e) => setDraft({ ...draft, workStartHour: Number(e.target.value) || 9 })} className="w-full mt-1 px-2 py-1 text-sm bg-white/5 border border-white/10 rounded text-white" />
                </div>
                <div>
                  <label className="text-xs text-white/40">End hour</label>
                  <input type="number" min="1" max="24" value={draft.workEndHour} onChange={(e) => setDraft({ ...draft, workEndHour: Number(e.target.value) || 17 })} className="w-full mt-1 px-2 py-1 text-sm bg-white/5 border border-white/10 rounded text-white" />
                </div>
                <label className="flex items-end gap-1 text-xs text-white/80 cursor-pointer">
                  <input type="checkbox" checked={draft.includeWeekends} onChange={(e) => setDraft({ ...draft, includeWeekends: e.target.checked })} className="accent-cyan-400" />
                  Weekends
                </label>
              </div>
              <select value={draft.targetCalendarId} onChange={(e) => setDraft({ ...draft, targetCalendarId: e.target.value })} className="w-full px-2 py-1.5 text-sm bg-white/5 border border-white/10 rounded text-white">
                {calendars.map((c) => <option key={c.id} value={c.id} className="bg-black">{c.name}</option>)}
              </select>
              <div className="flex gap-2">
                <button onClick={() => setCreating(false)} className="flex-1 py-1.5 rounded hover:bg-white/10 text-white/70 text-sm">Cancel</button>
                <button onClick={submit} disabled={busy || !draft.title.trim()} className="flex-1 py-1.5 rounded bg-cyan-500/20 hover:bg-cyan-500/30 text-cyan-200 text-sm disabled:opacity-40">{busy ? <Loader2 className="w-3.5 h-3.5 animate-spin mx-auto" /> : 'Create'}</button>
              </div>
            </div>
          )}
          {links.length === 0 && !creating && (
            <div className="text-center text-white/40 text-sm py-12">No booking links yet.</div>
          )}
          {links.map((l) => {
            const url = `${typeof window !== 'undefined' ? window.location.origin : ''}/book/${l.slug}`;
            return (
              <div key={l.id} className="border border-white/10 rounded p-3 space-y-2">
                <div className="flex items-start gap-2">
                  <div className="flex-1">
                    <div className="text-sm font-semibold text-white">{l.title}</div>
                    <div className="text-xs text-white/40 mt-0.5">{l.duration_minutes} min · {l.work_start_hour}-{l.work_end_hour}h · {l.window_days_ahead}d window · {l.booking_count} bookings</div>
                  </div>
                  <button onClick={() => remove(l.id)} className="p-1 rounded hover:bg-red-500/20 text-red-400"><Trash2 className="w-3.5 h-3.5" /></button>
                </div>
                <div className="flex items-center gap-1">
                  <input readOnly value={url} className="flex-1 px-2 py-1 text-xs bg-black/40 border border-white/10 rounded text-white/80" />
                  <button onClick={() => copyLink(l.slug)} className="p-1.5 rounded hover:bg-white/10 text-white/70">
                    {copied === l.slug ? <Check className="w-3.5 h-3.5 text-green-400" /> : <Copy className="w-3.5 h-3.5" />}
                  </button>
                </div>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}
