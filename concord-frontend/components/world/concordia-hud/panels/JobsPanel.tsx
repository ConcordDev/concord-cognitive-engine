'use client';
import { useCallback, useEffect, useState } from 'react';
import { macro } from './_macro';

export function JobsPanel() {
  const [emp, setEmp] = useState<{ job_id: string | null; demographic_kind: string; shifts_completed: number } | null>(null);
  const [jobs, setJobs] = useState<Array<{ id: string; name: string; wage_sparks: number }>>([]);
  const [rations, setRations] = useState<Array<{ demographic_kind: string; monthly_sparks: number }>>([]);
  const refresh = useCallback(async () => {
    const [e, j, r] = await Promise.all([macro('jobs', 'my_employment'), macro('jobs', 'list'), macro('jobs', 'rations_table')]);
    if (e?.ok) setEmp(e.employment);
    if (j?.ok) setJobs(j.jobs || []);
    if (r?.ok) setRations(r.entitlements || []);
  }, []);
  useEffect(() => { void refresh(); }, [refresh]);
  return (
    <div className="text-sm">
      <h3 className="text-xs uppercase tracking-wider text-zinc-400 mb-2">My job</h3>
      {emp?.job_id ? (
        <div className="flex items-center justify-between mb-3 bg-zinc-900/50 border border-zinc-800 rounded p-2">
          <span className="text-zinc-200">{emp.job_id}</span><span className="text-xs text-zinc-400">{emp.shifts_completed} shifts</span>
          <button type="button" onClick={async () => { const r = await macro('jobs', 'complete_shift'); if (r?.ok) refresh(); }} aria-label="Complete shift" className="text-[10px] px-1.5 py-0.5 rounded bg-emerald-800 hover:bg-emerald-700 text-emerald-100">+shift</button>
        </div>
      ) : <p className="text-zinc-400 text-xs italic mb-3">Unemployed. Pick a job below.</p>}
      <h3 className="text-xs uppercase tracking-wider text-zinc-400 mb-2">Open positions</h3>
      <ul className="space-y-1 mb-3">
        {jobs.map((j) => (
          <li key={j.id} className="flex items-center justify-between bg-zinc-900/50 border border-zinc-800 rounded p-2">
            <span className="text-xs text-zinc-200">{j.name}</span>
            <span className="text-xs text-amber-300 font-mono">{j.wage_sparks}</span>
            <button type="button" onClick={async () => { await macro('jobs', 'apply', { jobId: j.id }); refresh(); }} aria-label={`Apply for ${j.name}`} className="text-[10px] px-1.5 py-0.5 rounded bg-amber-700 hover:bg-amber-600 text-white">apply</button>
          </li>
        ))}
      </ul>
      <h3 className="text-xs uppercase tracking-wider text-zinc-400 mb-2">Ration floor</h3>
      <ul className="grid grid-cols-2 gap-1 text-[10px]">
        {rations.map((r) => (
          <li key={r.demographic_kind} className="bg-zinc-900/40 border border-zinc-800 rounded p-1.5 flex items-center justify-between">
            <span className="text-zinc-300">{r.demographic_kind}</span><span className="text-amber-300 font-mono">{r.monthly_sparks}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}
