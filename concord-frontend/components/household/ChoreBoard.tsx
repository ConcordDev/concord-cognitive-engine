'use client';

/**
 * ChoreBoard — Tody / Sweepy 2026-shape condition-based cleaning: rooms
 * with recurring tasks that "get dirty" over time, a prioritised cross-
 * room board, an assignee leaderboard and a vacation pause. Wires the
 * household.room-*, household.task-*, household.chore-board,
 * household.assignee-leaderboard and household.vacation-toggle macros.
 */

import { useCallback, useEffect, useState } from 'react';
import { Home, Plus, Trash2, Check, Trophy, Pause, Play, Loader2 } from 'lucide-react';
import { lensRun } from '@/lib/api/client';
import { cn } from '@/lib/utils';

interface Room { id: string; name: string; taskCount: number }
interface Condition { ratio: number; state: string; daysOverdue: number }
interface BoardTask { id: string; name: string; room: string; assignee: string | null; effort: string; condition: Condition }
interface Leader { person: string; points: number; choresDone: number }
interface Dash { rooms: number; tasks: number; cleanlinessPct: number; needsAttention: number; paused: boolean }

const STATE_COLOR: Record<string, string> = {
  needs_attention: 'bg-rose-500',
  getting_dirty: 'bg-amber-500',
  clean: 'bg-emerald-500',
};

export function ChoreBoard() {
  const [rooms, setRooms] = useState<Room[]>([]);
  const [board, setBoard] = useState<BoardTask[]>([]);
  const [leaders, setLeaders] = useState<Leader[]>([]);
  const [dash, setDash] = useState<Dash | null>(null);
  const [loading, setLoading] = useState(true);
  const [newRoom, setNewRoom] = useState('');
  const [taskForm, setTaskForm] = useState({ roomId: '', name: '', intervalDays: 7, effort: 'medium', assignee: '' });

  const refresh = useCallback(async () => {
    const [rl, cb, lb, d] = await Promise.all([
      lensRun('household', 'room-list', {}),
      lensRun('household', 'chore-board', {}),
      lensRun('household', 'assignee-leaderboard', {}),
      lensRun('household', 'household-dashboard', {}),
    ]);
    setRooms((rl.data?.result?.rooms as Room[]) || []);
    setBoard((cb.data?.result?.board as BoardTask[]) || []);
    setLeaders((lb.data?.result?.leaderboard as Leader[]) || []);
    setDash((d.data?.result as Dash) || null);
    setLoading(false);
  }, []);
  useEffect(() => { void refresh(); }, [refresh]);

  async function addRoom() {
    if (!newRoom.trim()) return;
    await lensRun('household', 'room-create', { name: newRoom.trim() });
    setNewRoom('');
    await refresh();
  }
  async function delRoom(id: string) {
    if (!confirm('Delete this room and its chores?')) return;
    await lensRun('household', 'room-delete', { id });
    await refresh();
  }
  async function addTask() {
    if (!taskForm.roomId || !taskForm.name.trim()) return;
    await lensRun('household', 'task-create', {
      roomId: taskForm.roomId, name: taskForm.name.trim(),
      intervalDays: taskForm.intervalDays, effort: taskForm.effort, assignee: taskForm.assignee.trim(),
    });
    setTaskForm({ ...taskForm, name: '', assignee: '' });
    await refresh();
  }
  async function doneTask(id: string) {
    await lensRun('household', 'task-done', { id });
    await refresh();
  }
  async function delTask(id: string) {
    await lensRun('household', 'task-delete', { id });
    await refresh();
  }
  async function toggleVacation() {
    await lensRun('household', 'vacation-toggle', { on: !dash?.paused });
    await refresh();
  }

  if (loading) return <div className="flex items-center justify-center py-6 text-zinc-400"><Loader2 className="w-4 h-4 animate-spin" /></div>;

  return (
    <div>
      <div className="flex items-center gap-2 mb-3">
        <Home className="w-4 h-4 text-teal-400" />
        <h3 className="text-sm font-bold text-zinc-100">Chore Board</h3>
        <span className="text-[11px] text-zinc-400">Tody shape</span>
        <button onClick={toggleVacation}
          className={cn('ml-auto px-2.5 py-1 text-xs rounded-lg inline-flex items-center gap-1',
            dash?.paused ? 'bg-amber-600 text-white' : 'border border-zinc-700 text-zinc-300 hover:bg-zinc-800')}>
          {dash?.paused ? <><Play className="w-3 h-3" />Resume</> : <><Pause className="w-3 h-3" />Vacation</>}
        </button>
      </div>

      {dash && (
        <div className="grid grid-cols-4 gap-2 mb-3">
          {([['Clean', `${dash.cleanlinessPct}%`], ['Rooms', dash.rooms], ['Chores', dash.tasks], ['Urgent', dash.needsAttention]] as const).map(([l, v]) => (
            <div key={l} className="bg-zinc-900/60 border border-zinc-800 rounded-lg px-2 py-1.5 text-center">
              <p className="text-sm font-bold text-zinc-100">{v}</p>
              <p className="text-[9px] text-zinc-400 uppercase tracking-wide">{l}</p>
            </div>
          ))}
        </div>
      )}

      {/* Add room + task */}
      <div className="bg-zinc-900/60 border border-zinc-800 rounded-lg p-2.5 mb-3 space-y-1.5">
        <div className="flex gap-1.5">
          <input value={newRoom} onChange={e => setNewRoom(e.target.value)} onKeyDown={e => { if (e.key === 'Enter') void addRoom(); }}
            placeholder="New room" className="flex-1 bg-zinc-950 border border-zinc-800 rounded px-2 py-1 text-xs text-zinc-200" />
          <button aria-label="Add" onClick={addRoom} className="px-2 py-1 rounded bg-teal-700 hover:bg-teal-600 text-white"><Plus className="w-3.5 h-3.5" /></button>
        </div>
        {rooms.length > 0 && (
          <div className="flex gap-1.5 flex-wrap">
            <select value={taskForm.roomId} onChange={e => setTaskForm({ ...taskForm, roomId: e.target.value })}
              className="bg-zinc-950 border border-zinc-800 rounded px-1.5 py-1 text-xs text-zinc-200">
              <option value="">Room…</option>
              {rooms.map(r => <option key={r.id} value={r.id}>{r.name}</option>)}
            </select>
            <input value={taskForm.name} onChange={e => setTaskForm({ ...taskForm, name: e.target.value })} placeholder="Chore name"
              className="flex-1 min-w-[120px] bg-zinc-950 border border-zinc-800 rounded px-2 py-1 text-xs text-zinc-200" />
            <select value={taskForm.intervalDays} onChange={e => setTaskForm({ ...taskForm, intervalDays: Number(e.target.value) })}
              className="bg-zinc-950 border border-zinc-800 rounded px-1.5 py-1 text-xs text-zinc-200">
              {[1, 3, 7, 14, 30, 90].map(d => <option key={d} value={d}>every {d}d</option>)}
            </select>
            <select value={taskForm.effort} onChange={e => setTaskForm({ ...taskForm, effort: e.target.value })}
              className="bg-zinc-950 border border-zinc-800 rounded px-1.5 py-1 text-xs text-zinc-200">
              <option value="light">light</option><option value="medium">medium</option><option value="heavy">heavy</option>
            </select>
            <input value={taskForm.assignee} onChange={e => setTaskForm({ ...taskForm, assignee: e.target.value })} placeholder="Who"
              className="w-20 bg-zinc-950 border border-zinc-800 rounded px-2 py-1 text-xs text-zinc-200" />
            <button onClick={addTask} disabled={!taskForm.roomId || !taskForm.name.trim()}
              className="px-2.5 py-1 text-xs rounded bg-teal-600 hover:bg-teal-500 text-white font-semibold disabled:opacity-40">Add chore</button>
          </div>
        )}
      </div>

      <div className="grid sm:grid-cols-[1fr_160px] gap-3">
        {/* Prioritised board */}
        <div>
          {board.length === 0 ? (
            <p className="text-xs text-zinc-400 italic">No chores yet — add rooms and chores above.</p>
          ) : (
            <ul className="space-y-1">
              {board.map(t => (
                <li key={t.id} className="group flex items-center gap-2 bg-zinc-900/60 border border-zinc-800 rounded-lg px-3 py-2">
                  <span className={cn('w-2 h-2 rounded-full shrink-0', STATE_COLOR[t.condition.state])} />
                  <div className="min-w-0 flex-1">
                    <p className="text-xs font-semibold text-zinc-100 truncate">{t.name}</p>
                    <p className="text-[10px] text-zinc-400">
                      {t.room}{t.assignee ? ` · ${t.assignee}` : ''} · {t.effort}
                      {t.condition.daysOverdue > 0 && <span className="text-rose-400"> · {t.condition.daysOverdue}d overdue</span>}
                    </p>
                  </div>
                  <button onClick={() => doneTask(t.id)} title="Mark done"
                    className="w-6 h-6 rounded-full bg-emerald-700/40 hover:bg-emerald-600 text-emerald-200 hover:text-white flex items-center justify-center">
                    <Check className="w-3.5 h-3.5" />
                  </button>
                  <button aria-label="Delete" onClick={() => delTask(t.id)} className="opacity-0 group-hover:opacity-100 text-rose-400"><Trash2 className="w-3 h-3" /></button>
                </li>
              ))}
            </ul>
          )}
        </div>

        {/* Leaderboard + rooms */}
        <div className="space-y-3">
          <div className="bg-zinc-900/60 border border-zinc-800 rounded-lg p-2">
            <p className="text-[10px] uppercase tracking-wide text-zinc-400 mb-1 inline-flex items-center gap-1"><Trophy className="w-3 h-3 text-amber-400" />Leaderboard</p>
            {leaders.length === 0 ? (
              <p className="text-[11px] text-zinc-400 italic">No chores logged.</p>
            ) : leaders.map((l, i) => (
              <div key={l.person} className="flex items-center gap-1 text-xs text-zinc-300">
                <span className="text-zinc-600 w-4">{i + 1}.</span>
                <span className="flex-1 truncate">{l.person}</span>
                <span className="text-amber-400 font-semibold">{l.points}</span>
              </div>
            ))}
          </div>
          <div className="bg-zinc-900/60 border border-zinc-800 rounded-lg p-2">
            <p className="text-[10px] uppercase tracking-wide text-zinc-400 mb-1">Rooms</p>
            {rooms.map(r => (
              <div key={r.id} className="group flex items-center gap-1 text-xs text-zinc-300">
                <span className="flex-1 truncate">{r.name}</span>
                <span className="text-zinc-600">{r.taskCount}</span>
                <button aria-label="Delete" onClick={() => delRoom(r.id)} className="opacity-0 group-hover:opacity-100 text-rose-400"><Trash2 className="w-3 h-3" /></button>
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}
