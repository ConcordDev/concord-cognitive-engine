'use client';

import { useState, useEffect, useCallback } from 'react';
import { callCalendarMacro, type CalendarEvent, type Attendee, type Reminder } from '@/lib/api/calendar';
import { X, Trash2, MapPin, Clock, Users, Bell, Repeat, Video, Loader2, Check, AlertCircle } from 'lucide-react';

interface Props { event: CalendarEvent; onClose: () => void; onChange: () => void; }

export function CalendarEventDetail({ event, onClose, onChange }: Props) {
  const [full, setFull] = useState<CalendarEvent>(event);
  const [titleDraft, setTitleDraft] = useState(event.title);
  const [attendees, setAttendees] = useState<Attendee[]>([]);
  const [reminders, setReminders] = useState<Reminder[]>([]);
  const [inviteEmail, setInviteEmail] = useState('');
  const [busy, setBusy] = useState(false);

  // Hydrate full event (with attendees + reminders)
  useEffect(() => {
    setFull(event); setTitleDraft(event.title);
    (async () => {
      try {
        const r = await callCalendarMacro<{ event?: CalendarEvent }>('event_get', { id: event.id });
        if (r?.event) {
          setFull(r.event);
          setAttendees(r.event.attendees || []);
          setReminders(r.event.reminders || []);
        }
      } catch { /* silent */ }
    })();
  }, [event.id, event.title]);

  const update = useCallback(async (patch: Record<string, unknown>) => {
    setBusy(true);
    try {
      const r = await callCalendarMacro('event_update', { id: event.id, ...patch });
      if (r.ok) onChange();
    } finally { setBusy(false); }
  }, [event.id, onChange]);

  const remove = useCallback(async () => {
    if (!confirm('Delete this event?')) return;
    setBusy(true);
    try {
      await callCalendarMacro('event_delete', { id: event.id });
      onClose(); onChange();
    } finally { setBusy(false); }
  }, [event.id, onChange, onClose]);

  const invite = useCallback(async () => {
    if (!inviteEmail.trim()) return;
    await callCalendarMacro('attendee_add', { eventId: event.id, email: inviteEmail.trim() });
    setInviteEmail('');
    const r = await callCalendarMacro<{ attendees?: Attendee[] }>('attendee_list', { eventId: event.id });
    setAttendees(r?.attendees || []);
  }, [event.id, inviteEmail]);

  const rsvp = useCallback(async (status: Attendee['rsvp']) => {
    await callCalendarMacro('attendee_rsvp', { eventId: event.id, rsvp: status });
    const r = await callCalendarMacro<{ attendees?: Attendee[] }>('attendee_list', { eventId: event.id });
    setAttendees(r?.attendees || []);
  }, [event.id]);

  const addReminder = useCallback(async (minutesBefore: number) => {
    await callCalendarMacro('reminder_add', { eventId: event.id, minutesBefore });
    const r = await callCalendarMacro<{ event?: CalendarEvent }>('event_get', { id: event.id });
    setReminders(r?.event?.reminders || []);
  }, [event.id]);

  const fmtDate = (sec: number) => new Date(sec * 1000).toLocaleString(undefined, { weekday: 'short', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' });

  return (
    <div className="flex flex-col h-full">
      <div className="flex items-center gap-2 p-3 border-b border-white/10">
        <span className="w-2 h-2 rounded-full" style={{ backgroundColor: full.color || '#22d3ee' }} />
        <span className="flex-1 text-xs text-white/40 truncate">{full.id}</span>
        <button onClick={remove} disabled={busy} className="p-1.5 rounded hover:bg-red-500/20 text-red-400">
          <Trash2 className="w-3.5 h-3.5" />
        </button>
        <button onClick={onClose} className="p-1.5 rounded hover:bg-white/10 text-white/60">
          <X className="w-4 h-4" />
        </button>
      </div>

      <div className="flex-1 overflow-y-auto p-3 space-y-3">
        <input
          value={titleDraft}
          onChange={(e) => setTitleDraft(e.target.value)}
          onBlur={() => titleDraft !== full.title && update({ title: titleDraft })}
          className="w-full bg-transparent text-lg font-semibold text-white focus:outline-none"
        />

        <div className="text-sm text-white/70 flex items-start gap-2">
          <Clock className="w-3.5 h-3.5 mt-0.5" />
          <div>
            <div>{fmtDate(full.start_at)}</div>
            <div className="text-white/40 text-xs">to {fmtDate(full.end_at)}</div>
            {full.timezone && <div className="text-white/40 text-xs">{full.timezone}</div>}
          </div>
        </div>

        {full.location && (
          <div className="text-sm text-white/70 flex items-center gap-2">
            <MapPin className="w-3.5 h-3.5" /> {full.location}
          </div>
        )}

        {full.conferencing_url && (
          <a href={full.conferencing_url} target="_blank" rel="noreferrer" className="text-sm text-cyan-300 hover:text-cyan-200 flex items-center gap-2">
            <Video className="w-3.5 h-3.5" /> Join meeting
          </a>
        )}

        {full.rrule && (
          <div className="text-xs text-white/50 flex items-center gap-2 bg-white/5 rounded px-2 py-1">
            <Repeat className="w-3 h-3" /> Recurring: <code className="text-cyan-300">{full.rrule}</code>
          </div>
        )}

        {full.description_html && (
          <div className="text-sm text-white/80 prose prose-sm prose-invert max-w-none"
            dangerouslySetInnerHTML={{ __html: full.description_html }} />
        )}

        <div className="grid grid-cols-2 gap-2 text-xs">
          <div>
            <label className="text-white/40 uppercase">Status</label>
            <select value={full.status} onChange={(e) => update({ status: e.target.value })} className="w-full mt-1 px-2 py-1 bg-white/5 border border-white/10 rounded text-white">
              {['confirmed','tentative','cancelled'].map((s) => <option key={s} value={s} className="bg-black">{s}</option>)}
            </select>
          </div>
          <div>
            <label className="text-white/40 uppercase">Visibility</label>
            <select value={full.visibility} onChange={(e) => update({ visibility: e.target.value })} className="w-full mt-1 px-2 py-1 bg-white/5 border border-white/10 rounded text-white">
              {['default','public','busy_only','private'].map((v) => <option key={v} value={v} className="bg-black">{v}</option>)}
            </select>
          </div>
        </div>

        {/* Attendees */}
        <div>
          <label className="text-xs text-white/40 uppercase flex items-center gap-1"><Users className="w-3 h-3" /> Attendees</label>
          <div className="mt-1 space-y-1">
            {attendees.map((a) => (
              <div key={`${a.user_id || a.email}`} className="flex items-center gap-2 text-sm bg-white/5 rounded px-2 py-1">
                <span className="flex-1 truncate text-white/80">{a.name || a.user_id || a.email}</span>
                <span className={`text-xs ${
                  a.rsvp === 'accepted' ? 'text-green-400' :
                  a.rsvp === 'declined' ? 'text-red-400' :
                  a.rsvp === 'tentative' ? 'text-amber-300' : 'text-white/40'
                }`}>{a.rsvp}</span>
              </div>
            ))}
            <div className="flex gap-1 mt-2">
              <input value={inviteEmail} onChange={(e) => setInviteEmail(e.target.value)} placeholder="email@…" className="flex-1 px-2 py-1 text-sm bg-white/5 border border-white/10 rounded text-white" />
              <button onClick={invite} disabled={!inviteEmail.trim()} className="px-3 py-1 rounded bg-cyan-500/20 hover:bg-cyan-500/30 text-cyan-200 text-sm disabled:opacity-40">Invite</button>
            </div>
          </div>
          <div className="mt-2 flex gap-1">
            <button onClick={() => rsvp('accepted')} className="flex-1 py-1 text-xs rounded bg-green-500/10 hover:bg-green-500/20 text-green-300 flex items-center justify-center gap-1"><Check className="w-3 h-3" /> Yes</button>
            <button onClick={() => rsvp('tentative')} className="flex-1 py-1 text-xs rounded bg-amber-500/10 hover:bg-amber-500/20 text-amber-300">Maybe</button>
            <button onClick={() => rsvp('declined')} className="flex-1 py-1 text-xs rounded bg-red-500/10 hover:bg-red-500/20 text-red-300">No</button>
          </div>
        </div>

        {/* Reminders */}
        <div>
          <label className="text-xs text-white/40 uppercase flex items-center gap-1"><Bell className="w-3 h-3" /> Reminders</label>
          <div className="mt-1 space-y-1">
            {reminders.map((r) => (
              <div key={r.id} className="text-xs text-white/60 bg-white/5 rounded px-2 py-1">
                {r.minutes_before} min before · {r.method} {r.fired_at && <span className="text-green-400">fired</span>}
              </div>
            ))}
          </div>
          <div className="mt-1 flex gap-1 flex-wrap">
            {[5, 15, 30, 60, 1440].map((m) => (
              <button key={m} onClick={() => addReminder(m)} className="text-xs px-2 py-0.5 rounded bg-white/5 hover:bg-white/10 text-white/70">
                {m >= 1440 ? `${m / 1440}d` : m >= 60 ? `${m / 60}h` : `${m}m`}
              </button>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}
