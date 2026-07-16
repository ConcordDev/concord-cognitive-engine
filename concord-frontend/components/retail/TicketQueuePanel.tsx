'use client';

/**
 * TicketQueuePanel — the real support-ticket queue that closes retail's
 * second "Genuinely missing, deferred" gap
 * (docs/lens-specs/retail-capability-map.md "Support tickets": "a persisted
 * ticket queue (subject, priority, SLA deadline, assignee, replies).
 * `slaStatus` computes compliance from pasted incidents but no macro
 * creates or lists a ticket."). Backs onto the persisted retail.tickets-*
 * macro family (tickets-list / tickets-upsert / tickets-status-move /
 * tickets-reply-add / tickets-delete) — every number here (SLA deadline,
 * countdown, compliance rate) is server-computed, never client-invented.
 */

import { useEffect, useMemo, useState } from 'react';
import { LifeBuoy, Plus, Trash2, Loader2, RotateCcw, Send, CheckCircle2 } from 'lucide-react';
import { lensRun } from '@/lib/api/client';
import { cn } from '@/lib/utils';

type Priority = 'critical' | 'high' | 'medium' | 'low';
type Status = 'open' | 'in-progress' | 'waiting-on-customer' | 'resolved' | 'closed';
type SlaState = 'healthy' | 'approaching' | 'breached' | 'resolved-on-time' | 'resolved-late' | 'resolved' | 'closed';

interface Reply { author: string; body: string; at: string }
interface Ticket {
  id: string; subject: string; description: string; priority: Priority; status: Status;
  assignee: string; requester: string; contactEmail: string;
  slaTargetMinutes: number; slaDeadline: string;
  statusHistory: Array<{ from: Status | null; to: Status; at: string; note?: string; reopened?: boolean }>;
  replies: Reply[];
  resolvedAt: string | null; resolvedWithinSla: boolean | null; closedAt: string | null;
  createdAt: string; updatedAt: string;
  slaState: SlaState;
}
interface Rollup {
  totalTickets: number; openCount: number; breachedOpenCount: number;
  resolvedCount: number; metCount: number; complianceRate: number;
  byPriority: Record<Priority, { count: number; open: number; breached: number }>;
}

const PRIORITIES: { id: Priority; label: string }[] = [
  { id: 'critical', label: 'Critical' },
  { id: 'high', label: 'High' },
  { id: 'medium', label: 'Medium' },
  { id: 'low', label: 'Low' },
];
const STATUS_FILTERS: { id: 'all' | Status; label: string }[] = [
  { id: 'all', label: 'All' },
  { id: 'open', label: 'Open' },
  { id: 'in-progress', label: 'In progress' },
  { id: 'waiting-on-customer', label: 'Waiting' },
  { id: 'resolved', label: 'Resolved' },
  { id: 'closed', label: 'Closed' },
];
const STATUS_OPTIONS: Status[] = ['open', 'in-progress', 'waiting-on-customer', 'resolved', 'closed'];

const PRIORITY_BADGE: Record<Priority, string> = {
  critical: 'bg-rose-500/15 text-rose-300 border-rose-500/30',
  high: 'bg-amber-500/15 text-amber-300 border-amber-500/30',
  medium: 'bg-sky-500/15 text-sky-300 border-sky-500/30',
  low: 'bg-gray-500/15 text-gray-300 border-gray-500/30',
};

const SLA_BADGE: Record<SlaState, string> = {
  healthy: 'bg-emerald-500/15 text-emerald-300 border-emerald-500/30',
  approaching: 'bg-amber-500/15 text-amber-300 border-amber-500/30',
  breached: 'bg-rose-500/15 text-rose-300 border-rose-500/30',
  'resolved-on-time': 'bg-emerald-500/15 text-emerald-400 border-emerald-500/20',
  'resolved-late': 'bg-rose-500/15 text-rose-400 border-rose-500/20',
  resolved: 'bg-gray-500/15 text-gray-300 border-gray-500/20',
  closed: 'bg-gray-500/10 text-gray-500 border-gray-500/20',
};

function slaLabel(t: Ticket): string {
  if (t.slaState === 'closed') return 'Closed';
  if (t.slaState === 'resolved-on-time') return 'Resolved on time';
  if (t.slaState === 'resolved-late') return 'Resolved late';
  if (t.slaState === 'resolved') return 'Resolved';
  const remainingMs = new Date(t.slaDeadline).getTime() - Date.now();
  const absMin = Math.round(Math.abs(remainingMs) / 60000);
  const hours = Math.floor(absMin / 60);
  const mins = absMin % 60;
  const span = hours > 0 ? `${hours}h ${mins}m` : `${mins}m`;
  return remainingMs < 0 ? `Breached ${span} ago` : `${span} left`;
}

export function TicketQueuePanel() {
  const [tickets, setTickets] = useState<Ticket[]>([]);
  const [rollup, setRollup] = useState<Rollup | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);
  const [statusFilter, setStatusFilter] = useState<'all' | Status>('all');
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [replyDraft, setReplyDraft] = useState({ author: '', body: '' });
  const [form, setForm] = useState({ subject: '', description: '', priority: 'medium' as Priority, assignee: '', requester: '', contactEmail: '' });

  const refresh = async () => {
    setLoading(true);
    setError(null);
    const r = await lensRun({ domain: 'retail', action: 'tickets-list', input: {} });
    if (r.data?.ok) {
      setTickets((r.data.result?.tickets || []) as Ticket[]);
      setRollup((r.data.result?.rollup || null) as Rollup | null);
    } else {
      setError(r.data?.error || 'Could not load the ticket queue.');
    }
    setLoading(false);
  };

  useEffect(() => { void refresh(); }, []);

  const filtered = useMemo(
    () => (statusFilter === 'all' ? tickets : tickets.filter((t) => t.status === statusFilter)),
    [tickets, statusFilter],
  );
  const selected = useMemo(() => tickets.find((t) => t.id === selectedId) || null, [tickets, selectedId]);

  const create = async () => {
    if (!form.subject.trim()) return;
    const input: Record<string, unknown> = {
      subject: form.subject.trim(),
      description: form.description.trim(),
      priority: form.priority,
      assignee: form.assignee.trim(),
      requester: form.requester.trim(),
      contactEmail: form.contactEmail.trim(),
    };
    const r = await lensRun({ domain: 'retail', action: 'tickets-upsert', input });
    if (r.data?.ok) {
      setForm({ subject: '', description: '', priority: 'medium', assignee: '', requester: '', contactEmail: '' });
      setCreating(false);
      await refresh();
    } else {
      setError(r.data?.error || 'Could not create the ticket.');
    }
  };

  const moveStatus = async (ticketId: string, status: Status, reopen = false) => {
    setBusyId(ticketId);
    const r = await lensRun({ domain: 'retail', action: 'tickets-status-move', input: { id: ticketId, status, reopen: reopen || undefined } });
    setBusyId(null);
    if (r.data?.ok) await refresh();
    else setError(r.data?.error || 'Could not update that ticket.');
  };

  const sendReply = async () => {
    if (!selected || !replyDraft.author.trim() || !replyDraft.body.trim()) return;
    setBusyId(selected.id);
    const r = await lensRun({ domain: 'retail', action: 'tickets-reply-add', input: { id: selected.id, author: replyDraft.author.trim(), body: replyDraft.body.trim() } });
    setBusyId(null);
    if (r.data?.ok) {
      setReplyDraft({ author: replyDraft.author, body: '' });
      await refresh();
    } else {
      setError(r.data?.error || 'Could not send that reply.');
    }
  };

  const remove = async (ticketId: string) => {
    setBusyId(ticketId);
    await lensRun({ domain: 'retail', action: 'tickets-delete', input: { id: ticketId } });
    setBusyId(null);
    if (selectedId === ticketId) setSelectedId(null);
    await refresh();
  };

  return (
    <div className="bg-[#0d1117] border border-emerald-500/20 rounded-lg overflow-hidden">
      <header className="px-4 py-2 border-b border-white/10 flex items-center gap-2">
        <LifeBuoy className="w-4 h-4 text-emerald-400" />
        <span className="text-xs uppercase font-semibold text-gray-300 tracking-wider">Support tickets</span>
        <span className="ml-auto text-[10px] text-gray-400">{tickets.length} ticket{tickets.length === 1 ? '' : 's'}</span>
        <button type="button" onClick={() => setCreating((v) => !v)} aria-label="New ticket" className="p-1 text-gray-400 hover:text-white">
          <Plus className="w-4 h-4" />
        </button>
      </header>

      {rollup && (
        <div className="px-3 py-2 border-b border-white/10 grid grid-cols-2 sm:grid-cols-4 gap-3">
          <div>
            <div className="text-[10px] uppercase tracking-wider text-gray-400">Open</div>
            <div className="text-sm font-mono tabular-nums text-white">{rollup.openCount}</div>
          </div>
          <div>
            <div className="text-[10px] uppercase tracking-wider text-gray-400">Breached (open)</div>
            <div className={cn('text-sm font-mono tabular-nums', rollup.breachedOpenCount > 0 ? 'text-rose-400' : 'text-white')}>{rollup.breachedOpenCount}</div>
          </div>
          <div>
            <div className="text-[10px] uppercase tracking-wider text-gray-400">SLA compliance</div>
            <div className="text-sm font-mono tabular-nums text-emerald-300">{rollup.complianceRate}%</div>
          </div>
          <div>
            <div className="text-[10px] uppercase tracking-wider text-gray-400">Resolved</div>
            <div className="text-sm font-mono tabular-nums text-gray-300">{rollup.resolvedCount}</div>
          </div>
        </div>
      )}

      {creating && (
        <div className="p-3 border-b border-white/10 grid grid-cols-2 sm:grid-cols-3 gap-2">
          <input value={form.subject} onChange={(e) => setForm({ ...form, subject: e.target.value })} placeholder="Subject" className="col-span-2 px-2 py-1.5 text-xs bg-lattice-deep border border-lattice-border rounded text-white" />
          <select value={form.priority} onChange={(e) => setForm({ ...form, priority: e.target.value as Priority })} aria-label="Priority" className="px-2 py-1.5 text-xs bg-lattice-deep border border-lattice-border rounded text-white">
            {PRIORITIES.map((p) => <option key={p.id} value={p.id}>{p.label}</option>)}
          </select>
          <input value={form.requester} onChange={(e) => setForm({ ...form, requester: e.target.value })} placeholder="Requester" className="px-2 py-1.5 text-xs bg-lattice-deep border border-lattice-border rounded text-white" />
          <input value={form.contactEmail} onChange={(e) => setForm({ ...form, contactEmail: e.target.value })} placeholder="Contact email" className="px-2 py-1.5 text-xs bg-lattice-deep border border-lattice-border rounded text-white" />
          <input value={form.assignee} onChange={(e) => setForm({ ...form, assignee: e.target.value })} placeholder="Assignee" className="px-2 py-1.5 text-xs bg-lattice-deep border border-lattice-border rounded text-white" />
          <textarea value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })} placeholder="Describe the issue" rows={2} className="col-span-2 sm:col-span-3 px-2 py-1.5 text-xs bg-lattice-deep border border-lattice-border rounded text-white" />
          <button type="button" onClick={create} disabled={!form.subject.trim()} className="px-3 py-1.5 text-xs rounded bg-emerald-500 text-black font-bold hover:bg-emerald-400 disabled:opacity-40">Open ticket</button>
        </div>
      )}

      {error && (
        <div role="alert" className="px-3 py-2 border-b border-rose-900/40 bg-rose-950/30 text-[11px] text-rose-300">{error}</div>
      )}

      <nav className="flex items-center gap-1 px-3 py-2 border-b border-white/10 overflow-x-auto">
        {STATUS_FILTERS.map((s) => (
          <button
            key={s.id}
            type="button"
            onClick={() => setStatusFilter(s.id)}
            className={cn(
              'px-2 py-1 rounded text-[10px] uppercase tracking-wider whitespace-nowrap transition',
              statusFilter === s.id ? 'bg-emerald-500/20 text-emerald-300' : 'text-gray-400 hover:text-emerald-300',
            )}
          >
            {s.label}
          </button>
        ))}
      </nav>

      {loading ? (
        <div className="flex items-center justify-center py-8 text-xs text-gray-400"><Loader2 className="w-4 h-4 animate-spin mr-2" /> Loading…</div>
      ) : (
        <div className="flex flex-col md:flex-row">
          <div className="md:w-1/2 border-b md:border-b-0 md:border-r border-white/10 max-h-[28rem] overflow-y-auto">
            {filtered.length === 0 ? (
              <div className="px-3 py-10 text-center text-xs text-gray-400">
                <LifeBuoy className="w-6 h-6 mx-auto mb-2 opacity-30" />No tickets in {statusFilter === 'all' ? 'the queue' : statusFilter}.
              </div>
            ) : (
              <ul className="divide-y divide-white/5">
                {filtered.map((t) => (
                  <li
                    key={t.id}
                    data-testid={`ticket-row-${t.id}`}
                    onClick={() => setSelectedId(t.id)}
                    className={cn('px-3 py-2 cursor-pointer hover:bg-white/[0.03] group', selectedId === t.id && 'bg-emerald-500/[0.06]')}
                  >
                    <div className="flex items-start justify-between gap-2">
                      <p className="text-xs text-white font-medium truncate">{t.subject}</p>
                      <button
                        type="button"
                        onClick={(e) => { e.stopPropagation(); remove(t.id); }}
                        aria-label={`Delete ${t.subject}`}
                        disabled={busyId === t.id}
                        className="opacity-0 group-hover:opacity-100 text-gray-500 hover:text-rose-400 shrink-0"
                      >
                        <Trash2 className="w-3 h-3" />
                      </button>
                    </div>
                    <div className="mt-1 flex items-center gap-1.5 flex-wrap">
                      <span className={cn('text-[9px] uppercase px-1.5 py-0.5 rounded border', PRIORITY_BADGE[t.priority])}>{t.priority}</span>
                      <span className={cn('text-[9px] uppercase px-1.5 py-0.5 rounded border', SLA_BADGE[t.slaState])} data-testid={`sla-badge-${t.id}`}>{slaLabel(t)}</span>
                      {t.assignee && <span className="text-[10px] text-gray-500">{t.assignee}</span>}
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </div>

          <div className="md:w-1/2 p-3 max-h-[28rem] overflow-y-auto">
            {!selected ? (
              <p className="text-[11px] text-gray-500 italic text-center py-8">Select a ticket to view its thread.</p>
            ) : (
              <div className="space-y-3">
                <div>
                  <p className="text-sm text-white font-medium">{selected.subject}</p>
                  <div className="mt-1 flex items-center gap-1.5 flex-wrap text-[10px] text-gray-400">
                    <span className={cn('uppercase px-1.5 py-0.5 rounded border', PRIORITY_BADGE[selected.priority])}>{selected.priority}</span>
                    <span className={cn('uppercase px-1.5 py-0.5 rounded border', SLA_BADGE[selected.slaState])}>{slaLabel(selected)}</span>
                    {selected.requester && <span>{selected.requester}{selected.contactEmail ? ` · ${selected.contactEmail}` : ''}</span>}
                  </div>
                  {selected.description && <p className="mt-2 text-[11px] text-gray-300 whitespace-pre-wrap">{selected.description}</p>}
                </div>

                <div className="flex items-center gap-2">
                  {selected.status !== 'closed' ? (
                    <>
                      <select
                        value={selected.status}
                        onChange={(e) => moveStatus(selected.id, e.target.value as Status)}
                        disabled={busyId === selected.id}
                        aria-label={`Move ${selected.subject} to status`}
                        className="text-[10px] bg-lattice-deep border border-lattice-border rounded px-1.5 py-1 text-gray-300"
                      >
                        {STATUS_OPTIONS.map((st) => <option key={st} value={st}>{st}</option>)}
                      </select>
                      {selected.status !== 'resolved' && (
                        <button
                          type="button"
                          onClick={() => moveStatus(selected.id, 'resolved')}
                          disabled={busyId === selected.id}
                          className="inline-flex items-center gap-1 px-2 py-1 text-[10px] rounded bg-emerald-500/15 text-emerald-300 border border-emerald-500/30 hover:bg-emerald-500/25"
                        >
                          <CheckCircle2 className="w-3 h-3" /> Resolve
                        </button>
                      )}
                    </>
                  ) : (
                    <button
                      type="button"
                      onClick={() => moveStatus(selected.id, 'open', true)}
                      disabled={busyId === selected.id}
                      className="inline-flex items-center gap-1 px-2 py-1 text-[10px] rounded bg-gray-500/15 text-gray-300 border border-gray-500/30 hover:text-emerald-300"
                    >
                      <RotateCcw className="w-3 h-3" /> Reopen
                    </button>
                  )}
                </div>

                <div>
                  <div className="text-[10px] uppercase tracking-wider text-gray-500 mb-1">Replies ({selected.replies.length})</div>
                  <div className="space-y-1.5">
                    {selected.replies.length === 0 && <p className="text-[10px] text-gray-600 italic">No replies yet.</p>}
                    {selected.replies.map((r, i) => (
                      <div key={i} className="bg-[#131820] border border-white/10 rounded px-2 py-1.5">
                        <div className="flex items-center justify-between text-[10px] text-gray-500">
                          <span className="text-gray-300 font-medium">{r.author}</span>
                          <span>{new Date(r.at).toLocaleString()}</span>
                        </div>
                        <p className="text-[11px] text-gray-300 mt-0.5 whitespace-pre-wrap">{r.body}</p>
                      </div>
                    ))}
                  </div>
                </div>

                <div className="grid grid-cols-3 gap-1.5">
                  <input
                    value={replyDraft.author}
                    onChange={(e) => setReplyDraft({ ...replyDraft, author: e.target.value })}
                    placeholder="Your name"
                    className="px-2 py-1.5 text-xs bg-lattice-deep border border-lattice-border rounded text-white"
                  />
                  <input
                    value={replyDraft.body}
                    onChange={(e) => setReplyDraft({ ...replyDraft, body: e.target.value })}
                    placeholder="Write a reply…"
                    className="col-span-2 px-2 py-1.5 text-xs bg-lattice-deep border border-lattice-border rounded text-white"
                  />
                  <button
                    type="button"
                    onClick={sendReply}
                    disabled={!replyDraft.author.trim() || !replyDraft.body.trim() || busyId === selected.id}
                    className="col-span-3 inline-flex items-center justify-center gap-1 px-3 py-1.5 text-xs rounded bg-emerald-500 text-black font-bold hover:bg-emerald-400 disabled:opacity-40"
                  >
                    <Send className="w-3 h-3" /> Send reply
                  </button>
                </div>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

export default TicketQueuePanel;
