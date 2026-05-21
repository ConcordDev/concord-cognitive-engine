'use client';

/**
 * MentorshipSessionsPanel — session scheduling with calendar/reminders,
 * video links, per-meeting notes & action items. All data from `mentorship`
 * macros: session-book, session-list, session-update, session-note-save.
 */

import { useCallback, useEffect, useState } from 'react';
import {
  Loader2, CalendarPlus, Video, Clock, Check, X, ChevronLeft,
  CheckSquare, Square, Star, Bell,
} from 'lucide-react';
import { lensRun } from '@/lib/api/client';
import { TimelineView, type TimelineEvent } from '@/components/viz';
import { cn } from '@/lib/utils';

interface ActionItem { id: string; text: string; done: boolean; createdAt: string }
interface MentorSession {
  id: string;
  ownerId: string;
  partnerId: string;
  partnerName: string;
  title: string;
  startAt: string;
  durationMin: number;
  videoLink: string;
  agenda: string;
  status: 'scheduled' | 'completed' | 'cancelled';
  notes: string;
  actionItems: ActionItem[];
  rating: number;
}

const STATUS_STYLE: Record<string, string> = {
  scheduled: 'text-neon-cyan bg-neon-cyan/10',
  completed: 'text-neon-green bg-neon-green/10',
  cancelled: 'text-zinc-400 bg-zinc-400/10',
};

export function MentorshipSessionsPanel() {
  const [sessions, setSessions] = useState<MentorSession[]>([]);
  const [reminders, setReminders] = useState<MentorSession[]>([]);
  const [filter, setFilter] = useState<'all' | 'upcoming' | 'past'>('all');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const [showBook, setShowBook] = useState(false);
  const [bookForm, setBookForm] = useState({
    partnerId: '', partnerName: '', title: '', startAt: '', durationMin: '45', videoLink: '', agenda: '',
  });

  const [selected, setSelected] = useState<MentorSession | null>(null);
  const [noteDraft, setNoteDraft] = useState('');
  const [itemDraft, setItemDraft] = useState('');

  const refresh = useCallback(async () => {
    setLoading(true);
    const r = await lensRun('mentorship', 'session-list', filter === 'all' ? {} : { filter });
    if (r.data?.ok === false) { setError(r.data.error || 'Failed to load sessions.'); }
    else {
      setSessions(r.data?.result?.sessions || []);
      setReminders(r.data?.result?.reminders || []);
      setError(null);
    }
    setLoading(false);
  }, [filter]);

  useEffect(() => { void refresh(); }, [refresh]);

  const book = async () => {
    if (!bookForm.partnerId.trim() || !bookForm.startAt) { setError('Partner ID and start time are required.'); return; }
    setBusy(true);
    const r = await lensRun('mentorship', 'session-book', {
      partnerId: bookForm.partnerId,
      partnerName: bookForm.partnerName || 'Partner',
      title: bookForm.title || 'Mentoring session',
      startAt: new Date(bookForm.startAt).toISOString(),
      durationMin: Number(bookForm.durationMin) || 45,
      videoLink: bookForm.videoLink,
      agenda: bookForm.agenda,
    });
    setBusy(false);
    if (r.data?.ok === false) { setError(r.data.error || 'Booking failed.'); return; }
    setShowBook(false);
    setBookForm({ partnerId: '', partnerName: '', title: '', startAt: '', durationMin: '45', videoLink: '', agenda: '' });
    void refresh();
  };

  const updateStatus = async (id: string, status: 'completed' | 'cancelled', rating?: number) => {
    setBusy(true);
    const r = await lensRun('mentorship', 'session-update', { sessionId: id, status, ...(rating != null ? { rating } : {}) });
    setBusy(false);
    if (r.data?.ok === false) { setError(r.data.error || 'Update failed.'); return; }
    if (selected?.id === id && r.data?.result?.session) setSelected(r.data.result.session as MentorSession);
    void refresh();
  };

  const saveNote = async () => {
    if (!selected) return;
    setBusy(true);
    const r = await lensRun('mentorship', 'session-note-save', { sessionId: selected.id, notes: noteDraft });
    setBusy(false);
    if (r.data?.ok === false) { setError(r.data.error || 'Save failed.'); return; }
    if (r.data?.result?.session) setSelected(r.data.result.session as MentorSession);
    void refresh();
  };

  const addItem = async () => {
    if (!selected || !itemDraft.trim()) return;
    setBusy(true);
    const r = await lensRun('mentorship', 'session-note-save', { sessionId: selected.id, actionItem: itemDraft });
    setBusy(false);
    if (r.data?.ok === false) { setError(r.data.error || 'Save failed.'); return; }
    if (r.data?.result?.session) setSelected(r.data.result.session as MentorSession);
    setItemDraft('');
    void refresh();
  };

  const toggleItem = async (itemId: string) => {
    if (!selected) return;
    const r = await lensRun('mentorship', 'session-note-save', { sessionId: selected.id, toggleItemId: itemId });
    if (r.data?.ok === false) { setError(r.data.error || 'Toggle failed.'); return; }
    if (r.data?.result?.session) setSelected(r.data.result.session as MentorSession);
    void refresh();
  };

  const timeline: TimelineEvent[] = sessions.map((s) => ({
    id: s.id,
    label: s.title,
    time: s.startAt,
    detail: `${s.partnerName} · ${s.durationMin} min · ${s.status}`,
    tone: s.status === 'completed' ? 'good' : s.status === 'cancelled' ? 'bad' : 'info',
  }));

  if (selected) {
    const openItems = selected.actionItems.filter((i) => !i.done).length;
    return (
      <div className="space-y-4">
        <button onClick={() => setSelected(null)} className="flex items-center gap-1 text-sm text-zinc-400 hover:text-white">
          <ChevronLeft className="w-4 h-4" /> Back to sessions
        </button>
        {error && <p className="text-xs text-red-400">{error}</p>}
        <div className="panel p-4 space-y-2">
          <div className="flex items-center justify-between">
            <h3 className="text-lg font-semibold">{selected.title}</h3>
            <span className={cn('text-xs px-2 py-0.5 rounded', STATUS_STYLE[selected.status])}>{selected.status}</span>
          </div>
          <div className="grid grid-cols-2 gap-2 text-xs text-zinc-400">
            <span>With: <b className="text-white">{selected.partnerName}</b></span>
            <span>Duration: <b className="text-white">{selected.durationMin} min</b></span>
            <span className="flex items-center gap-1"><Clock className="w-3 h-3" /> {new Date(selected.startAt).toLocaleString()}</span>
            {selected.rating > 0 && <span className="flex items-center gap-1"><Star className="w-3 h-3 text-amber-400" /> {selected.rating}/5</span>}
          </div>
          {selected.videoLink && (
            <a href={selected.videoLink} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 text-xs text-neon-cyan hover:underline">
              <Video className="w-3.5 h-3.5" /> Join video call
            </a>
          )}
          {selected.agenda && <p className="text-xs text-zinc-300">Agenda: {selected.agenda}</p>}
          {selected.status === 'scheduled' && (
            <div className="flex gap-2 pt-1">
              <button onClick={() => updateStatus(selected.id, 'completed', 5)} disabled={busy} className="btn-neon green text-xs flex-1">
                <Check className="w-3 h-3 inline" /> Mark complete
              </button>
              <button onClick={() => updateStatus(selected.id, 'cancelled')} disabled={busy} className="btn-secondary text-xs flex-1">
                <X className="w-3 h-3 inline" /> Cancel
              </button>
            </div>
          )}
        </div>

        {/* Notes */}
        <div className="panel p-4 space-y-2">
          <h4 className="font-semibold text-sm">Session notes</h4>
          <textarea
            value={noteDraft || selected.notes}
            onChange={(e) => setNoteDraft(e.target.value)}
            placeholder="Capture what was discussed..."
            rows={4}
            className="input-lattice w-full"
          />
          <button onClick={saveNote} disabled={busy} className="btn-secondary text-xs">
            {busy ? <Loader2 className="w-3 h-3 animate-spin inline" /> : 'Save notes'}
          </button>
        </div>

        {/* Action items */}
        <div className="panel p-4 space-y-2">
          <h4 className="font-semibold text-sm flex items-center gap-2">
            <CheckSquare className="w-4 h-4 text-neon-blue" /> Action items
            <span className="text-[10px] text-zinc-500">{openItems} open</span>
          </h4>
          {selected.actionItems.length === 0 ? (
            <p className="text-xs text-zinc-500">No action items yet.</p>
          ) : selected.actionItems.map((it) => (
            <button key={it.id} onClick={() => toggleItem(it.id)} className="flex items-center gap-2 text-sm w-full text-left hover:text-white">
              {it.done ? <CheckSquare className="w-4 h-4 text-neon-green" /> : <Square className="w-4 h-4 text-zinc-500" />}
              <span className={cn(it.done && 'line-through text-zinc-500')}>{it.text}</span>
            </button>
          ))}
          <div className="flex gap-2">
            <input value={itemDraft} onChange={(e) => setItemDraft(e.target.value)} onKeyDown={(e) => { if (e.key === 'Enter') addItem(); }} placeholder="New action item..." className="input-lattice flex-1" />
            <button onClick={addItem} disabled={busy || !itemDraft.trim()} className="btn-secondary text-xs">Add</button>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h3 className="font-semibold flex items-center gap-2"><CalendarPlus className="w-4 h-4 text-neon-cyan" /> Sessions</h3>
        <button onClick={() => setShowBook(!showBook)} className="btn-neon text-sm">
          {showBook ? <X className="w-4 h-4 inline" /> : <CalendarPlus className="w-4 h-4 inline" />} {showBook ? 'Cancel' : 'Book session'}
        </button>
      </div>

      {error && <p className="text-xs text-red-400">{error}</p>}

      {reminders.length > 0 && (
        <div className="panel p-3 border-amber-400/30 bg-amber-400/5">
          <p className="text-xs font-semibold text-amber-400 flex items-center gap-1.5 mb-1">
            <Bell className="w-3.5 h-3.5" /> Reminders — {reminders.length} session(s) within 24h
          </p>
          {reminders.map((s) => (
            <p key={s.id} className="text-xs text-zinc-300">{s.title} with {s.partnerName} — {new Date(s.startAt).toLocaleString()}</p>
          ))}
        </div>
      )}

      {showBook && (
        <div className="panel p-4 space-y-2">
          <h4 className="font-semibold text-sm">Schedule a session</h4>
          <div className="grid grid-cols-2 gap-2">
            <input value={bookForm.partnerId} onChange={(e) => setBookForm((p) => ({ ...p, partnerId: e.target.value }))} placeholder="Partner user ID *" className="input-lattice" />
            <input value={bookForm.partnerName} onChange={(e) => setBookForm((p) => ({ ...p, partnerName: e.target.value }))} placeholder="Partner name" className="input-lattice" />
          </div>
          <input value={bookForm.title} onChange={(e) => setBookForm((p) => ({ ...p, title: e.target.value }))} placeholder="Session title" className="input-lattice w-full" />
          <div className="grid grid-cols-2 gap-2">
            <input type="datetime-local" value={bookForm.startAt} onChange={(e) => setBookForm((p) => ({ ...p, startAt: e.target.value }))} className="input-lattice" />
            <input type="number" value={bookForm.durationMin} onChange={(e) => setBookForm((p) => ({ ...p, durationMin: e.target.value }))} placeholder="Minutes" className="input-lattice" />
          </div>
          <input value={bookForm.videoLink} onChange={(e) => setBookForm((p) => ({ ...p, videoLink: e.target.value }))} placeholder="Video call link" className="input-lattice w-full" />
          <textarea value={bookForm.agenda} onChange={(e) => setBookForm((p) => ({ ...p, agenda: e.target.value }))} placeholder="Agenda" rows={2} className="input-lattice w-full" />
          <button onClick={book} disabled={busy} className="btn-neon green w-full">
            {busy ? <Loader2 className="w-4 h-4 animate-spin inline" /> : 'Book session'}
          </button>
        </div>
      )}

      <div className="flex gap-1 bg-lattice-void border border-lattice-border rounded-lg p-1">
        {(['all', 'upcoming', 'past'] as const).map((f) => (
          <button key={f} onClick={() => setFilter(f)}
            className={cn('flex-1 px-3 py-1.5 rounded-md text-xs capitalize transition-all',
              filter === f ? 'bg-neon-cyan/20 text-neon-cyan' : 'text-zinc-400 hover:text-white')}>
            {f}
          </button>
        ))}
      </div>

      {loading ? (
        <div className="flex justify-center py-8"><Loader2 className="w-5 h-5 animate-spin text-zinc-500" /></div>
      ) : sessions.length === 0 ? (
        <p className="text-sm text-zinc-500 text-center py-8">No sessions. Book one to get started.</p>
      ) : (
        <>
          <div className="space-y-2">
            {sessions.map((s) => (
              <button key={s.id} onClick={() => { setSelected(s); setNoteDraft(''); }} className="lens-card text-left w-full hover:border-neon-cyan transition-colors">
                <div className="flex items-center justify-between">
                  <span className="font-medium text-sm">{s.title}</span>
                  <span className={cn('text-[10px] px-2 py-0.5 rounded', STATUS_STYLE[s.status])}>{s.status}</span>
                </div>
                <p className="text-xs text-zinc-400">{s.partnerName} · {s.durationMin} min</p>
                <p className="text-[10px] text-zinc-500 flex items-center gap-1">
                  <Clock className="w-3 h-3" /> {new Date(s.startAt).toLocaleString()}
                  {s.actionItems.length > 0 && <span className="ml-2">· {s.actionItems.filter((i) => !i.done).length} open items</span>}
                </p>
              </button>
            ))}
          </div>
          <div className="panel p-4">
            <h4 className="font-semibold text-sm mb-2">Session timeline</h4>
            <TimelineView events={timeline} onSelect={(e) => {
              const s = sessions.find((x) => x.id === e.id);
              if (s) { setSelected(s); setNoteDraft(''); }
            }} />
          </div>
        </>
      )}
    </div>
  );
}
