'use client';

/**
 * HrClockPanel — time / attendance clock. Clock employees in and out,
 * see open shifts and accumulated hours.
 */

import { useCallback, useEffect, useState } from 'react';
import { Loader2, LogIn, LogOut, Clock } from 'lucide-react';
import { lensRun } from '@/lib/api/client';
import { cn } from '@/lib/utils';

interface Employee { id: string; name: string }
interface ClockEntry {
  id: string; employeeId: string; employeeName: string;
  clockIn: string; clockOut: string | null; hours: number; note: string | null;
}

const fmtTime = (iso: string) => {
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? iso : d.toLocaleString([], { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' });
};

export function HrClockPanel() {
  const [employees, setEmployees] = useState<Employee[]>([]);
  const [entries, setEntries] = useState<ClockEntry[]>([]);
  const [totalHours, setTotalHours] = useState(0);
  const [openShifts, setOpenShifts] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [form, setForm] = useState({ employeeId: '', note: '' });

  const refresh = useCallback(async () => {
    setLoading(true);
    const [e, t] = await Promise.all([
      lensRun('hr', 'employee-list', {}),
      lensRun('hr', 'timeclock-list', {}),
    ]);
    setEmployees((e.data?.result?.employees as Employee[]) || []);
    setEntries((t.data?.result?.entries as ClockEntry[]) || []);
    setTotalHours((t.data?.result?.totalHours as number) || 0);
    setOpenShifts((t.data?.result?.openShifts as number) || 0);
    setLoading(false);
  }, []);

  useEffect(() => { void refresh(); }, [refresh]);

  const clockIn = async () => {
    if (!form.employeeId) { setError('Select an employee.'); return; }
    const r = await lensRun('hr', 'clock-in', { employeeId: form.employeeId, note: form.note.trim() || undefined });
    if (r.data?.ok === false) { setError(r.data?.error || 'Failed'); return; }
    setForm({ employeeId: '', note: '' });
    setError(null);
    await refresh();
  };
  const clockOut = async (entryId: string) => {
    const r = await lensRun('hr', 'clock-out', { id: entryId });
    if (r.data?.ok === false) { setError(r.data?.error || 'Failed'); return; }
    setError(null);
    await refresh();
  };

  if (loading) {
    return <div className="flex items-center justify-center py-10 text-zinc-400"><Loader2 className="w-5 h-5 animate-spin" /></div>;
  }

  return (
    <div className="space-y-4">
      {error && <div className="text-xs text-rose-400 bg-rose-950/40 border border-rose-900/50 rounded-lg px-3 py-2">{error}</div>}

      <div className="grid grid-cols-3 gap-2 bg-zinc-900/70 border border-zinc-800 rounded-xl p-3">
        <select value={form.employeeId} onChange={(e) => setForm({ ...form, employeeId: e.target.value })}
          className="bg-zinc-950 border border-zinc-700 rounded-lg px-2 py-1.5 text-xs text-zinc-100">
          <option value="">— employee —</option>
          {employees.map((e) => <option key={e.id} value={e.id}>{e.name}</option>)}
        </select>
        <input placeholder="Shift note (optional)" value={form.note} onChange={(e) => setForm({ ...form, note: e.target.value })}
          className="bg-zinc-950 border border-zinc-700 rounded-lg px-2 py-1.5 text-xs text-zinc-100" />
        <button type="button" onClick={clockIn}
          className="flex items-center justify-center gap-1 bg-emerald-600 hover:bg-emerald-500 text-white text-xs font-medium rounded-lg px-2 py-1.5">
          <LogIn className="w-3.5 h-3.5" /> Clock in
        </button>
      </div>

      <div className="grid grid-cols-2 gap-2">
        <div className="bg-zinc-900/70 border border-zinc-800 rounded-lg p-2 text-center">
          <p className="text-lg font-bold text-amber-400">{openShifts}</p>
          <p className="text-[10px] text-zinc-400 uppercase tracking-wide">Open shifts</p>
        </div>
        <div className="bg-zinc-900/70 border border-zinc-800 rounded-lg p-2 text-center">
          <p className="text-lg font-bold text-zinc-100">{totalHours}</p>
          <p className="text-[10px] text-zinc-400 uppercase tracking-wide">Total hours logged</p>
        </div>
      </div>

      <section>
        <h3 className="text-xs font-semibold text-zinc-300 mb-2">Time entries</h3>
        {entries.length === 0 ? (
          <p className="text-[11px] text-zinc-400 italic">No clock entries yet.</p>
        ) : (
          <ul className="space-y-1">
            {entries.map((en) => (
              <li key={en.id} className="flex items-center justify-between bg-zinc-900/70 border border-zinc-800 rounded-lg px-3 py-2">
                <div className="flex items-center gap-2">
                  <Clock className={cn('w-3.5 h-3.5', en.clockOut ? 'text-zinc-400' : 'text-emerald-400')} />
                  <div>
                    <p className="text-xs text-zinc-200">{en.employeeName}</p>
                    <p className="text-[10px] text-zinc-400">
                      {fmtTime(en.clockIn)}{en.clockOut ? ` → ${fmtTime(en.clockOut)} · ${en.hours}h` : ''}
                      {en.note ? ` · ${en.note}` : ''}
                    </p>
                  </div>
                </div>
                {!en.clockOut ? (
                  <button type="button" onClick={() => clockOut(en.id)}
                    className="flex items-center gap-1 text-[10px] px-2 py-1 rounded bg-rose-700/30 text-rose-300">
                    <LogOut className="w-3 h-3" /> Clock out
                  </button>
                ) : (
                  <span className="text-[10px] text-emerald-300 font-semibold">{en.hours}h</span>
                )}
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}
