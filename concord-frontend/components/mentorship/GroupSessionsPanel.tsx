'use client';

/**
 * GroupSessionsPanel — many-mentees, one-mentor sessions. Sibling surface to
 * MentorshipSessionsPanel's 1:1 booking flow, but backed by a SEPARATE
 * backend entity: `mentorship` macros group-session-create / -list / -join /
 * -leave / -update (server/domains/mentorship.js). A group session is a
 * genuinely different shape from a 1:1 session (a `capacity` + dynamic
 * `attendees[]` roster, not a two-party mirror), so this is its own panel
 * rather than a variant of MentorshipSessionsPanel.
 *
 * Discovery note (judgment call, documented per the task): `group-session-list`
 * only returns sessions the CALLER is already involved with (as host or
 * attendee) — it does not broadcast every open session platform-wide, the
 * same privacy posture the 1:1 flow already has (session-list is per-user
 * scoped, and session-book's own form requires the caller to already know
 * the partner's raw user ID — there's no built-in mentor search there
 * either). So joining a session you don't yet know about works the same
 * way: the host shares the Session ID (e.g. via the existing Messages tab,
 * or any other channel) and the mentee pastes it into "Join a session"
 * below. Every hosted session's detail view surfaces a copy-to-clipboard
 * Session ID specifically so a host can distribute it. This avoids
 * fabricating a "browse all public sessions" affordance the backend
 * doesn't actually support.
 */

import { useCallback, useEffect, useState } from 'react';
import {
  Loader2, Users, UserPlus, LogOut, Copy, Crown, X, Clock, Check, Video, ChevronLeft,
} from 'lucide-react';
import { lensRun } from '@/lib/api/client';
import { useAuth } from '@/hooks/useAuth';
import { cn } from '@/lib/utils';

interface GroupSession {
  id: string;
  hostId: string;
  hostName: string;
  title: string;
  topic: string;
  description: string;
  startAt: string;
  durationMin: number;
  capacity: number;
  videoLink: string;
  agenda: string;
  attendees: string[];
  status: 'scheduled' | 'completed' | 'cancelled';
  notes: string;
  createdAt: string;
}

const STATUS_STYLE: Record<string, string> = {
  scheduled: 'text-neon-cyan bg-neon-cyan/10',
  completed: 'text-neon-green bg-neon-green/10',
  cancelled: 'text-zinc-400 bg-zinc-400/10',
};

const FILTERS = [
  { id: 'all', label: 'All' },
  { id: 'hosting', label: 'Hosting' },
  { id: 'attending', label: 'Attending' },
  { id: 'upcoming', label: 'Upcoming' },
] as const;
type FilterId = (typeof FILTERS)[number]['id'];

export function GroupSessionsPanel() {
  const { user } = useAuth();
  const [sessions, setSessions] = useState<GroupSession[]>([]);
  const [hostingCount, setHostingCount] = useState(0);
  const [attendingCount, setAttendingCount] = useState(0);
  const [filter, setFilter] = useState<FilterId>('all');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const [showCreate, setShowCreate] = useState(false);
  const [form, setForm] = useState({
    title: '', startAt: '', durationMin: '45', capacity: '6', topic: '', description: '', agenda: '', videoLink: '',
  });

  const [joinId, setJoinId] = useState('');
  const [joinError, setJoinError] = useState<string | null>(null);

  const [selected, setSelected] = useState<GroupSession | null>(null);
  const [copyDone, setCopyDone] = useState(false);

  const refresh = useCallback(async () => {
    setLoading(true);
    const r = await lensRun('mentorship', 'group-session-list', filter === 'all' ? {} : { filter });
    if (r.data?.ok === false) { setError(r.data.error || 'Failed to load group sessions.'); }
    else {
      const res = r.data?.result || {};
      setSessions((res as { sessions?: GroupSession[] }).sessions || []);
      setHostingCount((res as { hostingCount?: number }).hostingCount || 0);
      setAttendingCount((res as { attendingCount?: number }).attendingCount || 0);
      setError(null);
    }
    setLoading(false);
  }, [filter]);

  useEffect(() => { void refresh(); }, [refresh]);

  const create = async () => {
    if (!form.title.trim() || !form.startAt) { setError('Title and start time are required.'); return; }
    const capacityNum = Number(form.capacity);
    if (!Number.isFinite(capacityNum) || capacityNum < 2) { setError('Capacity must be a whole number of at least 2.'); return; }
    setBusy(true);
    const r = await lensRun('mentorship', 'group-session-create', {
      title: form.title,
      startAt: new Date(form.startAt).toISOString(),
      durationMin: Number(form.durationMin) || 45,
      capacity: capacityNum,
      topic: form.topic,
      description: form.description,
      agenda: form.agenda,
      videoLink: form.videoLink,
      hostName: user?.username || 'Mentor',
    });
    setBusy(false);
    if (r.data?.ok === false) { setError(r.data.error || 'Create failed.'); return; }
    setShowCreate(false);
    setForm({ title: '', startAt: '', durationMin: '45', capacity: '6', topic: '', description: '', agenda: '', videoLink: '' });
    setError(null);
    void refresh();
  };

  const join = async (sessionId: string) => {
    setBusy(true);
    const r = await lensRun('mentorship', 'group-session-join', { sessionId });
    setBusy(false);
    if (r.data?.ok === false) { setJoinError(r.data.error || 'Join failed.'); return; }
    setJoinError(null);
    setJoinId('');
    void refresh();
  };

  const leave = async (sessionId: string) => {
    setBusy(true);
    const r = await lensRun('mentorship', 'group-session-leave', { sessionId });
    setBusy(false);
    if (r.data?.ok === false) { setError(r.data.error || 'Leave failed.'); return; }
    if (selected?.id === sessionId) setSelected(null);
    void refresh();
  };

  const updateStatus = async (sessionId: string, status: 'completed' | 'cancelled') => {
    setBusy(true);
    const r = await lensRun('mentorship', 'group-session-update', { sessionId, status });
    setBusy(false);
    if (r.data?.ok === false) { setError(r.data.error || 'Update failed.'); return; }
    if (selected?.id === sessionId && r.data?.result) setSelected((r.data.result as { session: GroupSession }).session);
    void refresh();
  };

  const copySessionId = async (id: string) => {
    try {
      await navigator.clipboard.writeText(id);
      setCopyDone(true);
      setTimeout(() => setCopyDone(false), 1500);
    } catch { /* clipboard unavailable — non-fatal */ }
  };

  const isHost = (s: GroupSession) => !!user && s.hostId === user.id;
  const isAttending = (s: GroupSession) => !!user && s.attendees.includes(user.id);

  if (selected) {
    const full = selected.attendees.length >= selected.capacity;
    return (
      <div className="space-y-4">
        <button onClick={() => setSelected(null)} className="flex items-center gap-1 text-sm text-zinc-400 hover:text-white">
          <ChevronLeft className="w-4 h-4" /> Back to group sessions
        </button>
        {error && <p className="text-xs text-red-400">{error}</p>}
        <div className="panel p-4 space-y-2">
          <div className="flex items-center justify-between">
            <h3 className="text-lg font-semibold">{selected.title}</h3>
            <span className={cn('text-xs px-2 py-0.5 rounded', STATUS_STYLE[selected.status])}>{selected.status}</span>
          </div>
          <div className="grid grid-cols-2 gap-2 text-xs text-zinc-400">
            <span className="flex items-center gap-1">
              {isHost(selected) && <Crown className="w-3 h-3 text-amber-400" />} Host: <b className="text-white">{selected.hostName}</b>
            </span>
            <span className="flex items-center gap-1"><Clock className="w-3 h-3" /> {new Date(selected.startAt).toLocaleString()}</span>
            <span>Duration: <b className="text-white">{selected.durationMin} min</b></span>
            <span>Capacity: <b className={cn(full ? 'text-amber-400' : 'text-white')}>{selected.attendees.length}/{selected.capacity} joined</b></span>
          </div>
          <div className="flex-1 h-2 bg-lattice-deep rounded-full overflow-hidden">
            <div
              className={cn('h-full rounded-full', full ? 'bg-amber-400' : 'bg-neon-cyan')}
              style={{ width: `${Math.min(100, Math.round((selected.attendees.length / Math.max(1, selected.capacity)) * 100))}%` }}
            />
          </div>
          {selected.videoLink && (
            <a href={selected.videoLink} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 text-xs text-neon-cyan hover:underline">
              <Video className="w-3.5 h-3.5" /> Join video call
            </a>
          )}
          {selected.agenda && <p className="text-xs text-zinc-300">Agenda: {selected.agenda}</p>}
          {selected.description && <p className="text-xs text-zinc-400">{selected.description}</p>}

          {isHost(selected) && (
            <div className="flex items-center gap-2 pt-1 border-t border-zinc-800 mt-2">
              <button
                onClick={() => copySessionId(selected.id)}
                className="btn-secondary text-xs flex items-center gap-1"
                title="Share this ID so mentees can join"
              >
                {copyDone ? <Check className="w-3 h-3" /> : <Copy className="w-3 h-3" />} {copyDone ? 'Copied' : 'Copy Session ID'}
              </button>
              {selected.status === 'scheduled' && (
                <>
                  <button onClick={() => updateStatus(selected.id, 'completed')} disabled={busy} className="btn-neon green text-xs">
                    <Check className="w-3 h-3 inline" /> Mark complete
                  </button>
                  <button onClick={() => updateStatus(selected.id, 'cancelled')} disabled={busy} className="btn-secondary text-xs">
                    <X className="w-3 h-3 inline" /> Cancel
                  </button>
                </>
              )}
            </div>
          )}
          {isAttending(selected) && (
            <div className="pt-1 border-t border-zinc-800 mt-2">
              <button onClick={() => leave(selected.id)} disabled={busy} className="btn-secondary text-xs flex items-center gap-1">
                <LogOut className="w-3 h-3" /> Leave session
              </button>
            </div>
          )}

          <div className="pt-1">
            <p className="text-[10px] text-zinc-500 uppercase tracking-wide mb-1">Attendees ({selected.attendees.length})</p>
            {selected.attendees.length === 0 ? (
              <p className="text-xs text-zinc-400">No one has joined yet.</p>
            ) : (
              <ul className="text-xs text-zinc-300 space-y-0.5">
                {selected.attendees.map((a) => <li key={a}>{a}</li>)}
              </ul>
            )}
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h3 className="font-semibold flex items-center gap-2"><Users className="w-4 h-4 text-neon-blue" /> Group Sessions</h3>
        <button onClick={() => setShowCreate(!showCreate)} className="btn-neon text-sm">
          {showCreate ? <X className="w-4 h-4 inline" /> : <UserPlus className="w-4 h-4 inline" />} {showCreate ? 'Cancel' : 'Host a group session'}
        </button>
      </div>

      {error && <p className="text-xs text-red-400">{error}</p>}

      <div className="grid grid-cols-2 gap-3">
        <div className="lens-card text-center">
          <p className="text-xl font-bold text-neon-blue">{hostingCount}</p>
          <p className="text-xs text-zinc-400">Hosting</p>
        </div>
        <div className="lens-card text-center">
          <p className="text-xl font-bold text-neon-cyan">{attendingCount}</p>
          <p className="text-xs text-zinc-400">Attending</p>
        </div>
      </div>

      {showCreate && (
        <div className="panel p-4 space-y-2">
          <h4 className="font-semibold text-sm">Host a group session</h4>
          <input value={form.title} onChange={(e) => setForm((p) => ({ ...p, title: e.target.value }))} placeholder="Session title *" className="input-lattice w-full" />
          <div className="grid grid-cols-3 gap-2">
            <input type="datetime-local" value={form.startAt} onChange={(e) => setForm((p) => ({ ...p, startAt: e.target.value }))} className="input-lattice col-span-2" />
            <input type="number" min={2} value={form.capacity} onChange={(e) => setForm((p) => ({ ...p, capacity: e.target.value }))} placeholder="Capacity *" className="input-lattice" />
          </div>
          <div className="grid grid-cols-2 gap-2">
            <input type="number" min={15} value={form.durationMin} onChange={(e) => setForm((p) => ({ ...p, durationMin: e.target.value }))} placeholder="Minutes" className="input-lattice" />
            <input value={form.topic} onChange={(e) => setForm((p) => ({ ...p, topic: e.target.value }))} placeholder="Topic" className="input-lattice" />
          </div>
          <input value={form.videoLink} onChange={(e) => setForm((p) => ({ ...p, videoLink: e.target.value }))} placeholder="Video call link" className="input-lattice w-full" />
          <textarea value={form.description} onChange={(e) => setForm((p) => ({ ...p, description: e.target.value }))} placeholder="Description" rows={2} className="input-lattice w-full" />
          <textarea value={form.agenda} onChange={(e) => setForm((p) => ({ ...p, agenda: e.target.value }))} placeholder="Agenda" rows={2} className="input-lattice w-full" />
          <button onClick={create} disabled={busy} className="btn-neon green w-full">
            {busy ? <Loader2 className="w-4 h-4 animate-spin inline" /> : 'Host session'}
          </button>
        </div>
      )}

      <div className="panel p-3 space-y-2">
        <h4 className="font-semibold text-xs text-zinc-300">Join a session</h4>
        <p className="text-[10px] text-zinc-500">Have a Session ID from a mentor? Paste it here to join.</p>
        <div className="flex gap-2">
          <input value={joinId} onChange={(e) => setJoinId(e.target.value)} placeholder="Session ID" className="input-lattice flex-1" />
          <button onClick={() => join(joinId)} disabled={busy || !joinId.trim()} className="btn-secondary text-xs">Join</button>
        </div>
        {joinError && <p className="text-xs text-red-400">{joinError}</p>}
      </div>

      <div className="flex gap-1 bg-lattice-void border border-lattice-border rounded-lg p-1">
        {FILTERS.map((f) => (
          <button key={f.id} onClick={() => setFilter(f.id)}
            className={cn('flex-1 px-3 py-1.5 rounded-md text-xs transition-all',
              filter === f.id ? 'bg-neon-cyan/20 text-neon-cyan' : 'text-zinc-400 hover:text-white')}>
            {f.label}
          </button>
        ))}
      </div>

      {loading ? (
        <div className="flex justify-center py-8"><Loader2 className="w-5 h-5 animate-spin text-zinc-400" /></div>
      ) : sessions.length === 0 ? (
        <p className="text-sm text-zinc-400 text-center py-8">No group sessions yet. Host one, or join with a Session ID.</p>
      ) : (
        <div className="space-y-2">
          {sessions.map((s) => (
            <button key={s.id} onClick={() => setSelected(s)} className="lens-card text-left w-full hover:border-neon-blue transition-colors">
              <div className="flex items-center justify-between">
                <span className="font-medium text-sm flex items-center gap-1.5">
                  {isHost(s) && <Crown className="w-3.5 h-3.5 text-amber-400" />}
                  {s.title}
                </span>
                <span className={cn('text-[10px] px-2 py-0.5 rounded', STATUS_STYLE[s.status])}>{s.status}</span>
              </div>
              <p className="text-xs text-zinc-400">{isHost(s) ? 'You are hosting' : `Hosted by ${s.hostName}`} · {s.attendees.length}/{s.capacity} joined</p>
              <p className="text-[10px] text-zinc-400 flex items-center gap-1">
                <Clock className="w-3 h-3" /> {new Date(s.startAt).toLocaleString()}
              </p>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
