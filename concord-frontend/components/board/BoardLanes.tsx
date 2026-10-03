'use client';

/**
 * BoardLanes — the Board view per its north-star concept
 * (docs/lens-northstar/04-board-northstar-concept.jpg): a serif greeting,
 * three lanes (To Do · Doing · Done) of real board.task artifacts, and one
 * floating "+ Add task".
 *
 * Wiring (all real, via TasksPanel's useLensData('board','task')):
 *   - cards  = persisted tasks; the pill shows the task's actual status
 *   - drag a card to a lane → onMove(status) → task artifact update
 *   - click / Enter on a card → onOpen → the existing TaskDetailPanel
 *   - "+ Add task" → inline title field at the top of To Do → onAdd → create
 * The six stored statuses fold into three lanes; nothing is invented.
 */

import { useEffect, useRef, useState } from 'react';
import { Plus } from 'lucide-react';
import { cn } from '@/lib/utils';
import { columns, type ColumnId, type Task } from './board-shared';

type LaneId = 'todo' | 'doing' | 'done';

const LANES: { id: LaneId; name: string; dot: string; statuses: ColumnId[]; dropStatus: ColumnId }[] = [
  { id: 'todo', name: 'To Do', dot: 'bg-zinc-400', statuses: ['backlog', 'todo'], dropStatus: 'todo' },
  { id: 'doing', name: 'Doing', dot: 'bg-zinc-400', statuses: ['in_progress', 'in_review', 'testing'], dropStatus: 'in_progress' },
  { id: 'done', name: 'Done', dot: 'bg-teal-400', statuses: ['done'], dropStatus: 'done' },
];

/** Pill tone per real stored status. */
const STATUS_PILL: Record<string, string> = {
  backlog: 'bg-violet-400',
  todo: 'bg-violet-400',
  in_progress: 'bg-teal-400',
  in_review: 'bg-teal-400',
  testing: 'bg-teal-400',
  done: 'bg-teal-400',
};

const statusName = (s: ColumnId) => columns.find((c) => c.id === s)?.name ?? s;

export function BoardLanes({
  tasks,
  onOpen,
  onMove,
  onAdd,
}: {
  tasks: Task[];
  onOpen: (task: Task) => void;
  onMove: (taskId: string, status: ColumnId) => void;
  onAdd: (title: string) => void;
}) {
  const [adding, setAdding] = useState(false);
  const [draft, setDraft] = useState('');
  const [over, setOver] = useState<LaneId | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => { if (adding) inputRef.current?.focus(); }, [adding]);

  const submit = () => {
    const title = draft.trim();
    if (title) onAdd(title);
    setDraft('');
    setAdding(false);
  };

  return (
    <div className="relative flex-1 overflow-y-auto px-8 pb-28 pt-4">
      <div className="mt-2 grid grid-cols-1 gap-4 md:grid-cols-3">
        {LANES.map((lane) => {
          const laneTasks = tasks.filter((t) => lane.statuses.includes(t.status));
          return (
            <section
              key={lane.id}
              aria-label={`${lane.name} lane`}
              onDragOver={(e) => { e.preventDefault(); e.dataTransfer.dropEffect = 'move'; setOver(lane.id); }}
              onDragLeave={() => setOver((o) => (o === lane.id ? null : o))}
              onDrop={(e) => {
                e.preventDefault();
                const id = e.dataTransfer.getData('taskId');
                if (id) onMove(id, lane.dropStatus);
                setOver(null);
              }}
              className={cn(
                'flex min-h-[320px] flex-col rounded-2xl border bg-white/[0.015] p-4 transition-colors',
                over === lane.id ? 'border-teal-400/40 bg-teal-400/[0.03]' : 'border-white/[0.08]',
              )}
            >
              <header className="mb-3 flex items-center gap-2 px-1">
                <span className={cn('h-2 w-2 rounded-full', lane.dot)} aria-hidden="true" />
                <h2 className="text-[15px] text-zinc-200">{lane.name}</h2>
                <span className="ml-auto text-[13px] text-zinc-500">{laneTasks.length}</span>
              </header>

              {lane.id === 'todo' && adding && (
                <input
                  ref={inputRef}
                  value={draft}
                  onChange={(e) => setDraft(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') submit();
                    if (e.key === 'Escape') { setDraft(''); setAdding(false); }
                  }}
                  onBlur={submit}
                  placeholder="Task title, then Enter"
                  aria-label="New task title"
                  className="mb-3 w-full rounded-xl border border-teal-400/30 bg-black/40 px-4 py-3 text-[14px] text-zinc-100 placeholder:text-zinc-500 focus:outline-none"
                />
              )}

              <div className="flex flex-col gap-3">
                {laneTasks.map((task) => (
                  <article
                    key={task.id}
                    role="button"
                    tabIndex={0}
                    draggable
                    onDragStart={(e) => { e.dataTransfer.setData('taskId', task.id); e.dataTransfer.effectAllowed = 'move'; }}
                    onClick={() => onOpen(task)}
                    onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onOpen(task); } }}
                    className="cursor-pointer rounded-xl border border-white/[0.08] bg-white/[0.03] p-4 transition-colors hover:border-white/15 hover:bg-white/[0.05] focus:outline-none focus-visible:ring-1 focus-visible:ring-teal-400/50"
                  >
                    <h3 className="text-[15px] font-medium text-zinc-100">{task.title}</h3>
                    {task.description && (
                      <p className="mt-1.5 line-clamp-2 text-[13px] leading-relaxed text-zinc-400">{task.description}</p>
                    )}
                    <span className="mt-3 inline-flex items-center gap-1.5 rounded-full border border-white/[0.08] bg-white/[0.03] px-2.5 py-1 text-[12px] text-zinc-300">
                      <span className={cn('h-1.5 w-1.5 rounded-full', STATUS_PILL[task.status] ?? 'bg-zinc-400')} aria-hidden="true" />
                      {statusName(task.status)}
                    </span>
                  </article>
                ))}
                {laneTasks.length === 0 && !(lane.id === 'todo' && adding) && (
                  <p className="px-1 pt-2 text-[13px] text-zinc-600">
                    {lane.id === 'todo' ? 'Nothing queued.' : lane.id === 'doing' ? 'Drag a task here to start it.' : 'Finished work lands here.'}
                  </p>
                )}
              </div>
            </section>
          );
        })}
      </div>

      <button
        type="button"
        onClick={() => setAdding(true)}
        className="fixed bottom-8 right-8 z-30 inline-flex items-center gap-2 rounded-full bg-teal-400 px-6 py-3.5 text-[15px] font-medium text-black shadow-[0_8px_32px_rgba(45,212,191,0.25)] transition-colors hover:bg-teal-300"
        aria-label="Add task"
      >
        <Plus className="h-4 w-4" />
        Add task
      </button>
    </div>
  );
}

export default BoardLanes;
