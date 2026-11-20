'use client';

/** Share, automations, activity, timeline, table and My tasks — the Cork Wall's other views. */
import { useEffect, useMemo, useState } from 'react';
import { ArrowDownUp, Power, Trash2, UserPlus } from 'lucide-react';
import { ACTIONS, TRIGGERS, ago, avatarColour, bx, canManage, dueState, initials, shortDate, tapeOf, type Board, type BoardActivity, type Member, type MyTask, type Role } from './wx';

export function SharePanel({ board, role, members, me, onChanged, onLeft, onToast }: {
  board: Board; role: Role; members: Member[]; me: string; onChanged: () => void; onLeft: () => void; onToast: (s: string) => void;
}) {
  const [username, setUsername] = useState('');
  const [newRole, setNewRole] = useState<'viewer' | 'editor' | 'admin'>('editor');
  const [err, setErr] = useState<string | null>(null);
  const manage = canManage(role);
  return (
    <section className="space-y-3" data-testid="cw-share">
      <p className="text-[13px] text-[var(--cw-ink-2)]">Viewers can look and comment. Editors move and change cards. Admins also manage people and automations. Only the owner deletes the board.</p>
      {manage && (
        <form className="flex flex-wrap gap-2" onSubmit={async (e) => {
          e.preventDefault(); setErr(null);
          const r = await bx('collaborator-add', { boardId: board.id, username: username.trim(), role: newRole });
          if (!r.ok) { setErr(r.error); return; }
          onToast(`Shared with ${username.trim().replace(/^@/, '')}: it's on their wall now.`); setUsername(''); onChanged();
        }}>
          <input className="cw-input min-w-[160px] flex-1" value={username} onChange={(e) => setUsername(e.target.value)} placeholder="Their username" aria-label="Username to share with" data-testid="cw-share-username" />
          <select className="cw-input w-auto" value={newRole} onChange={(e) => setNewRole(e.target.value as typeof newRole)} aria-label="Their role">
            <option value="viewer">Viewer</option><option value="editor">Editor</option>{role === 'owner' && <option value="admin">Admin</option>}
          </select>
          <button type="submit" className="cw-btn cw-btn-pin" disabled={!username.trim()} data-testid="cw-share-go"><UserPlus className="h-4 w-4" /> Share</button>
        </form>
      )}
      {err && <p className="cw-error" role="alert">{err}</p>}
      <ul className="divide-y divide-[var(--cw-line)]" data-testid="cw-members">
        {members.map((m) => (
          <li key={m.userId} className="flex items-center gap-2 py-2 text-[14px]">
            <span className="cw-avatar" style={{ background: avatarColour(m.userId) }} aria-hidden>{initials(m.name)}</span>
            <span className="flex-1 font-semibold">{m.name}{m.userId === me ? ' (you)' : ''}</span>
            {m.role === 'owner' ? <span className="text-[12.5px] text-[var(--cw-muted)]">Owner</span>
              : manage && m.userId !== me && (m.role !== 'admin' || role === 'owner') ? (
                <>
                  <select className="cw-input h-8 w-auto text-[12.5px]" value={m.role} aria-label={`${m.name}'s role`} onChange={async (e) => { const r = await bx('collaborator-add', { boardId: board.id, username: m.name, role: e.target.value }); if (!r.ok) onToast(r.error || 'Not changed.'); onChanged(); }}>
                    <option value="viewer">Viewer</option><option value="editor">Editor</option>{role === 'owner' && <option value="admin">Admin</option>}
                  </select>
                  <button type="button" className="cw-btn cw-btn-ghost h-8 px-2" aria-label={`Remove ${m.name}`} onClick={async () => { const r = await bx('collaborator-remove', { boardId: board.id, userId: m.userId }); onToast(r.ok ? `${m.name} no longer has this board; their cards are unassigned.` : r.error || 'Not removed.'); onChanged(); }}><Trash2 className="h-4 w-4" /></button>
                </>
              ) : <span className="text-[12.5px] capitalize text-[var(--cw-muted)]">{m.role}</span>}
          </li>
        ))}
      </ul>
      {role !== 'owner' && (
        <button type="button" className="cw-btn" onClick={async () => { const r = await bx('collaborator-remove', { boardId: board.id, userId: me }); if (!r.ok) { onToast(r.error || 'Not left.'); return; } onToast('You left the board.'); onLeft(); }}>Leave this board</button>
      )}
    </section>
  );
}

export function AutomationsPanel({ board, role, members, onChanged, onToast }: { board: Board; role: Role; members: Member[]; onChanged: () => void; onToast: (s: string) => void }) {
  const cols = board.columns.filter((c) => !c.archived);
  const [trigger, setTrigger] = useState(TRIGGERS[0].id);
  const [columnId, setColumnId] = useState(cols[cols.length - 1]?.id || '');
  const [action, setAction] = useState(ACTIONS[0].id);
  const [value, setValue] = useState('');
  const [err, setErr] = useState<string | null>(null);
  const manage = canManage(role);
  const kind = ACTIONS.find((a) => a.id === action)!.value;
  const colName = (id: string) => board.columns.find((c) => c.id === id)?.name || '—';
  const valueText = (a: string, v: string | null) => {
    const k = ACTIONS.find((x) => x.id === a)?.value;
    if (!v) return '';
    if (k === 'column') return ` "${colName(v)}"`;
    if (k === 'member') return ` ${members.find((m) => m.userId === v)?.name || v}`;
    if (k === 'days') return ` ${v} day${v === '1' ? '' : 's'}`;
    return ` "${v}"`;
  };
  return (
    <section className="space-y-3" data-testid="cw-automations">
      <ul className="space-y-2">
        {(board.automations || []).map((r) => (
          <li key={r.id} className={`flex items-center gap-2 rounded border border-[var(--cw-line)] bg-white/60 p-2 text-[13.5px] ${r.enabled ? '' : 'opacity-50'}`}>
            <span className="flex-1">When {TRIGGERS.find((t) => t.id === r.trigger)?.label} <b>{colName(r.columnId)}</b>, {ACTIONS.find((a) => a.id === r.action)?.label}{valueText(r.action, r.value)}.</span>
            {manage && <>
              <button type="button" className="cw-btn cw-btn-ghost h-7 px-2" aria-pressed={r.enabled} aria-label={r.enabled ? 'Switch off' : 'Switch on'} onClick={async () => { await bx('automation-toggle', { boardId: board.id, ruleId: r.id }); onChanged(); }}><Power className="h-4 w-4" /></button>
              <button type="button" className="cw-btn cw-btn-ghost h-7 px-2" aria-label="Delete automation" onClick={async () => { await bx('automation-delete', { boardId: board.id, ruleId: r.id }); onChanged(); }}><Trash2 className="h-4 w-4" /></button>
            </>}
          </li>
        ))}
        {!(board.automations || []).length && <li className="text-[13px] text-[var(--cw-muted)]">No automations yet. A rule runs the moment its card moves, is added or finishes its checklist.</li>}
      </ul>
      {manage ? (
        <form className="space-y-2 rounded border border-dashed border-[var(--cw-line)] p-3 text-[13.5px]" onSubmit={async (e) => {
          e.preventDefault(); setErr(null);
          const r = await bx('automation-add', { boardId: board.id, trigger, columnId, action, value: kind === 'none' ? null : value });
          if (!r.ok) { setErr(r.error); return; }
          setValue(''); onToast('Automation added.'); onChanged();
        }}>
          <div className="flex flex-wrap items-center gap-2">When
            <select className="cw-input w-auto" value={trigger} onChange={(e) => setTrigger(e.target.value)} aria-label="Trigger">{TRIGGERS.map((t) => <option key={t.id} value={t.id}>{t.label}</option>)}</select>
            <select className="cw-input w-auto" value={columnId} onChange={(e) => setColumnId(e.target.value)} aria-label="Column">{cols.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}</select>
          </div>
          <div className="flex flex-wrap items-center gap-2">then
            <select className="cw-input w-auto" value={action} onChange={(e) => { setAction(e.target.value); setValue(''); }} aria-label="Action">{ACTIONS.map((a) => <option key={a.id} value={a.id}>{a.label}</option>)}</select>
            {kind === 'label' && <input className="cw-input w-40" value={value} onChange={(e) => setValue(e.target.value)} placeholder="label" aria-label="Label" maxLength={30} />}
            {kind === 'days' && <input className="cw-input w-20" inputMode="numeric" value={value} onChange={(e) => setValue(e.target.value)} placeholder="7" aria-label="Days" />}
            {kind === 'member' && <select className="cw-input w-auto" value={value} onChange={(e) => setValue(e.target.value)} aria-label="Person"><option value="">choose…</option>{members.map((m) => <option key={m.userId} value={m.userId}>{m.name}</option>)}</select>}
            {kind === 'column' && <select className="cw-input w-auto" value={value} onChange={(e) => setValue(e.target.value)} aria-label="Target column"><option value="">choose…</option>{cols.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}</select>}
          </div>
          {err && <p className="cw-error" role="alert">{err}</p>}
          <button type="submit" className="cw-btn cw-btn-pin" data-testid="cw-auto-add">Add automation</button>
        </form>
      ) : <p className="text-[12.5px] text-[var(--cw-muted)]">Only the owner or an admin can change automations.</p>}
    </section>
  );
}

export function ActivityPanel({ boardId, refreshKey }: { boardId: string; refreshKey: number }) {
  const [items, setItems] = useState<BoardActivity[] | null>(null);
  useEffect(() => { void bx<{ activity: BoardActivity[] }>('board-activity', { boardId, limit: 80 }).then((r) => setItems(r.ok ? r.result!.activity : [])); }, [boardId, refreshKey]);
  if (!items) return <div className="h-32 rounded bg-[var(--cw-card-2)]" role="status" aria-label="Loading activity" />;
  if (!items.length) return <p className="text-[13px] text-[var(--cw-muted)]">Nothing has happened on this board yet.</p>;
  return (
    <ol className="space-y-2" data-testid="cw-activity">
      {items.map((a) => (
        <li key={a.id} className="flex gap-2 text-[13.5px]">
          <span className="cw-avatar shrink-0" style={{ background: avatarColour(a.by) }} aria-hidden>{initials(a.byName)}</span>
          <p><b>{a.byName}</b> {a.words}{a.cardTitle ? <> <i>&ldquo;{a.cardTitle}&rdquo;</i></> : null}{a.toColumn ? <> to <b>{a.toColumn}</b></> : null} <span className="text-[11.5px] text-[var(--cw-muted)]">{ago(a.at)}</span></p>
        </li>
      ))}
    </ol>
  );
}

/** Six weeks of due dates: each card a tack on its day, one row per column. */
export function TimelineView({ board, onOpen }: { board: Board; onOpen: (id: string) => void }) {
  const start = useMemo(() => { const d = new Date(); d.setHours(0, 0, 0, 0); d.setDate(d.getDate() - 7); return d.getTime(); }, []);
  const DAYS = 42, day = 86400000;
  const cols = board.columns.filter((c) => !c.archived);
  const dated = board.cards.filter((c) => !c.archived && c.dueDate);
  const undated = board.cards.filter((c) => !c.archived && !c.dueDate).length;
  const today = Math.floor((Date.now() - start) / day);
  return (
    <div className="cw-panel cw-scroll m-4 overflow-x-auto p-4" data-testid="cw-timeline">
      <p className="mb-3 text-[13px] text-[var(--cw-ink-2)]">{dated.length} dated card{dated.length === 1 ? '' : 's'} over six weeks{undated ? ` · ${undated} without a date` : ''}.</p>
      <div className="relative min-w-[880px]">
        <div className="grid" style={{ gridTemplateColumns: `120px repeat(${DAYS}, 1fr)` }}>
          <div />
          {Array.from({ length: DAYS }, (_, i) => { const d = new Date(start + i * day); return <div key={i} className={`cw-mono border-l border-[var(--cw-line)] pl-0.5 text-[10px] ${i === today ? 'font-bold text-[var(--cw-pin)]' : 'text-[var(--cw-muted)]'}`}>{d.getDate() === 1 || i === 0 || d.getDay() === 1 ? d.toLocaleDateString(undefined, { month: 'short', day: 'numeric' }) : ''}</div>; })}
          {cols.map((col) => (
            <div key={col.id} className="contents">
              <div className="truncate border-t border-[var(--cw-line)] py-2 pr-2 text-[13px] font-bold">{col.name}</div>
              <div className="relative border-t border-[var(--cw-line)]" style={{ gridColumn: `span ${DAYS}`, minHeight: 44 }}>
                <div className="absolute inset-y-0 w-px bg-[var(--cw-pin)] opacity-60" style={{ left: `${((today + 0.5) / DAYS) * 100}%` }} aria-hidden />
                {dated.filter((c) => c.columnId === col.id).map((c, k) => {
                  const off = Math.floor((Date.parse(c.dueDate!.length === 10 ? `${c.dueDate}T12:00:00` : c.dueDate!) - start) / day);
                  if (off < 0 || off >= DAYS) return null;
                  const ds = dueState(c.dueDate);
                  return (
                    <button key={c.id} type="button" onClick={() => onOpen(c.id)} title={`${c.title} — ${shortDate(c.dueDate!)}`}
                      className={`absolute max-w-[160px] truncate rounded px-1.5 py-0.5 text-left text-[11.5px] font-semibold shadow ${ds === 'overdue' ? 'bg-[#f6d2cd]' : 'bg-[var(--cw-card)]'}`}
                      style={{ left: `${(off / DAYS) * 100}%`, top: 4 + (k % 3) * 13 }}>
                      {c.title}
                    </button>
                  );
                })}
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

export function TableView({ board, members, onOpen }: { board: Board; members: Member[]; onOpen: (id: string) => void }) {
  const [sort, setSort] = useState<{ k: 'title' | 'column' | 'due' | 'who' | 'check'; dir: 1 | -1 }>({ k: 'due', dir: 1 });
  const colName = (id: string) => board.columns.find((c) => c.id === id)?.name || '';
  const colIdx = (id: string) => board.columns.findIndex((c) => c.id === id);
  const who = (id: string | null) => members.find((m) => m.userId === id)?.name || '';
  const rows = board.cards.filter((c) => !c.archived).slice().sort((a, b) => {
    const v = sort.k === 'title' ? a.title.localeCompare(b.title) : sort.k === 'column' ? colIdx(a.columnId) - colIdx(b.columnId)
      : sort.k === 'who' ? who(a.assignee).localeCompare(who(b.assignee)) : sort.k === 'check' ? (a.checklist.filter((i) => i.done).length / (a.checklist.length || 1)) - (b.checklist.filter((i) => i.done).length / (b.checklist.length || 1))
      : String(a.dueDate || '9999').localeCompare(String(b.dueDate || '9999'));
    return v * sort.dir;
  });
  const H = ({ k, children }: { k: typeof sort.k; children: React.ReactNode }) => (
    <th className="px-2 py-2 text-left"><button type="button" className="flex items-center gap-1 font-bold" onClick={() => setSort((s) => ({ k, dir: s.k === k ? (s.dir === 1 ? -1 : 1) : 1 }))} aria-sort={sort.k === k ? (sort.dir === 1 ? 'ascending' : 'descending') : 'none'}>{children}<ArrowDownUp className="h-3 w-3 opacity-50" /></button></th>
  );
  return (
    <div className="cw-panel cw-scroll m-4 overflow-x-auto" data-testid="cw-table">
      <table className="w-full min-w-[640px] text-[13.5px]">
        <thead className="border-b border-[var(--cw-line)] text-[12px] uppercase tracking-wide text-[var(--cw-ink-2)]">
          <tr><H k="title">Card</H><H k="column">Column</H><th className="px-2 py-2 text-left">Labels</th><H k="who">For</H><H k="due">Due</H><H k="check">Checklist</H></tr>
        </thead>
        <tbody>
          {rows.map((c) => {
            const ds = dueState(c.dueDate);
            return (
              <tr key={c.id} className="border-b border-[var(--cw-line)] hover:bg-[var(--cw-card-2)]">
                <td className="px-2 py-1.5"><button type="button" className="text-left font-semibold hover:underline" onClick={() => onOpen(c.id)}>{c.title}</button></td>
                <td className="px-2">{colName(c.columnId)}</td>
                <td className="px-2"><span className="flex flex-wrap gap-1">{c.labels.map((l) => <span key={l} className="cw-washi-text" style={{ background: tapeOf(l, board.labelDefs) }}>{l}</span>)}</span></td>
                <td className="px-2">{who(c.assignee)}</td>
                <td className={`cw-mono px-2 ${ds === 'overdue' ? 'font-bold text-[var(--cw-bad)]' : ''}`}>{c.dueDate ? shortDate(c.dueDate) : '—'}</td>
                <td className="cw-mono px-2">{c.checklist.length ? `${c.checklist.filter((i) => i.done).length}/${c.checklist.length}` : '—'}</td>
              </tr>
            );
          })}
          {!rows.length && <tr><td colSpan={6} className="px-2 py-6 text-center text-[var(--cw-muted)]">No cards on this board yet.</td></tr>}
        </tbody>
      </table>
    </div>
  );
}

const BUCKETS: { id: MyTask['bucket']; label: string }[] = [
  { id: 'overdue', label: 'Overdue' }, { id: 'today', label: 'Today' }, { id: 'week', label: 'This week' }, { id: 'later', label: 'Later / no date' }, { id: 'done', label: 'Done' },
];
export function MyTasks({ onOpen, onToast, refreshKey, onImported }: { onOpen: (boardId: string, cardId: string) => void; onToast: (s: string) => void; refreshKey: number; onImported: (boardId: string) => void }) {
  const [data, setData] = useState<{ tasks: MyTask[]; counts: Record<string, number>; legacyTasks: number } | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [showDone, setShowDone] = useState(false);
  const [busy, setBusy] = useState(false);
  useEffect(() => { void bx<{ tasks: MyTask[]; counts: Record<string, number>; legacyTasks: number }>('my-tasks', { includeDone: showDone }).then((r) => { if (r.ok) { setData(r.result); setErr(null); } else setErr(r.error); }); }, [showDone, refreshKey]);
  if (err) return <p className="cw-error m-4" role="alert">{err}</p>;
  if (!data) return <div className="cw-skeleton m-4 h-48" role="status" aria-label="Gathering your tasks" />;
  return (
    <div className="mx-auto max-w-3xl space-y-4 p-4" data-testid="cw-mytasks">
      {data.legacyTasks > 0 && (
        <div className="cw-panel flex flex-wrap items-center gap-3 p-4" data-testid="cw-import">
          <p className="flex-1 text-[14px]">You have <b>{data.legacyTasks}</b> task{data.legacyTasks === 1 ? '' : 's'} from the old task list. Bring {data.legacyTasks === 1 ? 'it' : 'them'} onto a board, keeping status, due dates, subtasks and comments.</p>
          <button type="button" className="cw-btn cw-btn-pin" disabled={busy} onClick={async () => { setBusy(true); const r = await bx<{ boardId: string; imported: number }>('import-tasks'); setBusy(false); if (!r.ok) { onToast(r.error || 'Not imported.'); return; } onToast(`Brought in ${r.result!.imported} tasks on a board called "My tasks".`); onImported(r.result!.boardId); }}>{busy ? 'Bringing them in…' : 'Bring them in'}</button>
        </div>
      )}
      <div className="flex items-center justify-between">
        <h2 className="cw-marker cw-on-cork text-[34px] leading-none">My tasks</h2>
        <label className="cw-on-cork flex items-center gap-2 text-[13px] font-semibold"><input type="checkbox" checked={showDone} onChange={(e) => setShowDone(e.target.checked)} /> Show done</label>
      </div>
      {!data.tasks.length && <p className="cw-panel p-6 text-center text-[14px] text-[var(--cw-ink-2)]">Nothing is assigned to you. Cards you&rsquo;re given on any board, and the unassigned ones you pin, gather here.</p>}
      {BUCKETS.map((b) => {
        const list = data.tasks.filter((t) => t.bucket === b.id);
        if (!list.length) return null;
        return (
          <section key={b.id}>
            <h3 className={`cw-on-cork mb-2 text-[13px] font-extrabold uppercase tracking-wide ${b.id === 'overdue' ? '!text-[#ffd9d2]' : ''}`}>{b.label} · {list.length}</h3>
            <ul className="grid gap-3 sm:grid-cols-2">
              {list.map((t) => (
                <li key={t.cardId}>
                  <button type="button" className="cw-card px-3 pb-2 pt-4" onClick={() => onOpen(t.boardId, t.cardId)} data-testid="cw-mytask">
                    <span className="cw-pin" aria-hidden />
                    <p className={`text-[14.5px] font-semibold ${t.done ? 'line-through opacity-60' : ''}`}>{t.title}</p>
                    <p className="mt-1 text-[12px] text-[var(--cw-ink-2)]">{t.boardName} · {t.columnName}{t.dueDate ? ` · ${shortDate(t.dueDate)}` : ''}{t.checklist.total ? ` · ${t.checklist.done}/${t.checklist.total}` : ''}{!t.assignedToMe ? ' · yours, unassigned' : ''}</p>
                  </button>
                </li>
              ))}
            </ul>
          </section>
        );
      })}
    </div>
  );
}

interface Flow {
  message?: string; totalCards?: number; completedCards?: number; inProgressCards?: number;
  cycleTime?: { median: number; p85: number }; leadTime?: { median: number; p85: number };
  throughput?: { weeklyAvg: number; recentCompletedCount: number };
  wip?: { byColumn: Record<string, { currentWip: number }> };
  bottleneck?: string | { column?: string; name?: string; avgDays?: number } | null;
}
/**
 * Flow: the board's own history, measured. Each card's column moves are
 * recorded, so cycle time (first move off the first column → arriving in
 * the last) and lead time (pinned → done) come from what really happened.
 */
export function FlowPanel({ board }: { board: Board }) {
  const [flow, setFlow] = useState<Flow | null>(null);
  const [err, setErr] = useState<string | null>(null);
  useEffect(() => {
    const cols = board.columns.filter((c) => !c.archived);
    const name = (id: string) => board.columns.find((c) => c.id === id)?.name || '';
    const first = cols[0]?.id, last = cols[cols.length - 1]?.id;
    const cards = board.cards.filter((c) => !c.archived).map((c) => {
      const tr = c.transitions || [];
      const started = tr.find((t) => t.columnId !== first)?.at;
      const doneAt = c.columnId === last && cols.length > 1 ? [...tr].reverse().find((t) => t.columnId === last)?.at : undefined;
      return {
        id: c.id, title: c.title, column: name(c.columnId), createdAt: c.createdAt,
        ...(started ? { startedAt: started } : {}), ...(doneAt ? { completedAt: doneAt } : {}),
        transitions: tr.map((t, i) => ({ column: name(t.columnId), enteredAt: t.at, ...(tr[i + 1] ? { exitedAt: tr[i + 1].at } : {}) })),
      };
    });
    void bx<Flow>('workflowAnalysis', { cards, columns: cols.map((c) => ({ name: c.name })) }).then((r) => { if (r.ok) { setFlow(r.result); setErr(null); } else setErr(r.error); });
  }, [board]);
  if (err) return <p className="cw-error" role="alert">{err}</p>;
  if (!flow) return <div className="h-32 rounded bg-[var(--cw-card-2)]" role="status" aria-label="Measuring the flow" />;
  if (flow.message) return <p className="text-[13px] text-[var(--cw-muted)]">{flow.message}</p>;
  const bn = typeof flow.bottleneck === 'string' ? flow.bottleneck : flow.bottleneck?.column || flow.bottleneck?.name || null;
  const done = flow.completedCards || 0;
  const Stat = ({ k, v, sub }: { k: string; v: string; sub?: string }) => (
    <div className="rounded border border-[var(--cw-line)] bg-white/60 p-2"><p className="text-[11px] font-bold uppercase tracking-wide text-[var(--cw-ink-2)]">{k}</p><p className="cw-mono text-[20px] font-semibold">{v}</p>{sub && <p className="text-[11.5px] text-[var(--cw-muted)]">{sub}</p>}</div>
  );
  return (
    <section className="space-y-3" data-testid="cw-flow">
      <div className="grid grid-cols-2 gap-2">
        <Stat k="Done" v={`${done}/${flow.totalCards}`} sub={`${flow.inProgressCards} in progress`} />
        <Stat k="Per week" v={String(flow.throughput?.weeklyAvg ?? 0)} sub="finished, last 4 weeks" />
        <Stat k="Cycle time" v={done ? `${flow.cycleTime?.median} d` : '—'} sub={done ? `85% within ${flow.cycleTime?.p85} d` : 'needs finished cards'} />
        <Stat k="Lead time" v={done ? `${flow.leadTime?.median} d` : '—'} sub={done ? 'pinned → done (median)' : 'needs finished cards'} />
      </div>
      {flow.wip && (
        <div>
          <p className="mb-1 text-[11px] font-bold uppercase tracking-wide text-[var(--cw-ink-2)]">Work in progress, by column</p>
          {Object.entries(flow.wip.byColumn).map(([c, v]) => {
            const max = Math.max(1, ...Object.values(flow.wip!.byColumn).map((x) => x.currentWip));
            return <div key={c} className="mb-1 flex items-center gap-2 text-[12.5px]"><span className="w-24 truncate">{c}</span><span className="h-2.5 rounded bg-[var(--cw-pin)]" style={{ width: `${(v.currentWip / max) * 60}%`, minWidth: v.currentWip ? 4 : 0 }} /><span className="cw-mono">{v.currentWip}</span></div>;
          })}
        </div>
      )}
      {bn && <p className="text-[13px]">Slowest stage: <b>{bn}</b>, where cards wait longest.</p>}
      <p className="text-[11.5px] text-[var(--cw-muted)]">Measured from each card&rsquo;s recorded column moves; a card counts as done in the last column.</p>
    </section>
  );
}
