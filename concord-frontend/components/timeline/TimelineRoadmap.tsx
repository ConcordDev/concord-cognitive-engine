'use client';

/**
 * TimelineRoadmap — the Timeline lens per its north-star concept
 * (docs/lens-northstar/10): "when Board work lands". Lanes of real dated
 * work over a four-week window, one floating "+ Add milestone".
 *
 * Wiring (all real, no seed data):
 *   - board.task artifacts with a dueDate → bars in a lane per task label;
 *     a bar runs from the artifact's createdAt to its dueDate
 *   - goals.goal artifacts with a targetDate → bars in the "Goals" lane
 *   - click a bar → detail card: change the due date, mark done / reopen
 *     (lens update, data is merged server-side), open in Board / Goals
 *   - "+ Add milestone" → creates a board.task (tagged "milestone") with a
 *     title, due date and lane, so it also shows up on the Board
 */

import { useEffect, useMemo, useRef, useState } from 'react';
import Link from 'next/link';
import { ChevronLeft, ChevronRight, Plus, X } from 'lucide-react';
import { useLensData, type LensItem } from '@/lib/hooks/use-lens-data';
import { useAuth } from '@/hooks/useAuth';
import { titleCaseDisplayName } from '@/components/chat/claudeCleanGreeting';
import { cn } from '@/lib/utils';

const DAY = 86_400_000;
const WINDOW_DAYS = 28;

type Source = 'board' | 'goals';

interface Bar {
  id: string;
  source: Source;
  title: string;
  lane: string;
  start: number;
  due: number;
  done: boolean;
  active: boolean;
}

function startOfWeek(d: Date) {
  const x = new Date(d.getFullYear(), d.getMonth(), d.getDate());
  const dow = (x.getDay() + 6) % 7; // Monday = 0
  return new Date(x.getTime() - dow * DAY);
}

/** Parse a YYYY-MM-DD (local) or ISO date; NaN when absent or invalid. */
function parseDay(v: unknown): number {
  if (typeof v !== 'string' || !v) return NaN;
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(v);
  if (m) return new Date(+m[1], +m[2] - 1, +m[3], 12).getTime();
  return new Date(v).getTime();
}

const toInputDay = (t: number) => {
  const d = new Date(t);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
};

const fmtDay = (t: number) => new Date(t).toLocaleDateString('en-US', { month: 'short', day: 'numeric' });

function horizon(bars: Bar[], now: number): string {
  const open = bars.filter((b) => !b.done);
  if (open.length === 0) return 'done';
  const next = Math.min(...open.map((b) => b.due));
  const days = Math.floor((next - now) / DAY);
  if (days < 0) return 'overdue';
  if (days < 7) return 'this week';
  if (days < 14) return 'next week';
  if (days < 21) return 'two weeks';
  return 'later';
}

function barsFrom(tasks: LensItem<Record<string, unknown>>[], goals: LensItem<Record<string, unknown>>[]): Bar[] {
  const out: Bar[] = [];
  for (const t of tasks) {
    const due = parseDay(t.data?.dueDate);
    if (Number.isNaN(due)) continue;
    const created = new Date(t.createdAt).getTime();
    const status = String(t.data?.status ?? 'todo');
    out.push({
      id: t.id,
      source: 'board',
      title: t.title || String(t.data?.title ?? 'Untitled'),
      lane: String(t.data?.label || 'Board'),
      start: Number.isNaN(created) || created >= due ? due - 2 * DAY : created,
      due,
      done: status === 'done',
      active: ['in_progress', 'in_review', 'testing'].includes(status),
    });
  }
  for (const g of goals) {
    const due = parseDay(g.data?.targetDate);
    if (Number.isNaN(due)) continue;
    const created = new Date(g.createdAt).getTime();
    out.push({
      id: g.id,
      source: 'goals',
      title: g.title || String(g.data?.title ?? 'Untitled goal'),
      lane: 'Goals',
      start: Number.isNaN(created) || created >= due ? due - 2 * DAY : created,
      due,
      done: g.data?.status === 'completed',
      active: false,
    });
  }
  return out;
}

export function TimelineRoadmap() {
  const { user } = useAuth();
  const who = titleCaseDisplayName(user?.username);
  const tasksQ = useLensData<Record<string, unknown>>('board', 'task', { noSeed: true });
  const goalsQ = useLensData<Record<string, unknown>>('goals', 'goal', { noSeed: true });

  const [offsetWeeks, setOffsetWeeks] = useState(0);
  const [openId, setOpenId] = useState<string | null>(null);
  const [adding, setAdding] = useState(false);
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  // The clock is read once per mount; the window doesn't need to tick.
  const [now] = useState(() => Date.now());
  const windowStart = startOfWeek(new Date(now)).getTime() + offsetWeeks * 7 * DAY;
  const windowEnd = windowStart + WINDOW_DAYS * DAY;

  const bars = useMemo(() => barsFrom(tasksQ.items, goalsQ.items), [tasksQ.items, goalsQ.items]);

  const lanes = useMemo(() => {
    const visible = bars.filter((b) => !(b.done && b.due < windowStart));
    const by = new Map<string, Bar[]>();
    for (const b of visible) by.set(b.lane, [...(by.get(b.lane) ?? []), b]);
    return [...by.entries()]
      .map(([name, items]) => ({ name, items: items.sort((a, b) => a.due - b.due), h: horizon(items, now) }))
      .sort((a, b) => {
        const na = Math.min(...a.items.filter((x) => !x.done).map((x) => x.due), Infinity);
        const nb = Math.min(...b.items.filter((x) => !x.done).map((x) => x.due), Infinity);
        return na - nb;
      });
  }, [bars, windowStart, now]);

  const laneNames = useMemo(() => [...new Set(bars.filter((b) => b.source === 'board').map((b) => b.lane))], [bars]);
  const open = bars.find((b) => b.id === openId) ?? null;

  const pct = (t: number) => ((Math.min(Math.max(t, windowStart), windowEnd) - windowStart) / (windowEnd - windowStart)) * 100;

  const patch = async (bar: Bar, data: Record<string, unknown>) => {
    setErr(null);
    try {
      const fn = bar.source === 'board' ? tasksQ.update : goalsQ.update;
      const r = (await fn(bar.id, { data })) as { ok?: boolean; error?: string } | undefined;
      if (r && r.ok === false) throw new Error(r.error || 'Update failed');
    } catch (e) {
      setErr(e instanceof Error ? e.message : 'Update failed');
    }
  };

  const loading = tasksQ.isLoading || goalsQ.isLoading;
  const failed = tasksQ.isError && goalsQ.isError;

  return (
    <div className="relative px-8 pb-28 pt-4">
      <p className="text-[13px] text-zinc-500">Timeline</p>
      <h1 className="font-vault text-[2.75rem] leading-tight text-zinc-100">
        {who ? `When it lands, ${who}` : 'When it lands'}
      </h1>

      {/* Week ruler */}
      <div className="mt-8 flex items-center gap-2">
        <div className="relative h-5 flex-1">
          {[0, 1, 2, 3, 4].map((w) => (
            <span
              key={w}
              className="absolute -translate-x-1/2 whitespace-nowrap text-[12px] tabular-nums text-zinc-500 first:translate-x-0 last:-translate-x-full"
              style={{ left: `${(w / 4) * 100}%` }}
            >
              {fmtDay(windowStart + w * 7 * DAY)}
            </span>
          ))}
        </div>
        <div className="flex items-center text-zinc-500">
          <button type="button" onClick={() => setOffsetWeeks((o) => o - 2)} className="rounded-md p-1 hover:bg-white/[0.06] hover:text-zinc-200" aria-label="Earlier">
            <ChevronLeft className="h-4 w-4" />
          </button>
          {offsetWeeks !== 0 && (
            <button type="button" onClick={() => setOffsetWeeks(0)} className="rounded-md px-1.5 text-[12px] hover:text-zinc-200">
              Now
            </button>
          )}
          <button type="button" onClick={() => setOffsetWeeks((o) => o + 2)} className="rounded-md p-1 hover:bg-white/[0.06] hover:text-zinc-200" aria-label="Later">
            <ChevronRight className="h-4 w-4" />
          </button>
        </div>
      </div>

      {err && <p className="mt-3 text-[13px] text-rose-400" role="alert">{err}</p>}

      <div className="mt-2 flex flex-col gap-4">
        {loading ? (
          [0, 1, 2].map((i) => <div key={i} className="h-24 animate-pulse rounded-2xl border border-white/[0.06] bg-white/[0.015]" />)
        ) : failed ? (
          <div className="rounded-2xl border border-white/[0.08] p-6 text-[14px] text-zinc-400">
            Couldn’t load your Board and Goals.{' '}
            <button type="button" className="text-teal-300 hover:underline" onClick={() => { tasksQ.refetch(); goalsQ.refetch(); }}>
              Retry
            </button>
          </div>
        ) : lanes.length === 0 ? (
          <div className="rounded-2xl border border-white/[0.08] bg-white/[0.015] p-6">
            <div className="h-px bg-gradient-to-r from-transparent via-white/10 to-transparent" />
            <p className="mt-5 text-[14px] text-zinc-500">
              Nothing has a due date yet. Add a milestone, or give a Board task or a Goal a due date.
            </p>
          </div>
        ) : (
          lanes.map((lane) => (
            <section key={lane.name} aria-label={`${lane.name} lane`} className="rounded-2xl border border-white/[0.08] bg-white/[0.015] px-4 pb-4 pt-3">
              <header className="flex items-center justify-between">
                <h2 className="text-[15px] text-zinc-200">{lane.name}</h2>
                <span className={cn('text-[13px]', lane.h === 'overdue' ? 'text-rose-300' : 'text-zinc-500')}>{lane.h}</span>
              </header>
              <div className="mt-3 flex flex-col gap-2">
                {lane.items.map((b) => {
                  const before = b.due < windowStart;
                  const after = b.start > windowEnd;
                  const left = pct(b.start);
                  const width = Math.max(pct(b.due) - left, 6);
                  return (
                    <div key={b.id} className="relative h-7">
                      <div className="absolute inset-x-0 top-1/2 h-px bg-gradient-to-r from-transparent via-white/[0.07] to-transparent" />
                      <button
                        type="button"
                        onClick={() => setOpenId((o) => (o === b.id ? null : b.id))}
                        title={`${b.title} · due ${fmtDay(b.due)}`}
                        aria-expanded={openId === b.id}
                        className={cn(
                          'absolute top-0 flex h-7 items-center truncate rounded-md border px-2.5 text-left text-[13px] transition-colors',
                          b.done
                            ? 'border-teal-400/30 bg-teal-400/[0.08] text-zinc-400 line-through decoration-zinc-600'
                            : b.active
                              ? 'border-teal-400/40 bg-teal-400/[0.14] text-zinc-100 hover:bg-teal-400/20'
                              : b.source === 'goals'
                                ? 'border-white/15 bg-white/[0.05] text-zinc-200 hover:bg-white/[0.08]'
                                : 'border-violet-400/40 bg-violet-400/[0.12] text-zinc-100 hover:bg-violet-400/20',
                          openId === b.id && 'ring-1 ring-teal-300/50',
                        )}
                        style={{ left: `${Math.min(left, 94)}%`, width: `${Math.min(width, 100 - Math.min(left, 94))}%` }}
                      >
                        {before && !b.done && <span className="mr-1 text-rose-300">←</span>}
                        <span className="truncate">{b.title}</span>
                        {after && <span className="ml-auto pl-1 text-zinc-500">→</span>}
                      </button>
                    </div>
                  );
                })}
              </div>
              {open && open.lane === lane.name && (
                <BarDetail key={open.id} bar={open} onClose={() => setOpenId(null)} onPatch={patch} />
              )}
            </section>
          ))
        )}
      </div>

      {adding && (
        <AddMilestone
          lanes={laneNames}
          saving={saving}
          onCancel={() => setAdding(false)}
          onSave={async ({ title, due, lane }) => {
            setSaving(true);
            setErr(null);
            try {
              const r = (await tasksQ.create({
                title,
                data: {
                  title, description: '', status: 'todo', priority: 'medium', type: 'task',
                  assignee: user?.username ?? '', label: lane, progress: 0, dueDate: due,
                  tags: ['milestone'], attachments: 0, commentCount: 0, subtasks: [], comments: [],
                  activity: [{ id: `act-${Date.now()}`, action: 'Milestone created', timestamp: new Date().toISOString() }],
                  files: [],
                },
              })) as { ok?: boolean; error?: string } | undefined;
              if (r && r.ok === false) throw new Error(r.error || 'Could not add the milestone');
              setAdding(false);
            } catch (e) {
              setErr(e instanceof Error ? e.message : 'Could not add the milestone');
            } finally {
              setSaving(false);
            }
          }}
        />
      )}

      <button
        type="button"
        onClick={() => setAdding(true)}
        className="fixed bottom-8 right-8 z-30 inline-flex items-center gap-2 rounded-full bg-teal-400 px-6 py-3.5 text-[15px] font-medium text-black shadow-[0_8px_32px_rgba(45,212,191,0.25)] transition-colors hover:bg-teal-300"
      >
        <Plus className="h-4 w-4" />
        Add milestone
      </button>
    </div>
  );
}

function BarDetail({ bar, onClose, onPatch }: { bar: Bar; onClose: () => void; onPatch: (b: Bar, d: Record<string, unknown>) => Promise<void> }) {
  const [due, setDue] = useState(toInputDay(bar.due));
  const dateKey = bar.source === 'board' ? 'dueDate' : 'targetDate';
  return (
    <div className="mt-3 flex flex-wrap items-center gap-3 rounded-xl border border-white/[0.08] bg-black/40 px-4 py-3 text-[13px]">
      <span className="min-w-0 flex-1 truncate text-zinc-100">{bar.title}</span>
      <label className="flex items-center gap-2 text-zinc-500">
        Due
        <input
          type="date"
          value={due}
          onChange={(e) => setDue(e.target.value)}
          onBlur={() => { if (due && due !== toInputDay(bar.due)) onPatch(bar, { [dateKey]: due }); }}
          className="rounded-md border border-white/10 bg-transparent px-2 py-1 text-zinc-200 [color-scheme:dark]"
        />
      </label>
      <button
        type="button"
        onClick={() => onPatch(bar, bar.source === 'board'
          ? { status: bar.done ? 'todo' : 'done' }
          : bar.done ? { status: 'active' } : { status: 'completed', progress: 100 })}
        className="rounded-full border border-white/10 px-3 py-1 text-zinc-200 hover:border-teal-300/50 hover:text-teal-200"
      >
        {bar.done ? 'Reopen' : 'Mark done'}
      </button>
      <Link href={bar.source === 'board' ? '/lenses/board' : '/lenses/goals'} className="text-zinc-500 hover:text-zinc-200">
        Open in {bar.source === 'board' ? 'Board' : 'Goals'}
      </Link>
      <button type="button" onClick={onClose} className="rounded-md p-1 text-zinc-500 hover:text-zinc-200" aria-label="Close details">
        <X className="h-4 w-4" />
      </button>
    </div>
  );
}

function AddMilestone({
  lanes, saving, onCancel, onSave,
}: {
  lanes: string[];
  saving: boolean;
  onCancel: () => void;
  onSave: (v: { title: string; due: string; lane: string }) => void;
}) {
  const [title, setTitle] = useState('');
  const [due, setDue] = useState(() => toInputDay(Date.now() + 7 * DAY));
  const [lane, setLane] = useState(lanes[0] ?? 'Milestones');
  const ref = useRef<HTMLInputElement>(null);
  useEffect(() => { ref.current?.focus(); }, []);
  const submit = () => { if (title.trim() && due) onSave({ title: title.trim(), due, lane: lane.trim() || 'Milestones' }); };
  return (
    <div className="fixed bottom-28 right-8 z-30 w-[380px] rounded-2xl border border-white/10 bg-[#141414] p-4 shadow-2xl" role="dialog" aria-label="Add milestone">
      <input
        ref={ref}
        value={title}
        onChange={(e) => setTitle(e.target.value)}
        onKeyDown={(e) => { if (e.key === 'Enter') submit(); if (e.key === 'Escape') onCancel(); }}
        placeholder="Milestone"
        aria-label="Milestone title"
        className="w-full bg-transparent text-[15px] text-zinc-100 placeholder:text-zinc-500 focus:outline-none"
      />
      <div className="mt-3 flex items-center gap-2">
        <input
          type="date"
          value={due}
          onChange={(e) => setDue(e.target.value)}
          aria-label="Due date"
          className="rounded-md border border-white/10 bg-transparent px-2 py-1 text-[13px] text-zinc-200 [color-scheme:dark]"
        />
        <input
          value={lane}
          onChange={(e) => setLane(e.target.value)}
          list="timeline-lanes"
          placeholder="Lane"
          aria-label="Lane"
          className="min-w-0 flex-1 rounded-md border border-white/10 bg-transparent px-2 py-1 text-[13px] text-zinc-200 placeholder:text-zinc-600"
        />
        <datalist id="timeline-lanes">
          {lanes.map((l) => <option key={l} value={l} />)}
        </datalist>
      </div>
      <div className="mt-4 flex justify-end gap-2">
        <button type="button" onClick={onCancel} className="rounded-full px-3 py-1.5 text-[13px] text-zinc-400 hover:text-zinc-200">
          Cancel
        </button>
        <button
          type="button"
          onClick={submit}
          disabled={!title.trim() || saving}
          className="rounded-full bg-teal-400 px-4 py-1.5 text-[13px] font-medium text-black hover:bg-teal-300 disabled:opacity-50"
        >
          {saving ? 'Adding…' : 'Add'}
        </button>
      </div>
    </div>
  );
}

export default TimelineRoadmap;
