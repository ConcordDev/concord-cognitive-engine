'use client';

/**
 * MeetingsWorkspace — Convene-style board-meeting management for the council
 * lens. Covers the 2026 feature-parity backlog: meeting agenda builder +
 * scheduling, timed agenda items, attendance + RSVP, quorum enforcement,
 * document packet / board book, and action-item tracking with carry-forward.
 *
 * Every value here is real user input persisted through the council domain
 * macros (meeting-*, agenda-*, attendee-*, quorum-check, packet-*, action-*).
 * No seed / demo data.
 */

import { useCallback, useEffect, useMemo, useState } from 'react';
import { motion } from 'framer-motion';
import {
  CalendarClock, Plus, X, Trash2, ListChecks, Users, FileBox,
  ArrowUp, ArrowDown, CheckCircle2, AlertTriangle, ShieldCheck,
  Paperclip, ClipboardList, ArrowRightCircle, Loader2, MapPin,
} from 'lucide-react';
import { lensRun } from '@/lib/api/client';
import { ds } from '@/lib/design-system';
import { cn } from '@/lib/utils';

// ---------------------------------------------------------------------------
// Types — mirror the council-domain macro result shapes
// ---------------------------------------------------------------------------

interface AgendaItem {
  id: string;
  topic: string;
  presenter: string;
  durationMin: number;
  order: number;
  status: 'pending' | 'discussed' | 'deferred';
  notes: string;
}

interface Attendee {
  id: string;
  name: string;
  role: string;
  rsvp: 'yes' | 'no' | 'maybe' | 'no_response';
  present: boolean;
}

interface PacketDoc {
  id: string;
  name: string;
  url: string;
  kind: string;
  addedAt: string;
}

interface Meeting {
  id: string;
  title: string;
  scheduledAt: string;
  location: string;
  description: string;
  status: 'scheduled' | 'in_progress' | 'concluded' | 'cancelled';
  quorumThreshold: number;
  agenda: AgendaItem[];
  attendees: Attendee[];
  packet: PacketDoc[];
  createdAt: string;
  updatedAt: string;
}

interface ActionItem {
  id: string;
  description: string;
  owner: string;
  dueDate: string;
  meetingId: string | null;
  status: 'open' | 'done' | 'carried_forward';
  carriedFromMeetingId: string | null;
  createdAt: string;
  updatedAt: string;
}

interface QuorumResult {
  meetingId: string;
  present: number;
  invited: number;
  required: number;
  quorumMet: boolean;
  canTally: boolean;
  message: string;
}

const RSVP_LABEL: Record<Attendee['rsvp'], { label: string; color: string }> = {
  yes: { label: 'Attending', color: 'text-green-400' },
  no: { label: 'Declined', color: 'text-red-400' },
  maybe: { label: 'Tentative', color: 'text-yellow-400' },
  no_response: { label: 'No response', color: 'text-gray-400' },
};

const RSVP_CYCLE: Attendee['rsvp'][] = ['no_response', 'yes', 'maybe', 'no'];

function fmtDateTime(s: string): string {
  if (!s) return '—';
  const d = new Date(s);
  if (Number.isNaN(d.getTime())) return s;
  return d.toLocaleString('en-US', {
    month: 'short', day: 'numeric', year: 'numeric',
    hour: '2-digit', minute: '2-digit',
  });
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export function MeetingsWorkspace() {
  const [meetings, setMeetings] = useState<Meeting[]>([]);
  const [actions, setActions] = useState<ActionItem[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [quorum, setQuorum] = useState<QuorumResult | null>(null);

  const [showCreate, setShowCreate] = useState(false);
  const [form, setForm] = useState({
    title: '', scheduledAt: '', location: '', description: '', quorumThreshold: '3',
  });

  // Inline add-item drafts
  const [agendaDraft, setAgendaDraft] = useState({ topic: '', presenter: '', durationMin: '10' });
  const [attendeeDraft, setAttendeeDraft] = useState({ name: '', role: 'member' });
  const [packetDraft, setPacketDraft] = useState({ name: '', url: '', kind: 'document' });
  const [actionDraft, setActionDraft] = useState({ description: '', owner: '', dueDate: '' });

  const selected = useMemo(
    () => meetings.find((m) => m.id === selectedId) || null,
    [meetings, selectedId],
  );

  const loadMeetings = useCallback(async () => {
    const r = await lensRun('council', 'meeting-list', {});
    if (r.data?.ok && r.data.result) {
      setMeetings((r.data.result as { meetings: Meeting[] }).meetings || []);
    } else if (r.data?.error) {
      setError(r.data.error);
    }
  }, []);

  const loadActions = useCallback(async () => {
    const r = await lensRun('council', 'action-list', {});
    if (r.data?.ok && r.data.result) {
      setActions((r.data.result as { actions: ActionItem[] }).actions || []);
    }
  }, []);

  useEffect(() => {
    (async () => {
      setLoading(true);
      await Promise.all([loadMeetings(), loadActions()]);
      setLoading(false);
    })();
  }, [loadMeetings, loadActions]);

  // Re-fetch quorum whenever the selected meeting's attendance changes.
  useEffect(() => {
    if (!selected) { setQuorum(null); return; }
    let cancelled = false;
    (async () => {
      const r = await lensRun('council', 'quorum-check', { meetingId: selected.id });
      if (!cancelled && r.data?.ok && r.data.result) {
        setQuorum(r.data.result as QuorumResult);
      }
    })();
    return () => { cancelled = true; };
  }, [selected]);

  // --- Mutation helper: run a macro, refresh, surface error ---
  const run = useCallback(async (
    action: string, params: Record<string, unknown>, after?: () => Promise<void>,
  ) => {
    setBusy(true);
    setError(null);
    try {
      const r = await lensRun('council', action, params);
      if (!r.data?.ok) {
        setError(r.data?.error || `${action} failed`);
        return false;
      }
      if (after) await after();
      return true;
    } finally {
      setBusy(false);
    }
  }, []);

  const handleCreate = useCallback(async () => {
    if (!form.title.trim() || !form.scheduledAt.trim()) return;
    const ok = await run('meeting-create', {
      title: form.title.trim(),
      scheduledAt: new Date(form.scheduledAt).toISOString(),
      location: form.location.trim(),
      description: form.description.trim(),
      quorumThreshold: parseInt(form.quorumThreshold, 10) || 0,
    }, loadMeetings);
    if (ok) {
      setShowCreate(false);
      setForm({ title: '', scheduledAt: '', location: '', description: '', quorumThreshold: '3' });
    }
  }, [form, run, loadMeetings]);

  const openActions = useMemo(() => actions.filter((a) => a.status === 'open'), [actions]);

  if (loading) {
    return (
      <div className={cn(ds.panel, 'flex items-center justify-center py-16 gap-2')}>
        <Loader2 className="w-5 h-5 animate-spin text-neon-purple" />
        <span className={ds.textMuted}>Loading meetings…</span>
      </div>
    );
  }

  // ===== Detail view =====
  if (selected) {
    return (
      <div className="space-y-4">
        <button onClick={() => setSelectedId(null)} className={cn(ds.btnGhost, 'mb-1')}>
          <X className="w-4 h-4" /> Back to meetings
        </button>

        {error && (
          <div className="text-xs text-red-400 bg-red-500/10 rounded px-3 py-2">{error}</div>
        )}

        {/* Meeting header */}
        <div className={ds.panel}>
          <div className="flex items-start justify-between gap-3">
            <div className="min-w-0">
              <h2 className={ds.heading2}>{selected.title}</h2>
              <div className="flex flex-wrap items-center gap-3 mt-1 text-xs text-gray-400">
                <span className="flex items-center gap-1">
                  <CalendarClock className="w-3.5 h-3.5" /> {fmtDateTime(selected.scheduledAt)}
                </span>
                {selected.location && (
                  <span className="flex items-center gap-1">
                    <MapPin className="w-3.5 h-3.5" /> {selected.location}
                  </span>
                )}
                <span className="capitalize px-2 py-0.5 rounded-full bg-lattice-elevated">
                  {selected.status.replace('_', ' ')}
                </span>
              </div>
              {selected.description && (
                <p className="text-sm text-gray-300 mt-2">{selected.description}</p>
              )}
            </div>
            <div className="flex items-center gap-1 flex-shrink-0">
              <select
                value={selected.status}
                onChange={(e) => run('meeting-update', { id: selected.id, status: e.target.value }, loadMeetings)}
                className={cn(ds.select, '!w-36 !text-xs')}
              >
                <option value="scheduled">Scheduled</option>
                <option value="in_progress">In progress</option>
                <option value="concluded">Concluded</option>
                <option value="cancelled">Cancelled</option>
              </select>
              <button
                onClick={async () => {
                  const ok = await run('meeting-delete', { id: selected.id }, loadMeetings);
                  if (ok) setSelectedId(null);
                }}
                className="p-2 text-red-400 hover:bg-red-500/20 rounded"
                aria-label="Delete meeting"
              >
                <Trash2 className="w-4 h-4" />
              </button>
            </div>
          </div>
        </div>

        {/* Quorum banner */}
        {quorum && (
          <div className={cn(
            'flex items-center gap-3 rounded-lg px-4 py-3 border',
            quorum.quorumMet
              ? 'bg-green-500/10 border-green-500/30'
              : 'bg-yellow-500/10 border-yellow-500/30',
          )}>
            <ShieldCheck className={cn('w-5 h-5', quorum.quorumMet ? 'text-green-400' : 'text-yellow-400')} />
            <div className="flex-1">
              <p className={cn('text-sm font-medium', quorum.quorumMet ? 'text-green-400' : 'text-yellow-400')}>
                {quorum.message}
              </p>
              <p className="text-xs text-gray-400">
                {quorum.present} present · {quorum.invited} invited · {quorum.required} required
              </p>
            </div>
            <span className={cn(
              'text-xs font-semibold px-2.5 py-1 rounded-full',
              quorum.canTally ? 'bg-green-500/20 text-green-400' : 'bg-red-500/20 text-red-400',
            )}>
              {quorum.canTally ? 'Tally permitted' : 'Tally blocked'}
            </span>
          </div>
        )}

        {/* Agenda builder */}
        <div className={ds.panel}>
          <h3 className={cn(ds.heading3, 'flex items-center gap-2 mb-3')}>
            <ClipboardList className="w-4 h-4 text-neon-cyan" />
            Agenda ({selected.agenda.length})
            <span className="ml-auto text-xs font-normal text-gray-400">
              {selected.agenda.reduce((s, a) => s + a.durationMin, 0)} min total
            </span>
          </h3>
          {selected.agenda.length === 0 && (
            <p className={cn(ds.textMuted, 'py-3 text-center text-sm')}>No agenda items yet.</p>
          )}
          <div className="space-y-2">
            {selected.agenda.map((item, idx) => (
              <div key={item.id} className="flex items-center gap-2 p-2.5 bg-lattice-elevated rounded-lg">
                <span className="w-6 h-6 rounded-full bg-neon-cyan/20 text-neon-cyan flex items-center justify-center text-xs font-mono flex-shrink-0">
                  {idx + 1}
                </span>
                <div className="flex-1 min-w-0">
                  <p className="text-sm text-white truncate">{item.topic}</p>
                  <p className="text-xs text-gray-400">
                    {item.presenter ? `${item.presenter} · ` : ''}{item.durationMin} min
                  </p>
                </div>
                <select
                  value={item.status}
                  onChange={(e) => run('agenda-update', {
                    meetingId: selected.id, itemId: item.id, status: e.target.value,
                  }, loadMeetings)}
                  className={cn(ds.select, '!w-28 !text-xs !py-1')}
                >
                  <option value="pending">Pending</option>
                  <option value="discussed">Discussed</option>
                  <option value="deferred">Deferred</option>
                </select>
                <button
                  disabled={idx === 0 || busy}
                  onClick={() => {
                    const order = selected.agenda.map((a) => a.id);
                    [order[idx - 1], order[idx]] = [order[idx], order[idx - 1]];
                    run('agenda-reorder', { meetingId: selected.id, order }, loadMeetings);
                  }}
                  className="p-1 text-gray-400 hover:text-white disabled:opacity-30"
                  aria-label="Move up"
                >
                  <ArrowUp className="w-3.5 h-3.5" />
                </button>
                <button
                  disabled={idx === selected.agenda.length - 1 || busy}
                  onClick={() => {
                    const order = selected.agenda.map((a) => a.id);
                    [order[idx + 1], order[idx]] = [order[idx], order[idx + 1]];
                    run('agenda-reorder', { meetingId: selected.id, order }, loadMeetings);
                  }}
                  className="p-1 text-gray-400 hover:text-white disabled:opacity-30"
                  aria-label="Move down"
                >
                  <ArrowDown className="w-3.5 h-3.5" />
                </button>
                <button
                  onClick={() => run('agenda-remove', {
                    meetingId: selected.id, itemId: item.id,
                  }, loadMeetings)}
                  className="p-1 text-red-400 hover:bg-red-500/20 rounded"
                  aria-label="Remove agenda item"
                >
                  <X className="w-3.5 h-3.5" />
                </button>
              </div>
            ))}
          </div>
          <div className="flex gap-2 mt-3 flex-wrap">
            <input
              value={agendaDraft.topic}
              onChange={(e) => setAgendaDraft((d) => ({ ...d, topic: e.target.value }))}
              placeholder="Agenda topic…"
              className={cn(ds.input, 'flex-1 !min-w-[160px]')}
            />
            <input
              value={agendaDraft.presenter}
              onChange={(e) => setAgendaDraft((d) => ({ ...d, presenter: e.target.value }))}
              placeholder="Presenter"
              className={cn(ds.input, '!w-32')}
            />
            <input
              type="number"
              min={1}
              value={agendaDraft.durationMin}
              onChange={(e) => setAgendaDraft((d) => ({ ...d, durationMin: e.target.value }))}
              placeholder="min"
              className={cn(ds.input, '!w-20')}
            />
            <button
              disabled={!agendaDraft.topic.trim() || busy}
              onClick={async () => {
                const ok = await run('agenda-add', {
                  meetingId: selected.id,
                  topic: agendaDraft.topic.trim(),
                  presenter: agendaDraft.presenter.trim(),
                  durationMin: parseInt(agendaDraft.durationMin, 10) || 10,
                }, loadMeetings);
                if (ok) setAgendaDraft({ topic: '', presenter: '', durationMin: '10' });
              }}
              className={ds.btnPrimary}
            >
              <Plus className="w-4 h-4" /> Add
            </button>
          </div>
        </div>

        {/* Attendance + RSVP */}
        <div className={ds.panel}>
          <h3 className={cn(ds.heading3, 'flex items-center gap-2 mb-3')}>
            <Users className="w-4 h-4 text-cyan-400" />
            Attendance ({selected.attendees.filter((a) => a.present).length}/{selected.attendees.length})
          </h3>
          {selected.attendees.length === 0 && (
            <p className={cn(ds.textMuted, 'py-3 text-center text-sm')}>No attendees invited yet.</p>
          )}
          <div className="space-y-1.5">
            {selected.attendees.map((at) => (
              <div key={at.id} className="flex items-center gap-2 p-2 bg-lattice-elevated rounded-lg">
                <button
                  onClick={() => run('attendee-check-in', {
                    meetingId: selected.id, attendeeId: at.id, present: !at.present,
                  }, loadMeetings)}
                  className={cn(
                    'w-5 h-5 rounded border flex items-center justify-center flex-shrink-0',
                    at.present
                      ? 'bg-green-500/30 border-green-500 text-green-400'
                      : 'border-gray-600 text-transparent hover:border-gray-400',
                  )}
                  aria-label={at.present ? 'Mark absent' : 'Mark present'}
                >
                  <CheckCircle2 className="w-3.5 h-3.5" />
                </button>
                <div className="flex-1 min-w-0">
                  <p className="text-sm text-white truncate">{at.name}</p>
                  <p className="text-xs text-gray-400 capitalize">{at.role}</p>
                </div>
                <button
                  onClick={() => {
                    const next = RSVP_CYCLE[(RSVP_CYCLE.indexOf(at.rsvp) + 1) % RSVP_CYCLE.length];
                    run('attendee-rsvp', { meetingId: selected.id, attendeeId: at.id, rsvp: next }, loadMeetings);
                  }}
                  className={cn('text-xs px-2 py-1 rounded-full bg-black/30', RSVP_LABEL[at.rsvp].color)}
                  title="Cycle RSVP"
                >
                  {RSVP_LABEL[at.rsvp].label}
                </button>
                <button
                  onClick={() => run('attendee-remove', {
                    meetingId: selected.id, attendeeId: at.id,
                  }, loadMeetings)}
                  className="p-1 text-red-400 hover:bg-red-500/20 rounded"
                  aria-label="Remove attendee"
                >
                  <X className="w-3.5 h-3.5" />
                </button>
              </div>
            ))}
          </div>
          <div className="flex gap-2 mt-3 flex-wrap">
            <input
              value={attendeeDraft.name}
              onChange={(e) => setAttendeeDraft((d) => ({ ...d, name: e.target.value }))}
              placeholder="Attendee name…"
              className={cn(ds.input, 'flex-1 !min-w-[160px]')}
            />
            <input
              value={attendeeDraft.role}
              onChange={(e) => setAttendeeDraft((d) => ({ ...d, role: e.target.value }))}
              placeholder="Role"
              className={cn(ds.input, '!w-32')}
            />
            <button
              disabled={!attendeeDraft.name.trim() || busy}
              onClick={async () => {
                const ok = await run('attendee-add', {
                  meetingId: selected.id,
                  name: attendeeDraft.name.trim(),
                  role: attendeeDraft.role.trim() || 'member',
                }, loadMeetings);
                if (ok) setAttendeeDraft({ name: '', role: 'member' });
              }}
              className={ds.btnPrimary}
            >
              <Plus className="w-4 h-4" /> Invite
            </button>
          </div>
        </div>

        {/* Document packet / board book */}
        <div className={ds.panel}>
          <h3 className={cn(ds.heading3, 'flex items-center gap-2 mb-3')}>
            <FileBox className="w-4 h-4 text-purple-400" />
            Board Book ({selected.packet.length})
          </h3>
          {selected.packet.length === 0 && (
            <p className={cn(ds.textMuted, 'py-3 text-center text-sm')}>
              No documents attached. Bundle the board book for this meeting.
            </p>
          )}
          <div className="space-y-1.5">
            {selected.packet.map((doc) => (
              <div key={doc.id} className="flex items-center gap-2 p-2 bg-lattice-elevated rounded-lg">
                <Paperclip className="w-3.5 h-3.5 text-purple-400 flex-shrink-0" />
                <div className="flex-1 min-w-0">
                  {doc.url ? (
                    <a
                      href={doc.url}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="text-sm text-neon-cyan hover:underline truncate block"
                    >
                      {doc.name}
                    </a>
                  ) : (
                    <p className="text-sm text-white truncate">{doc.name}</p>
                  )}
                  <p className="text-xs text-gray-400 capitalize">{doc.kind}</p>
                </div>
                <button
                  onClick={() => run('packet-remove', {
                    meetingId: selected.id, documentId: doc.id,
                  }, loadMeetings)}
                  className="p-1 text-red-400 hover:bg-red-500/20 rounded"
                  aria-label="Remove document"
                >
                  <X className="w-3.5 h-3.5" />
                </button>
              </div>
            ))}
          </div>
          <div className="flex gap-2 mt-3 flex-wrap">
            <input
              value={packetDraft.name}
              onChange={(e) => setPacketDraft((d) => ({ ...d, name: e.target.value }))}
              placeholder="Document name…"
              className={cn(ds.input, 'flex-1 !min-w-[140px]')}
            />
            <input
              value={packetDraft.url}
              onChange={(e) => setPacketDraft((d) => ({ ...d, url: e.target.value }))}
              placeholder="URL (optional)"
              className={cn(ds.input, 'flex-1 !min-w-[140px]')}
            />
            <select
              value={packetDraft.kind}
              onChange={(e) => setPacketDraft((d) => ({ ...d, kind: e.target.value }))}
              className={cn(ds.select, '!w-32')}
            >
              <option value="document">Document</option>
              <option value="link">Link</option>
              <option value="proposal">Proposal</option>
              <option value="report">Report</option>
            </select>
            <button
              disabled={!packetDraft.name.trim() || busy}
              onClick={async () => {
                const ok = await run('packet-add', {
                  meetingId: selected.id,
                  name: packetDraft.name.trim(),
                  url: packetDraft.url.trim(),
                  kind: packetDraft.kind,
                }, loadMeetings);
                if (ok) setPacketDraft({ name: '', url: '', kind: 'document' });
              }}
              className={ds.btnPrimary}
            >
              <Plus className="w-4 h-4" /> Attach
            </button>
          </div>
        </div>

        {/* Action items for this meeting */}
        <MeetingActions
          meeting={selected}
          actions={actions.filter((a) => a.meetingId === selected.id)}
          meetings={meetings}
          busy={busy}
          draft={actionDraft}
          setDraft={setActionDraft}
          run={run}
          reload={loadActions}
        />
      </div>
    );
  }

  // ===== List view =====
  return (
    <div className="space-y-4">
      {error && (
        <div className="text-xs text-red-400 bg-red-500/10 rounded px-3 py-2">{error}</div>
      )}

      <div className={ds.sectionHeader}>
        <h2 className={cn(ds.heading2, 'flex items-center gap-2')}>
          <CalendarClock className="w-5 h-5 text-neon-purple" />
          Meetings & Agendas
        </h2>
        <button onClick={() => setShowCreate(true)} className={ds.btnPrimary}>
          <Plus className="w-4 h-4" /> Schedule Meeting
        </button>
      </div>

      {/* Open action-item summary */}
      {openActions.length > 0 && (
        <div className={cn(ds.panel, 'flex items-center gap-3')}>
          <ListChecks className="w-5 h-5 text-yellow-400" />
          <span className="text-sm text-gray-300">
            <strong className="text-white">{openActions.length}</strong> open action item
            {openActions.length !== 1 ? 's' : ''} across all meetings
          </span>
          {openActions.some((a) => a.dueDate && a.dueDate < new Date().toISOString().slice(0, 10)) && (
            <span className="ml-auto flex items-center gap-1 text-xs text-red-400">
              <AlertTriangle className="w-3.5 h-3.5" />
              {openActions.filter((a) => a.dueDate && a.dueDate < new Date().toISOString().slice(0, 10)).length} overdue
            </span>
          )}
        </div>
      )}

      {meetings.length === 0 && (
        <div className={cn(ds.panel, 'text-center py-12')}>
          <CalendarClock className="w-10 h-10 mx-auto mb-3 text-gray-600" />
          <p className={ds.textMuted}>No meetings scheduled yet. Schedule one to begin.</p>
        </div>
      )}

      <div className="space-y-2">
        {meetings.map((m, idx) => (
          <motion.div
            key={m.id}
            initial={{ opacity: 0, y: 12 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: idx * 0.04 }}
            onClick={() => setSelectedId(m.id)}
            className={cn(ds.panelHover, 'cursor-pointer')}
          >
            <div className="flex items-center justify-between gap-3">
              <div className="min-w-0">
                <h3 className={cn(ds.heading3, 'truncate')}>{m.title}</h3>
                <div className="flex flex-wrap items-center gap-3 mt-1 text-xs text-gray-400">
                  <span className="flex items-center gap-1">
                    <CalendarClock className="w-3 h-3" /> {fmtDateTime(m.scheduledAt)}
                  </span>
                  {m.location && (
                    <span className="flex items-center gap-1">
                      <MapPin className="w-3 h-3" /> {m.location}
                    </span>
                  )}
                  <span className="flex items-center gap-1">
                    <ClipboardList className="w-3 h-3" /> {m.agenda.length} agenda
                  </span>
                  <span className="flex items-center gap-1">
                    <Users className="w-3 h-3" /> {m.attendees.length} invited
                  </span>
                  <span className="flex items-center gap-1">
                    <FileBox className="w-3 h-3" /> {m.packet.length} docs
                  </span>
                </div>
              </div>
              <span className="capitalize text-xs px-2 py-0.5 rounded-full bg-lattice-elevated text-gray-300 flex-shrink-0">
                {m.status.replace('_', ' ')}
              </span>
            </div>
          </motion.div>
        ))}
      </div>

      {/* Schedule meeting modal */}
      {showCreate && (
        <div className={ds.modalBackdrop} onClick={() => setShowCreate(false)} role="button" tabIndex={0} onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); (e.currentTarget as HTMLElement).click(); } }}>
          <div className={ds.modalContainer}>
            <div className={cn(ds.modalPanel, 'max-w-lg')} onClick={(e) => e.stopPropagation()} role="button" tabIndex={0} onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); (e.currentTarget as HTMLElement).click(); } }}>
              <div className="flex items-center justify-between px-5 py-4 border-b border-lattice-border">
                <h2 className={ds.heading2}>Schedule Meeting</h2>
                <button onClick={() => setShowCreate(false)} className="text-gray-400 hover:text-white" aria-label="Close">
                  <X className="w-5 h-5" />
                </button>
              </div>
              <div className="p-5 space-y-4">
                <div>
                  <label className={ds.label}>Title</label>
                  <input
                    value={form.title}
                    onChange={(e) => setForm((f) => ({ ...f, title: e.target.value }))}
                    placeholder="e.g. Q3 Board Session"
                    className={ds.input}
                  />
                </div>
                <div className={ds.grid2}>
                  <div>
                    <label className={ds.label}>Date & Time</label>
                    <input
                      type="datetime-local"
                      value={form.scheduledAt}
                      onChange={(e) => setForm((f) => ({ ...f, scheduledAt: e.target.value }))}
                      className={ds.input}
                    />
                  </div>
                  <div>
                    <label className={ds.label}>Quorum Threshold</label>
                    <input
                      type="number"
                      min={0}
                      value={form.quorumThreshold}
                      onChange={(e) => setForm((f) => ({ ...f, quorumThreshold: e.target.value }))}
                      className={ds.input}
                    />
                  </div>
                </div>
                <div>
                  <label className={ds.label}>Location</label>
                  <input
                    value={form.location}
                    onChange={(e) => setForm((f) => ({ ...f, location: e.target.value }))}
                    placeholder="e.g. Council Hall / video link"
                    className={ds.input}
                  />
                </div>
                <div>
                  <label className={ds.label}>Description</label>
                  <textarea
                    value={form.description}
                    onChange={(e) => setForm((f) => ({ ...f, description: e.target.value }))}
                    rows={3}
                    placeholder="Purpose and context…"
                    className={ds.textarea}
                  />
                </div>
              </div>
              <div className="flex justify-end gap-3 px-5 py-4 border-t border-lattice-border">
                <button onClick={() => setShowCreate(false)} className={ds.btnGhost}>Cancel</button>
                <button
                  onClick={handleCreate}
                  disabled={!form.title.trim() || !form.scheduledAt.trim() || busy}
                  className={ds.btnPrimary}
                >
                  Schedule
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// MeetingActions — action-item tracking for a single meeting
// ---------------------------------------------------------------------------

interface MeetingActionsProps {
  meeting: Meeting;
  actions: ActionItem[];
  meetings: Meeting[];
  busy: boolean;
  draft: { description: string; owner: string; dueDate: string };
  setDraft: (d: { description: string; owner: string; dueDate: string }) => void;
  run: (action: string, params: Record<string, unknown>, after?: () => Promise<void>) => Promise<boolean>;
  reload: () => Promise<void>;
}

function MeetingActions({ meeting, actions, meetings, busy, draft, setDraft, run, reload }: MeetingActionsProps) {
  const today = new Date().toISOString().slice(0, 10);
  const otherMeetings = meetings.filter((m) => m.id !== meeting.id);

  return (
    <div className={ds.panel}>
      <h3 className={cn(ds.heading3, 'flex items-center gap-2 mb-3')}>
        <ListChecks className="w-4 h-4 text-yellow-400" />
        Action Items ({actions.length})
      </h3>
      {actions.length === 0 && (
        <p className={cn(ds.textMuted, 'py-3 text-center text-sm')}>
          No action items assigned from this meeting.
        </p>
      )}
      <div className="space-y-1.5">
        {actions.map((a) => {
          const overdue = a.status === 'open' && a.dueDate && a.dueDate < today;
          return (
            <div key={a.id} className="flex items-center gap-2 p-2.5 bg-lattice-elevated rounded-lg">
              <button
                onClick={() => run('action-update', {
                  id: a.id, status: a.status === 'done' ? 'open' : 'done',
                }, reload)}
                disabled={a.status === 'carried_forward'}
                className={cn(
                  'w-5 h-5 rounded border flex items-center justify-center flex-shrink-0 disabled:opacity-40',
                  a.status === 'done'
                    ? 'bg-green-500/30 border-green-500 text-green-400'
                    : 'border-gray-600 text-transparent hover:border-gray-400',
                )}
                aria-label={a.status === 'done' ? 'Reopen action' : 'Complete action'}
              >
                <CheckCircle2 className="w-3.5 h-3.5" />
              </button>
              <div className="flex-1 min-w-0">
                <p className={cn(
                  'text-sm truncate',
                  a.status === 'done' ? 'text-gray-400 line-through' : 'text-white',
                )}>
                  {a.description}
                </p>
                <p className="text-xs text-gray-400">
                  {a.owner || 'unassigned'}
                  {a.dueDate && (
                    <span className={overdue ? 'text-red-400 ml-1' : 'ml-1'}>
                      · due {a.dueDate}{overdue ? ' (overdue)' : ''}
                    </span>
                  )}
                  {a.status === 'carried_forward' && (
                    <span className="text-purple-400 ml-1">· carried forward</span>
                  )}
                </p>
              </div>
              {a.status === 'open' && otherMeetings.length > 0 && (
                <select
                  defaultValue=""
                  onChange={(e) => {
                    if (e.target.value) {
                      run('action-carry-forward', { id: a.id, targetMeetingId: e.target.value }, reload);
                      e.target.value = '';
                    }
                  }}
                  className={cn(ds.select, '!w-32 !text-xs !py-1')}
                  title="Carry forward to another meeting"
                >
                  <option value="" disabled>Carry to…</option>
                  {otherMeetings.map((m) => (
                    <option key={m.id} value={m.id}>{m.title}</option>
                  ))}
                </select>
              )}
              {a.status === 'open' && otherMeetings.length === 0 && (
                <ArrowRightCircle className="w-4 h-4 text-gray-700" />
              )}
              <button
                onClick={() => run('action-delete', { id: a.id }, reload)}
                className="p-1 text-red-400 hover:bg-red-500/20 rounded"
                aria-label="Delete action"
              >
                <X className="w-3.5 h-3.5" />
              </button>
            </div>
          );
        })}
      </div>
      <div className="flex gap-2 mt-3 flex-wrap">
        <input
          value={draft.description}
          onChange={(e) => setDraft({ ...draft, description: e.target.value })}
          placeholder="Action item…"
          className={cn(ds.input, 'flex-1 !min-w-[160px]')}
        />
        <input
          value={draft.owner}
          onChange={(e) => setDraft({ ...draft, owner: e.target.value })}
          placeholder="Owner"
          className={cn(ds.input, '!w-28')}
        />
        <input
          type="date"
          value={draft.dueDate}
          onChange={(e) => setDraft({ ...draft, dueDate: e.target.value })}
          className={cn(ds.input, '!w-40')}
        />
        <button
          disabled={!draft.description.trim() || busy}
          onClick={async () => {
            const ok = await run('action-create', {
              description: draft.description.trim(),
              owner: draft.owner.trim(),
              dueDate: draft.dueDate,
              meetingId: meeting.id,
            }, reload);
            if (ok) setDraft({ description: '', owner: '', dueDate: '' });
          }}
          className={ds.btnPrimary}
        >
          <Plus className="w-4 h-4" /> Add
        </button>
      </div>
    </div>
  );
}
