'use client';

/**
 * JobDispatchBoard — the field-service scheduling surface for the
 * landscaping lens. Landscaping's other tabs are design + calculation +
 * record-keeping (beds, layouts, proposals, diary) — none of them model
 * an actual scheduled/dispatched job. This wires the
 * job-schedule / job-list / job-complete triple in
 * server/domains/landscaping.js (mirroring plumbing's
 * dispatchAssign/dispatchBoard/jobComplete) into a real crew dispatch
 * board: a scheduling form, per-crew lanes with load-hour totals, an
 * unassigned lane, and a status/date-range filterable job list.
 */

import { useCallback, useEffect, useMemo, useState } from 'react';
import { lensRun } from '@/lib/api/client';
import { ChartKit } from '@/components/viz';
import { CalendarClock, Plus, Loader2, CheckCircle2, AlertTriangle, Users } from 'lucide-react';

interface Job {
  id: string;
  title: string;
  client: string;
  address: string;
  proposalId: string | null;
  bedId: string | null;
  crew: string;
  date: string;
  startHour: number;
  durationHours: number;
  notes: string;
  status: 'scheduled' | 'in_progress' | 'completed' | 'cancelled';
  completedAt?: string;
  completionNotes?: string;
  createdAt: string;
}
interface Lane { crew: string; jobs: Job[]; loadHours: number; }
interface Bed { id: string; name: string; }
interface JobBoard {
  jobs: Job[];
  count: number;
  lanes: Lane[];
  unassigned: Job[];
  scheduledCount: number;
  inProgressCount: number;
  completedCount: number;
  cancelledCount: number;
}

const STATUS_STYLE: Record<string, string> = {
  scheduled: 'bg-sky-500/15 text-sky-300',
  in_progress: 'bg-amber-500/15 text-amber-300',
  completed: 'bg-emerald-500/15 text-emerald-300',
  cancelled: 'bg-zinc-800 text-zinc-400',
};

const inputCls =
  'w-full rounded-md border border-zinc-800 bg-zinc-950 px-2.5 py-1.5 text-sm text-white outline-none focus:border-emerald-500/40';
const btnCls =
  'inline-flex items-center gap-1.5 rounded-md border border-emerald-500/30 bg-emerald-500/10 px-3 py-1.5 text-xs text-emerald-200 hover:bg-emerald-500/20 disabled:opacity-50';

export function JobDispatchBoard() {
  const [board, setBoard] = useState<JobBoard | null>(null);
  const [beds, setBeds] = useState<Bed[]>([]);
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const [statusFilter, setStatusFilter] = useState('');
  const [dateFrom, setDateFrom] = useState('');
  const [dateTo, setDateTo] = useState('');

  const [title, setTitle] = useState('');
  const [client, setClient] = useState('');
  const [address, setAddress] = useState('');
  const [crew, setCrew] = useState('');
  const [bedId, setBedId] = useState('');
  const [date, setDate] = useState(() => new Date().toISOString().slice(0, 10));
  const [startHour, setStartHour] = useState('8');
  const [durationHours, setDurationHours] = useState('2');
  const [notes, setNotes] = useState('');

  const load = useCallback(async () => {
    setErr(null);
    const params: Record<string, string> = {};
    if (statusFilter) params.status = statusFilter;
    if (dateFrom) params.dateFrom = dateFrom;
    if (dateTo) params.dateTo = dateTo;
    const [boardRes, bedRes] = await Promise.all([
      lensRun<JobBoard>('landscaping', 'job-list', params),
      lensRun<{ beds: Bed[] }>('landscaping', 'bed-list', {}),
    ]);
    if (boardRes.data.ok && boardRes.data.result) setBoard(boardRes.data.result);
    else setErr(boardRes.data.error || 'failed to load jobs');
    if (bedRes.data.ok && bedRes.data.result) setBeds(bedRes.data.result.beds);
  }, [statusFilter, dateFrom, dateTo]);

  useEffect(() => {
    load();
  }, [load]);

  const scheduleJob = async () => {
    if (!title.trim()) { setErr('Job title required'); return; }
    setBusy(true);
    const r = await lensRun('landscaping', 'job-schedule', {
      title: title.trim(), client, address, crew,
      bedId: bedId || undefined, date, startHour: Number(startHour) || 8,
      durationHours: Number(durationHours) || 2, notes,
    });
    setBusy(false);
    if (r.data.ok) {
      setTitle(''); setClient(''); setAddress(''); setNotes('');
      await load();
    } else setErr(r.data.error || 'job-schedule failed');
  };

  const completeJob = async (id: string) => {
    setBusy(true);
    const notesPrompt = typeof window !== 'undefined' ? window.prompt('Completion notes (optional)', '') : '';
    const r = await lensRun('landscaping', 'job-complete', { id, notes: notesPrompt || undefined });
    setBusy(false);
    if (!r.data.ok) setErr(r.data.error || 'job-complete failed');
    await load();
  };

  const loadChart = useMemo(
    () => (board?.lanes ?? []).map((l) => ({ crew: l.crew, hours: l.loadHours, jobs: l.jobs.length })),
    [board],
  );

  return (
    <div className="space-y-4">
      <header className="flex items-center gap-2 border-b border-emerald-500/15 pb-3">
        <CalendarClock className="h-5 w-5 text-emerald-400" />
        <h2 className="text-sm font-semibold text-white">Job Dispatch Board</h2>
        <span className="rounded bg-zinc-800 px-1.5 py-0.5 font-mono text-[10px] uppercase tracking-wider text-zinc-400">
          schedule · crew lanes · complete
        </span>
      </header>

      {err && (
        <div className="flex items-center gap-2 rounded border border-red-500/20 bg-red-500/5 px-3 py-2 text-xs text-red-300">
          <AlertTriangle className="h-3.5 w-3.5" /> {err}
        </div>
      )}

      {board && (
        <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
          <Stat label="Scheduled" value={String(board.scheduledCount)} />
          <Stat label="In progress" value={String(board.inProgressCount)} />
          <Stat label="Completed" value={String(board.completedCount)} />
          <Stat label="Unassigned" value={String(board.unassigned.length)} tone={board.unassigned.length > 0 ? 'warn' : undefined} />
        </div>
      )}

      <div className="rounded-lg border border-zinc-800 bg-zinc-950/60 p-3">
        <p className="mb-2 flex items-center gap-1 text-[10px] uppercase tracking-wider text-emerald-400">
          <Plus className="h-3 w-3" /> Schedule a job
        </p>
        <div className="grid grid-cols-2 gap-2 md:grid-cols-4">
          <input className={`${inputCls} md:col-span-2`} placeholder="Job title" value={title} onChange={(e) => setTitle(e.target.value)} />
          <input className={inputCls} placeholder="Client" value={client} onChange={(e) => setClient(e.target.value)} />
          <input className={inputCls} placeholder="Address" value={address} onChange={(e) => setAddress(e.target.value)} />
          <input className={inputCls} placeholder="Crew (e.g. Crew A)" value={crew} onChange={(e) => setCrew(e.target.value)} />
          <select className={inputCls} value={bedId} onChange={(e) => setBedId(e.target.value)}>
            <option value="">No bed link</option>
            {beds.map((b) => <option key={b.id} value={b.id}>{b.name}</option>)}
          </select>
          <input type="date" className={inputCls} value={date} onChange={(e) => setDate(e.target.value)} />
          <div className="flex gap-1.5">
            <input type="number" className={inputCls} placeholder="Start hr" value={startHour} onChange={(e) => setStartHour(e.target.value)} />
            <input type="number" step="0.5" className={inputCls} placeholder="Duration hr" value={durationHours} onChange={(e) => setDurationHours(e.target.value)} />
          </div>
          <input className={`${inputCls} md:col-span-4`} placeholder="Notes" value={notes} onChange={(e) => setNotes(e.target.value)} />
        </div>
        <button onClick={scheduleJob} disabled={!title.trim() || busy} className={`${btnCls} mt-2`}>
          {busy ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Plus className="h-3.5 w-3.5" />} Schedule job
        </button>
      </div>

      <div className="flex flex-wrap items-end gap-2">
        <div className="w-40">
          <label className="text-[10px] uppercase tracking-wider text-zinc-400">Status</label>
          <select className={inputCls} value={statusFilter} onChange={(e) => setStatusFilter(e.target.value)}>
            <option value="">All</option>
            <option value="scheduled">Scheduled</option>
            <option value="in_progress">In progress</option>
            <option value="completed">Completed</option>
            <option value="cancelled">Cancelled</option>
          </select>
        </div>
        <div className="w-36">
          <label className="text-[10px] uppercase tracking-wider text-zinc-400">From</label>
          <input type="date" className={inputCls} value={dateFrom} onChange={(e) => setDateFrom(e.target.value)} />
        </div>
        <div className="w-36">
          <label className="text-[10px] uppercase tracking-wider text-zinc-400">To</label>
          <input type="date" className={inputCls} value={dateTo} onChange={(e) => setDateTo(e.target.value)} />
        </div>
      </div>

      {loadChart.length > 0 && (
        <div className="rounded-lg border border-zinc-800 bg-zinc-950/60 p-3">
          <p className="mb-2 text-[10px] uppercase tracking-wider text-emerald-400">Crew load (hours scheduled)</p>
          <ChartKit
            kind="bar"
            data={loadChart}
            xKey="crew"
            series={[
              { key: 'hours', label: 'Hours', color: '#22c55e' },
              { key: 'jobs', label: 'Jobs', color: '#0ea5e9' },
            ]}
            height={180}
          />
        </div>
      )}

      <div className="space-y-3">
        {(board?.lanes ?? []).map((lane) => (
          <div key={lane.crew} className="rounded-lg border border-zinc-800">
            <div className="flex items-center justify-between border-b border-zinc-800 px-3 py-1.5 text-xs">
              <span className="flex items-center gap-1.5 font-medium text-white">
                <Users className="h-3.5 w-3.5 text-emerald-400" /> {lane.crew}
              </span>
              <span className="text-zinc-400">{lane.loadHours}h scheduled</span>
            </div>
            <div className="divide-y divide-zinc-900">
              {lane.jobs.map((j) => <JobRow key={j.id} job={j} onComplete={completeJob} />)}
            </div>
          </div>
        ))}

        {board && board.unassigned.length > 0 && (
          <div className="rounded-lg border border-amber-500/30">
            <div className="border-b border-amber-500/20 px-3 py-1.5 text-xs font-medium text-amber-300">
              Unassigned ({board.unassigned.length})
            </div>
            <div className="divide-y divide-zinc-900">
              {board.unassigned.map((j) => <JobRow key={j.id} job={j} onComplete={completeJob} />)}
            </div>
          </div>
        )}

        {board && board.lanes.length === 0 && board.unassigned.length === 0 && (
          <p className="rounded border border-dashed border-zinc-800 p-4 text-center text-[11px] text-zinc-400">
            No jobs match this filter. Schedule one above to start the dispatch board.
          </p>
        )}
      </div>
    </div>
  );
}

function JobRow({ job, onComplete }: { job: Job; onComplete: (id: string) => void }) {
  return (
    <div className="flex items-center justify-between gap-2 px-3 py-2 text-xs">
      <div className="min-w-0">
        <span className="font-medium text-white">{job.title}</span>
        <span className={`ml-2 rounded px-1.5 py-0.5 text-[10px] ${STATUS_STYLE[job.status] || 'bg-zinc-800 text-zinc-300'}`}>
          {job.status.replace('_', ' ')}
        </span>
        <div className="truncate text-zinc-400">
          {job.client || 'No client'} · {job.address || 'no address'} · {job.date} {job.startHour}:00 ({job.durationHours}h)
        </div>
        {job.status === 'completed' && job.completionNotes && (
          <div className="mt-0.5 truncate text-[11px] text-emerald-300/80">✓ {job.completionNotes}</div>
        )}
      </div>
      {job.status !== 'completed' && job.status !== 'cancelled' && (
        <button
          onClick={() => onComplete(job.id)}
          className="inline-flex shrink-0 items-center gap-1 rounded bg-emerald-600 px-2 py-1 text-[11px] font-medium text-white hover:bg-emerald-500"
        >
          <CheckCircle2 className="h-3 w-3" /> Complete
        </button>
      )}
    </div>
  );
}

function Stat({ label, value, tone }: { label: string; value: string; tone?: 'warn' }) {
  const color = tone === 'warn' ? 'text-amber-300' : 'text-emerald-300';
  return (
    <div className="rounded border border-zinc-800 bg-zinc-950 px-2.5 py-1.5">
      <div className="text-[10px] uppercase tracking-wider text-zinc-400">{label}</div>
      <div className={`mt-0.5 font-mono text-sm ${color}`}>{value}</div>
    </div>
  );
}
