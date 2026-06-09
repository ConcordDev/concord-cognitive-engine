'use client';

/**
 * PjCollabPanel — the collaboration surface for a project: live presence,
 * a notification inbox, GitHub/Slack/CI integrations, the triage inbox
 * workflow, SLA escalation policies and a keyboard command bar.
 *
 * Every value here is real user input or computed from real backend state.
 * No seed/demo data — empty states say "no data yet".
 */

import { useCallback, useEffect, useRef, useState } from 'react';
import {
  Loader2, Plus, Trash2, Radio, Bell, Plug, Inbox, Timer, Command,
  Github, MessageSquare, CheckCircle2, XCircle, ArrowUpRight, RefreshCw,
} from 'lucide-react';
import { lensRun } from '@/lib/api/client';
import { cn } from '@/lib/utils';

interface Collaborator {
  id: string; collaborator: string; cursorX: number; cursorY: number;
  viewing: string; editingTaskId: string | null; color: string; lastSeen: string;
}
interface Notification {
  id: string; kind: string; title: string; detail: string | null;
  taskId: string | null; read: boolean; createdAt: string;
}
interface Integration {
  id: string; kind: string; target: string; enabled: boolean;
  linkCount: number; updatedAt: string;
}
interface TriageTask {
  id: string; ref: string; title: string; type: string;
  triageSource: string; createdAt: string;
}
interface SlaPolicy {
  id: string; priority: string; responseDays: number; escalateTo: string;
}
interface SlaResult {
  breached: { id: string; ref: string; title: string; basis: string; overdueDays: number }[];
  atRisk: { id: string; ref: string; title: string; basis: string; hoursLeft: number }[];
  escalated: number; breachedCount: number; atRiskCount: number;
}
interface CmdResult {
  results: { kind: string; id: string; label: string; sub: string; status?: string }[];
  commands: { id: string; label: string; action: string }[];
}
interface Member { id: string; name: string }

const INTEGRATION_KINDS = ['github', 'slack', 'ci'];
const PRIORITIES = ['low', 'medium', 'high', 'urgent'];
const STATUSES = ['backlog', 'todo', 'in_progress', 'in_review', 'done'];

export function PjCollabPanel({ projectId, onChange }: { projectId: string; onChange: () => void }) {
  const [presence, setPresence] = useState<Collaborator[]>([]);
  const [notifications, setNotifications] = useState<Notification[]>([]);
  const [unread, setUnread] = useState(0);
  const [integrations, setIntegrations] = useState<Integration[]>([]);
  const [triage, setTriage] = useState<TriageTask[]>([]);
  const [policies, setPolicies] = useState<SlaPolicy[]>([]);
  const [members, setMembers] = useState<Member[]>([]);
  const [loading, setLoading] = useState(true);
  const [slaResult, setSlaResult] = useState<SlaResult | null>(null);
  const [slaRunning, setSlaRunning] = useState(false);

  const [itgForm, setItgForm] = useState({ kind: 'github', target: '' });
  const [triageForm, setTriageForm] = useState({ title: '', description: '', type: 'bug' });
  const [slaForm, setSlaForm] = useState({ priority: 'high', responseDays: '3', escalateTo: 'urgent' });

  const [cmdOpen, setCmdOpen] = useState(false);
  const [cmdQuery, setCmdQuery] = useState('');
  const [cmdResult, setCmdResult] = useState<CmdResult | null>(null);
  const cmdInputRef = useRef<HTMLInputElement>(null);

  const refresh = useCallback(async () => {
    setLoading(true);
    const [p, n, i, tq, sp, m] = await Promise.all([
      lensRun('projects', 'presence-list', { projectId }),
      lensRun('projects', 'notifications-list', {}),
      lensRun('projects', 'integration-list', { projectId }),
      lensRun('projects', 'triage-queue', { projectId }),
      lensRun('projects', 'sla-policy-list', { projectId }),
      lensRun('projects', 'member-list', { projectId }),
    ]);
    setPresence(p.data?.result?.collaborators || []);
    setNotifications(n.data?.result?.notifications || []);
    setUnread(n.data?.result?.unread || 0);
    setIntegrations(i.data?.result?.integrations || []);
    setTriage(tq.data?.result?.queue || []);
    setPolicies(sp.data?.result?.policies || []);
    setMembers(m.data?.result?.members || []);
    setLoading(false);
  }, [projectId]);

  useEffect(() => { void refresh(); }, [refresh]);

  // Heartbeat: ping our own presence + poll collaborators every 15s so the
  // live indicator reflects who is in the project right now.
  useEffect(() => {
    if (!projectId) return;
    let stopped = false;
    const beat = async () => {
      await lensRun('projects', 'presence-ping', { projectId, viewing: 'collab' });
      if (stopped) return;
      const r = await lensRun('projects', 'presence-list', { projectId });
      if (!stopped) setPresence(r.data?.result?.collaborators || []);
    };
    void beat();
    const iv = setInterval(() => { void beat(); }, 15000);
    return () => { stopped = true; clearInterval(iv); };
  }, [projectId]);

  // Cmd/Ctrl-K opens the command bar.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault();
        setCmdOpen(true);
      }
      if (e.key === 'Escape') setCmdOpen(false);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  useEffect(() => {
    if (cmdOpen) setTimeout(() => cmdInputRef.current?.focus(), 0);
  }, [cmdOpen]);

  useEffect(() => {
    if (!cmdOpen) return;
    let stale = false;
    const run = async () => {
      const r = await lensRun('projects', 'command-search', { projectId, query: cmdQuery });
      if (!stale) setCmdResult((r.data?.result as CmdResult | null) || null);
    };
    void run();
    return () => { stale = true; };
  }, [cmdOpen, cmdQuery, projectId]);

  const connectIntegration = async () => {
    if (!itgForm.target.trim()) return;
    const r = await lensRun('projects', 'integration-connect', {
      projectId, kind: itgForm.kind, target: itgForm.target.trim(),
    });
    if (r.data?.ok) { setItgForm({ kind: 'github', target: '' }); await refresh(); }
  };

  const submitTriage = async () => {
    if (!triageForm.title.trim()) return;
    const r = await lensRun('projects', 'triage-submit', {
      projectId, title: triageForm.title.trim(),
      description: triageForm.description.trim(), type: triageForm.type, source: 'user',
    });
    if (r.data?.ok) {
      setTriageForm({ title: '', description: '', type: 'bug' });
      await refresh();
      onChange();
    }
  };

  const acceptTriage = async (id: string, priority: string, status: string) => {
    await lensRun('projects', 'triage-accept', { id, priority, status });
    await refresh();
    onChange();
  };

  const declineTriage = async (id: string) => {
    await lensRun('projects', 'triage-decline', { id });
    await refresh();
    onChange();
  };

  const setPolicy = async () => {
    const r = await lensRun('projects', 'sla-policy-set', {
      projectId, priority: slaForm.priority,
      responseDays: Number(slaForm.responseDays) || 0, escalateTo: slaForm.escalateTo,
    });
    if (r.data?.ok) await refresh();
  };

  const runEscalation = async () => {
    setSlaRunning(true);
    const r = await lensRun('projects', 'sla-escalate', { projectId });
    setSlaResult((r.data?.result as SlaResult | null) || null);
    setSlaRunning(false);
    await refresh();
    onChange();
  };

  const markRead = async (id: string) => {
    await lensRun('projects', 'notification-mark-read', { id });
    await refresh();
  };
  const markAllRead = async () => {
    await lensRun('projects', 'notification-mark-read', { all: true });
    await refresh();
  };
  const clearNotifications = async () => {
    await lensRun('projects', 'notification-clear', {});
    await refresh();
  };

  if (loading) {
    return <div className="flex items-center justify-center py-10 text-zinc-400"><Loader2 className="w-5 h-5 animate-spin" /></div>;
  }

  return (
    <div className="space-y-5">
      {/* Live presence */}
      <section>
        <h3 className="flex items-center gap-1.5 text-xs font-semibold text-zinc-300 mb-2">
          <Radio className="w-3.5 h-3.5 text-emerald-400" /> Live collaborators
          <span className="text-[10px] text-zinc-400 font-normal">— real-time presence, idle &gt;45s drops off</span>
        </h3>
        {presence.length === 0 ? (
          <Empty text="No collaborators active right now." />
        ) : (
          <div className="flex flex-wrap gap-2">
            {presence.map((c) => (
              <span key={c.id} className="flex items-center gap-1.5 bg-zinc-900/70 border border-zinc-800 rounded-lg px-2.5 py-1">
                <span className="w-2 h-2 rounded-full animate-pulse" style={{ background: cssColor(c.color) }} />
                <span className="text-[11px] text-zinc-200">{c.collaborator}</span>
                <span className="text-[10px] text-zinc-400">viewing {c.viewing}</span>
              </span>
            ))}
          </div>
        )}
      </section>

      {/* Notification inbox */}
      <section>
        <div className="flex items-center gap-2 mb-2">
          <h3 className="flex items-center gap-1.5 text-xs font-semibold text-zinc-300">
            <Bell className="w-3.5 h-3.5 text-indigo-400" /> Notification inbox
          </h3>
          {unread > 0 && (
            <span className="text-[10px] px-1.5 py-0.5 rounded-full bg-indigo-600 text-white">{unread} unread</span>
          )}
          <span className="flex-1" />
          {notifications.length > 0 && (
            <>
              <button type="button" onClick={markAllRead} className={ghostBtn}>Mark all read</button>
              <button type="button" onClick={clearNotifications} className={ghostBtn}>Clear</button>
            </>
          )}
        </div>
        {notifications.length === 0 ? (
          <Empty text="No notifications yet." />
        ) : (
          <ul className="space-y-1">
            {notifications.slice(0, 12).map((n) => (
              <li key={n.id}
                className={cn('flex items-start gap-2 rounded-lg px-3 py-1.5 border',
                  n.read ? 'bg-zinc-900/40 border-zinc-800' : 'bg-indigo-950/40 border-indigo-900/50')}>
                <span className={cn('mt-1 w-1.5 h-1.5 rounded-full shrink-0', n.read ? 'bg-zinc-600' : 'bg-indigo-400')} />
                <div className="flex-1 min-w-0">
                  <p className="text-[11px] text-zinc-200">{n.title}</p>
                  {n.detail && <p className="text-[10px] text-zinc-400 truncate">{n.detail}</p>}
                </div>
                <span className="text-[9px] text-zinc-400 shrink-0">{n.kind}</span>
                {!n.read && (
                  <button type="button" onClick={() => markRead(n.id)} className="text-[10px] text-indigo-400 hover:text-indigo-300 shrink-0">
                    read
                  </button>
                )}
              </li>
            ))}
          </ul>
        )}
      </section>

      {/* Integrations */}
      <section>
        <h3 className="flex items-center gap-1.5 text-xs font-semibold text-zinc-300 mb-2">
          <Plug className="w-3.5 h-3.5 text-teal-400" /> GitHub / Slack / CI integrations
        </h3>
        <div className="grid grid-cols-1 sm:grid-cols-[auto_1fr_auto] gap-2 mb-2">
          <select value={itgForm.kind} onChange={(e) => setItgForm({ ...itgForm, kind: e.target.value })} className={inp}>
            {INTEGRATION_KINDS.map((k) => <option key={k} value={k}>{k}</option>)}
          </select>
          <input
            placeholder={itgForm.kind === 'github' ? 'owner/repo' : itgForm.kind === 'slack' ? '#channel' : 'pipeline name'}
            value={itgForm.target} onChange={(e) => setItgForm({ ...itgForm, target: e.target.value })} className={inp} />
          <button type="button" onClick={connectIntegration} className={btn}><Plus className="w-3.5 h-3.5" /> Connect</button>
        </div>
        {integrations.length === 0 ? (
          <Empty text="No integrations connected." />
        ) : (
          <ul className="space-y-1">
            {integrations.map((i) => {
              const Icon = i.kind === 'github' ? Github : i.kind === 'slack' ? MessageSquare : CheckCircle2;
              return (
                <li key={i.id} className="flex items-center gap-2 bg-zinc-900/70 border border-zinc-800 rounded-lg px-3 py-1.5">
                  <Icon className="w-3.5 h-3.5 text-zinc-400" />
                  <span className="text-xs text-zinc-200">{i.target}</span>
                  <span className="text-[10px] text-zinc-400">{i.linkCount} link{i.linkCount === 1 ? '' : 's'}</span>
                  <span className="flex-1" />
                  <button type="button"
                    onClick={() => lensRun('projects', 'integration-toggle', { id: i.id, enabled: !i.enabled }).then(refresh)}
                    className={cn('text-[10px] px-1.5 py-0.5 rounded', i.enabled ? 'bg-emerald-900/50 text-emerald-300' : 'bg-zinc-800 text-zinc-400')}>
                    {i.enabled ? 'on' : 'off'}
                  </button>
                  <button aria-label="Delete" type="button" onClick={() => lensRun('projects', 'integration-delete', { id: i.id }).then(refresh)}
                    className="text-zinc-600 hover:text-rose-400"><Trash2 className="w-3.5 h-3.5" /></button>
                </li>
              );
            })}
          </ul>
        )}
        <p className="text-[10px] text-zinc-400 mt-1.5">
          Link a PR, CI run or Slack thread to any issue from its detail view. A passing CI link auto-advances an in-review issue to done.
        </p>
      </section>

      {/* Triage inbox */}
      <section>
        <h3 className="flex items-center gap-1.5 text-xs font-semibold text-zinc-300 mb-2">
          <Inbox className="w-3.5 h-3.5 text-amber-400" /> Triage inbox
          <span className="text-[10px] text-zinc-400 font-normal">— incoming issues before the backlog</span>
        </h3>
        <div className="grid grid-cols-1 sm:grid-cols-[1fr_auto_auto] gap-2 mb-2">
          <input placeholder="Incoming issue title" value={triageForm.title}
            onChange={(e) => setTriageForm({ ...triageForm, title: e.target.value })} className={inp} />
          <select value={triageForm.type} onChange={(e) => setTriageForm({ ...triageForm, type: e.target.value })} className={inp}>
            {['bug', 'story', 'task', 'chore'].map((t) => <option key={t} value={t}>{t}</option>)}
          </select>
          <button type="button" onClick={submitTriage} className={btn}><Plus className="w-3.5 h-3.5" /> Submit</button>
        </div>
        <input placeholder="Optional detail" value={triageForm.description}
          onChange={(e) => setTriageForm({ ...triageForm, description: e.target.value })} className={cn(inp, 'w-full mb-2')} />
        {triage.length === 0 ? (
          <Empty text="Triage queue is empty." />
        ) : (
          <ul className="space-y-1.5">
            {triage.map((t) => (
              <li key={t.id} className="bg-zinc-900/70 border border-zinc-800 rounded-lg px-3 py-2 space-y-1.5">
                <div className="flex items-center gap-2">
                  <span className="text-[10px] font-mono text-amber-400">{t.ref}</span>
                  <span className="text-xs text-zinc-200 flex-1 truncate">{t.title}</span>
                  <span className="text-[9px] text-zinc-400">{t.type} · {t.triageSource}</span>
                </div>
                <div className="flex items-center gap-1.5">
                  <TriageAccept onAccept={(p, st) => acceptTriage(t.id, p, st)} />
                  <button type="button" onClick={() => declineTriage(t.id)}
                    className="text-[10px] px-2 py-1 bg-zinc-800 hover:bg-rose-900 text-zinc-300 rounded">Decline</button>
                </div>
              </li>
            ))}
          </ul>
        )}
      </section>

      {/* SLA escalation */}
      <section>
        <h3 className="flex items-center gap-1.5 text-xs font-semibold text-zinc-300 mb-2">
          <Timer className="w-3.5 h-3.5 text-rose-400" /> SLA / due-date escalation
        </h3>
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 mb-2">
          <select value={slaForm.priority} onChange={(e) => setSlaForm({ ...slaForm, priority: e.target.value })} className={inp}>
            {PRIORITIES.map((p) => <option key={p} value={p}>{p} priority</option>)}
          </select>
          <input placeholder="Response days" inputMode="numeric" value={slaForm.responseDays}
            onChange={(e) => setSlaForm({ ...slaForm, responseDays: e.target.value })} className={inp} />
          <select value={slaForm.escalateTo} onChange={(e) => setSlaForm({ ...slaForm, escalateTo: e.target.value })} className={inp}>
            {PRIORITIES.map((p) => <option key={p} value={p}>escalate → {p}</option>)}
          </select>
          <button type="button" onClick={setPolicy} className={btn}><Plus className="w-3.5 h-3.5" /> Policy</button>
        </div>
        {policies.length === 0 ? (
          <Empty text="No SLA policies — issues escalate on their due date only." />
        ) : (
          <ul className="space-y-1 mb-2">
            {policies.map((p) => (
              <li key={p.id} className="flex items-center gap-2 bg-zinc-900/70 border border-zinc-800 rounded-lg px-3 py-1.5 text-[11px]">
                <span className="text-zinc-200 flex-1">
                  {p.priority} issues respond within <span className="text-rose-300">{p.responseDays}d</span>, escalate to <span className="text-rose-300">{p.escalateTo}</span>
                </span>
                <button aria-label="Delete" type="button" onClick={() => lensRun('projects', 'sla-policy-delete', { id: p.id }).then(refresh)}
                  className="text-zinc-600 hover:text-rose-400"><Trash2 className="w-3 h-3" /></button>
              </li>
            ))}
          </ul>
        )}
        <button type="button" onClick={runEscalation} disabled={slaRunning}
          className={cn(btn, 'px-3 py-1.5 disabled:opacity-40')}>
          {slaRunning ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <RefreshCw className="w-3.5 h-3.5" />}
          Run escalation sweep
        </button>
        {slaResult && (
          <div className="mt-2 grid grid-cols-1 sm:grid-cols-2 gap-2">
            <div className="rounded-lg border border-rose-900/50 bg-rose-950/30 p-2.5">
              <p className="text-[10px] font-semibold text-rose-300 uppercase tracking-wide mb-1">
                Breached ({slaResult.breachedCount}) · {slaResult.escalated} escalated
              </p>
              {slaResult.breached.length === 0 ? (
                <p className="text-[10px] text-zinc-400">No breaches.</p>
              ) : (
                <ul className="space-y-0.5">
                  {slaResult.breached.slice(0, 6).map((b) => (
                    <li key={b.id} className="text-[10px] text-zinc-300 flex items-center gap-1.5">
                      <XCircle className="w-3 h-3 text-rose-400 shrink-0" />
                      <span className="font-mono text-zinc-400">{b.ref}</span>
                      <span className="truncate flex-1">{b.title}</span>
                      <span className="text-rose-400">{b.overdueDays}d over</span>
                    </li>
                  ))}
                </ul>
              )}
            </div>
            <div className="rounded-lg border border-amber-900/50 bg-amber-950/30 p-2.5">
              <p className="text-[10px] font-semibold text-amber-300 uppercase tracking-wide mb-1">
                At risk ({slaResult.atRiskCount})
              </p>
              {slaResult.atRisk.length === 0 ? (
                <p className="text-[10px] text-zinc-400">Nothing due soon.</p>
              ) : (
                <ul className="space-y-0.5">
                  {slaResult.atRisk.slice(0, 6).map((a) => (
                    <li key={a.id} className="text-[10px] text-zinc-300 flex items-center gap-1.5">
                      <Timer className="w-3 h-3 text-amber-400 shrink-0" />
                      <span className="font-mono text-zinc-400">{a.ref}</span>
                      <span className="truncate flex-1">{a.title}</span>
                      <span className="text-amber-400">{a.hoursLeft}h left</span>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          </div>
        )}
      </section>

      {/* Command bar */}
      <section>
        <h3 className="flex items-center gap-1.5 text-xs font-semibold text-zinc-300 mb-2">
          <Command className="w-3.5 h-3.5 text-violet-400" /> Command bar
        </h3>
        <button type="button" onClick={() => setCmdOpen(true)}
          className="w-full flex items-center gap-2 bg-zinc-900/70 border border-zinc-800 hover:border-zinc-700 rounded-lg px-3 py-2 text-[11px] text-zinc-400">
          <Command className="w-3.5 h-3.5" />
          Search projects &amp; issues, jump anywhere
          <span className="flex-1" />
          <kbd className="text-[9px] px-1.5 py-0.5 bg-zinc-800 rounded border border-zinc-700">⌘K</kbd>
        </button>
      </section>

      {cmdOpen && (
        <div className="fixed inset-0 z-[60] flex items-start justify-center bg-black/60 pt-24"
          onClick={() => setCmdOpen(false)} role="button" tabIndex={0} onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); (e.currentTarget as HTMLElement).click(); } }}>
          <div className="w-full max-w-lg bg-zinc-950 border border-zinc-800 rounded-2xl overflow-hidden"
            onClick={(e) => e.stopPropagation()} role="button" tabIndex={0} onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); (e.currentTarget as HTMLElement).click(); } }}>
            <div className="flex items-center gap-2 px-3 py-2.5 border-b border-zinc-800">
              <Command className="w-4 h-4 text-violet-400" />
              <input ref={cmdInputRef} value={cmdQuery} onChange={(e) => setCmdQuery(e.target.value)}
                placeholder="Type to search or create…"
                className="flex-1 bg-transparent text-sm text-zinc-100 placeholder-zinc-600 focus:outline-none" />
              <kbd className="text-[9px] px-1.5 py-0.5 bg-zinc-800 rounded border border-zinc-700 text-zinc-400">ESC</kbd>
            </div>
            <div className="max-h-80 overflow-y-auto p-2">
              {(cmdResult?.commands || []).map((c) => (
                <button key={c.id} type="button"
                  onClick={async () => {
                    if (c.action === 'task-create' && cmdQuery.trim()) {
                      await lensRun('projects', 'task-create', { projectId, title: cmdQuery.trim() });
                    } else if (c.action === 'project-create' && cmdQuery.trim()) {
                      await lensRun('projects', 'project-create', { name: cmdQuery.trim() });
                    }
                    setCmdOpen(false); setCmdQuery('');
                    await refresh(); onChange();
                  }}
                  className="w-full flex items-center gap-2 px-2.5 py-2 rounded-lg hover:bg-violet-950/50 text-left">
                  <Plus className="w-3.5 h-3.5 text-violet-400 shrink-0" />
                  <span className="text-[12px] text-zinc-200">{c.label}</span>
                </button>
              ))}
              {(cmdResult?.results || []).map((r) => (
                <div key={`${r.kind}-${r.id}`}
                  className="w-full flex items-center gap-2 px-2.5 py-2 rounded-lg hover:bg-zinc-900 text-left">
                  <ArrowUpRight className="w-3.5 h-3.5 text-zinc-400 shrink-0" />
                  <span className="text-[12px] text-zinc-200 flex-1 truncate">{r.label}</span>
                  <span className="text-[10px] font-mono text-zinc-400">{r.sub}</span>
                  {r.status && <span className="text-[9px] text-zinc-400">{r.status.replace(/_/g, ' ')}</span>}
                </div>
              ))}
              {cmdResult && cmdResult.results.length === 0 && cmdResult.commands.length === 0 && (
                <p className="text-[11px] text-zinc-400 italic px-2.5 py-3">Type to search projects and issues.</p>
              )}
            </div>
          </div>
        </div>
      )}

      {members.length === 0 && (
        <p className="text-[10px] text-zinc-400 italic">
          Add members in the Team tab to assign triaged issues during acceptance.
        </p>
      )}
    </div>
  );
}

function TriageAccept({ onAccept }: { onAccept: (priority: string, status: string) => void }) {
  const [priority, setPriority] = useState('medium');
  const [status, setStatus] = useState('backlog');
  return (
    <div className="flex items-center gap-1.5">
      <select value={priority} onChange={(e) => setPriority(e.target.value)}
        className="bg-zinc-950 border border-zinc-700 rounded px-1.5 py-1 text-[10px] text-zinc-100">
        {PRIORITIES.map((p) => <option key={p} value={p}>{p}</option>)}
      </select>
      <select value={status} onChange={(e) => setStatus(e.target.value)}
        className="bg-zinc-950 border border-zinc-700 rounded px-1.5 py-1 text-[10px] text-zinc-100">
        {STATUSES.map((s) => <option key={s} value={s}>{s.replace(/_/g, ' ')}</option>)}
      </select>
      <button type="button" onClick={() => onAccept(priority, status)}
        className="text-[10px] px-2 py-1 bg-indigo-600 hover:bg-indigo-500 text-white rounded">Accept</button>
    </div>
  );
}

const inp = 'bg-zinc-950 border border-zinc-700 rounded-lg px-2 py-1.5 text-xs text-zinc-100';
const btn = 'flex items-center justify-center gap-1 bg-indigo-600 hover:bg-indigo-500 text-white text-xs font-medium rounded-lg px-2.5 py-1.5';
const ghostBtn = 'text-[10px] px-2 py-0.5 bg-zinc-800 hover:bg-zinc-700 text-zinc-400 rounded';

function Empty({ text }: { text: string }) {
  return <p className="text-[11px] text-zinc-400 italic">{text}</p>;
}

function cssColor(c: string): string {
  const map: Record<string, string> = {
    red: '#dc2626', orange: '#ea580c', amber: '#d97706', lime: '#65a30d', emerald: '#059669',
    teal: '#0d9488', sky: '#0284c7', indigo: '#4f46e5', violet: '#7c3aed', pink: '#db2777', zinc: '#52525b',
  };
  return map[c] || '#4f46e5';
}
