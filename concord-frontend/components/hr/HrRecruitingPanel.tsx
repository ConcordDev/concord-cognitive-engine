'use client';

/**
 * HrRecruitingPanel — job requisitions and an applicant pipeline.
 */

import { useCallback, useEffect, useState } from 'react';
import { Loader2, Plus, Briefcase, ChevronLeft } from 'lucide-react';
import { lensRun } from '@/lib/api/client';
import { cn } from '@/lib/utils';

interface Job { id: string; title: string; department: string; status: string; applicantCount: number }
interface Applicant { id: string; name: string; email: string | null; stage: string }

const STAGES = ['applied', 'screening', 'interview', 'offer', 'hired', 'rejected'];
const STAGE_COLOR: Record<string, string> = {
  applied: 'text-zinc-400', screening: 'text-sky-400', interview: 'text-amber-400',
  offer: 'text-violet-400', hired: 'text-emerald-400', rejected: 'text-rose-400',
};

export function HrRecruitingPanel({ onChange }: { onChange: () => void }) {
  const [jobs, setJobs] = useState<Job[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [form, setForm] = useState({ title: '', department: '', location: '' });
  const [selected, setSelected] = useState<Job | null>(null);
  const [applicants, setApplicants] = useState<Applicant[]>([]);
  const [appForm, setAppForm] = useState({ name: '', email: '' });

  const refresh = useCallback(async () => {
    setLoading(true);
    const r = await lensRun('hr', 'job-list', {});
    setJobs(r.data?.result?.jobs || []);
    setLoading(false);
    onChange();
  }, [onChange]);

  useEffect(() => { void refresh(); }, [refresh]);

  const openJob = useCallback(async (job: Job) => {
    setSelected(job);
    const r = await lensRun('hr', 'applicant-list', { jobId: job.id });
    setApplicants(r.data?.result?.applicants || []);
  }, []);

  const postJob = async () => {
    if (!form.title.trim()) { setError('Job title is required.'); return; }
    const r = await lensRun('hr', 'job-post', {
      title: form.title.trim(), department: form.department.trim(), location: form.location.trim(),
    });
    if (r.data?.ok === false) { setError(r.data?.error || 'Failed'); return; }
    setForm({ title: '', department: '', location: '' });
    setError(null);
    await refresh();
  };
  const addApplicant = async () => {
    if (!selected || !appForm.name.trim()) { setError('Applicant name is required.'); return; }
    await lensRun('hr', 'applicant-add', { jobId: selected.id, name: appForm.name.trim(), email: appForm.email.trim() });
    setAppForm({ name: '', email: '' });
    setError(null);
    await openJob(selected);
    await refresh();
  };
  const advance = async (id: string, stage: string) => {
    if (!selected) return;
    await lensRun('hr', 'applicant-advance', { id, stage });
    await openJob(selected);
  };

  if (loading) {
    return <div className="flex items-center justify-center py-10 text-zinc-500"><Loader2 className="w-5 h-5 animate-spin" /></div>;
  }

  // ── Job detail / pipeline ──
  if (selected) {
    return (
      <div className="space-y-3">
        <button type="button" onClick={() => setSelected(null)}
          className="flex items-center gap-1 text-xs text-zinc-400 hover:text-zinc-200">
          <ChevronLeft className="w-3.5 h-3.5" /> All jobs
        </button>
        <div className="bg-zinc-900/70 border border-zinc-800 rounded-xl p-3">
          <h3 className="text-sm font-bold text-zinc-100">{selected.title}</h3>
          <p className="text-[11px] text-zinc-500">{selected.department} · {applicants.length} applicants</p>
        </div>

        {error && <div className="text-xs text-rose-400 bg-rose-950/40 border border-rose-900/50 rounded-lg px-3 py-2">{error}</div>}

        <div className="flex gap-2">
          <input placeholder="Applicant name" value={appForm.name} onChange={(e) => setAppForm({ ...appForm, name: e.target.value })}
            className="flex-1 bg-zinc-950 border border-zinc-700 rounded-lg px-2 py-1.5 text-xs text-zinc-100" />
          <input placeholder="Email" value={appForm.email} onChange={(e) => setAppForm({ ...appForm, email: e.target.value })}
            className="flex-1 bg-zinc-950 border border-zinc-700 rounded-lg px-2 py-1.5 text-xs text-zinc-100" />
          <button type="button" onClick={addApplicant}
            className="px-2.5 py-1.5 text-xs bg-emerald-600 hover:bg-emerald-500 text-white rounded-lg">Add</button>
        </div>

        {applicants.length === 0 ? (
          <p className="text-[11px] text-zinc-500 italic">No applicants yet.</p>
        ) : (
          <ul className="space-y-2">
            {applicants.map((a) => (
              <li key={a.id} className="bg-zinc-900/70 border border-zinc-800 rounded-xl p-3">
                <div className="flex items-center justify-between">
                  <div>
                    <p className="text-sm font-semibold text-zinc-100">{a.name}</p>
                    {a.email && <p className="text-[10px] text-zinc-500">{a.email}</p>}
                  </div>
                  <span className={cn('text-[10px] uppercase', STAGE_COLOR[a.stage])}>{a.stage}</span>
                </div>
                <div className="flex flex-wrap gap-1 mt-2">
                  {STAGES.map((st) => (
                    <button key={st} type="button" onClick={() => advance(a.id, st)}
                      className={cn('text-[10px] px-1.5 py-0.5 rounded border capitalize',
                        a.stage === st ? 'border-emerald-700/50 bg-emerald-950/40 text-emerald-300' : 'border-zinc-700 text-zinc-500')}>
                      {st}
                    </button>
                  ))}
                </div>
              </li>
            ))}
          </ul>
        )}
      </div>
    );
  }

  // ── Job list ──
  return (
    <div className="space-y-3">
      {error && <div className="text-xs text-rose-400 bg-rose-950/40 border border-rose-900/50 rounded-lg px-3 py-2">{error}</div>}

      <div className="grid grid-cols-4 gap-2 bg-zinc-900/70 border border-zinc-800 rounded-xl p-3">
        <input placeholder="Job title" value={form.title} onChange={(e) => setForm({ ...form, title: e.target.value })}
          className="col-span-2 bg-zinc-950 border border-zinc-700 rounded-lg px-2 py-1.5 text-xs text-zinc-100" />
        <input placeholder="Department" value={form.department} onChange={(e) => setForm({ ...form, department: e.target.value })}
          className="bg-zinc-950 border border-zinc-700 rounded-lg px-2 py-1.5 text-xs text-zinc-100" />
        <button type="button" onClick={postJob}
          className="flex items-center justify-center gap-1 bg-emerald-600 hover:bg-emerald-500 text-white text-xs font-medium rounded-lg">
          <Plus className="w-3.5 h-3.5" /> Post
        </button>
      </div>

      {jobs.length === 0 ? (
        <div className="text-center text-zinc-500 text-sm italic py-10 border border-zinc-800 rounded-xl">
          No open jobs. Post a requisition to start recruiting.
        </div>
      ) : (
        <ul className="space-y-2">
          {jobs.map((j) => (
            <li key={j.id}>
              <button type="button" onClick={() => openJob(j)}
                className="w-full text-left flex items-center gap-2 bg-zinc-900/70 border border-zinc-800 rounded-xl p-3 hover:border-zinc-700">
                <Briefcase className="w-4 h-4 text-emerald-400 shrink-0" />
                <div>
                  <p className="text-sm font-semibold text-zinc-100">{j.title}</p>
                  <p className="text-[11px] text-zinc-500">{j.department} · {j.applicantCount} applicants</p>
                </div>
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
