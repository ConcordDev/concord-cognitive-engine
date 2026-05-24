'use client';

import { useCallback, useEffect, useState } from 'react';
import { lensRun } from '@/lib/api/client';
import {
  Briefcase, Plus, X, Loader2, MapPin, DollarSign, Send, Users, CheckCircle2, Globe,
} from 'lucide-react';

interface JobApplication {
  userId: string; message: string; portfolioProjectId: string;
  quote: number | null; createdAt: string;
}
interface Job {
  id: string; posterId: string; title: string; description: string; discipline: string;
  kind: string; budgetMin: number; budgetMax: number; remote: boolean; location: string;
  tags: string[]; status: string; applications: JobApplication[];
  applicationCount: number; applied: boolean; createdAt: string;
}

const KINDS = ['commission', 'contract', 'freelance', 'full-time'];

export function JobBoard() {
  const [jobs, setJobs] = useState<Job[]>([]);
  const [loading, setLoading] = useState(true);
  const [view, setView] = useState<'all' | 'mine'>('all');
  const [filterKind, setFilterKind] = useState('');
  const [showPost, setShowPost] = useState(false);
  const [applyingId, setApplyingId] = useState<string | null>(null);

  // Post form
  const [jTitle, setJTitle] = useState('');
  const [jDesc, setJDesc] = useState('');
  const [jDiscipline, setJDiscipline] = useState('illustration');
  const [jKind, setJKind] = useState('commission');
  const [jMin, setJMin] = useState('');
  const [jMax, setJMax] = useState('');
  const [jRemote, setJRemote] = useState(true);
  const [jLocation, setJLocation] = useState('');
  const [jTags, setJTags] = useState('');
  const [saving, setSaving] = useState(false);

  // Apply form
  const [appMessage, setAppMessage] = useState('');
  const [appQuote, setAppQuote] = useState('');

  const load = useCallback(async () => {
    setLoading(true);
    const r = await lensRun('artistry', 'jobList', {
      mine: view === 'mine',
      kind: filterKind || undefined,
      includeClosed: view === 'mine',
    });
    setJobs((r.data?.result?.jobs as Job[]) || []);
    setLoading(false);
  }, [view, filterKind]);

  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => { load(); }, [view, filterKind]);

  const post = useCallback(async () => {
    if (!jTitle.trim()) return;
    setSaving(true);
    const r = await lensRun('artistry', 'jobPost', {
      title: jTitle, description: jDesc, discipline: jDiscipline, kind: jKind,
      budgetMin: Number(jMin) || 0, budgetMax: Number(jMax) || 0,
      remote: jRemote, location: jLocation,
      tags: jTags.split(',').map((t) => t.trim()).filter(Boolean),
    });
    setSaving(false);
    if (r.data?.ok) {
      setShowPost(false);
      setJTitle(''); setJDesc(''); setJMin(''); setJMax(''); setJLocation(''); setJTags('');
      load();
    }
  }, [jTitle, jDesc, jDiscipline, jKind, jMin, jMax, jRemote, jLocation, jTags, load]);

  const apply = useCallback(async (jobId: string) => {
    const r = await lensRun('artistry', 'jobApply', {
      jobId, message: appMessage, quote: appQuote ? Number(appQuote) : undefined,
    });
    if (r.data?.ok) {
      setApplyingId(null); setAppMessage(''); setAppQuote(''); load();
    }
  }, [appMessage, appQuote, load]);

  const closeJob = useCallback(async (jobId: string) => {
    await lensRun('artistry', 'jobClose', { jobId });
    load();
  }, [load]);

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 className="text-lg font-semibold flex items-center gap-2">
          <Briefcase className="w-5 h-5 text-neon-pink" /> Commission &amp; Job Board
        </h2>
        <button onClick={() => setShowPost(true)} className="px-3 py-1.5 text-xs bg-neon-pink/20 border border-neon-pink/30 rounded-lg hover:bg-neon-pink/30 flex items-center gap-1">
          <Plus className="w-3 h-3" /> Post a Job
        </button>
      </div>

      {/* View + filter */}
      <div className="flex flex-wrap items-center gap-2">
        <div className="flex bg-white/5 rounded-lg p-0.5">
          {(['all', 'mine'] as const).map((v) => (
            <button key={v} onClick={() => setView(v)} className={`px-3 py-1 rounded text-xs capitalize ${view === v ? 'bg-neon-pink/20 text-neon-pink' : 'text-gray-400'}`}>
              {v === 'all' ? 'Open Jobs' : 'My Posts'}
            </button>
          ))}
        </div>
        <select value={filterKind} onChange={(e) => setFilterKind(e.target.value)} className="px-3 py-1.5 bg-white/5 border border-white/10 rounded-lg text-xs">
          <option value="">All types</option>
          {KINDS.map((k) => <option key={k} value={k}>{k}</option>)}
        </select>
      </div>

      {loading ? (
        <div className="flex justify-center py-12"><Loader2 className="w-5 h-5 animate-spin text-neon-pink" /></div>
      ) : jobs.length === 0 ? (
        <div className="text-center py-12 text-gray-400 text-sm">
          {view === 'mine' ? 'You have not posted any jobs.' : 'No open jobs right now.'}
        </div>
      ) : (
        <div className="space-y-3">
          {jobs.map((j) => (
            <div key={j.id} className="bg-white/5 border border-white/10 rounded-lg p-4">
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <h3 className="font-medium text-sm">{j.title}</h3>
                  <div className="flex flex-wrap items-center gap-2 mt-1 text-[11px] text-gray-400">
                    <span className="capitalize px-1.5 py-0.5 bg-white/5 rounded">{j.kind}</span>
                    <span className="capitalize">{j.discipline}</span>
                    {j.remote
                      ? <span className="flex items-center gap-0.5"><Globe className="w-3 h-3" /> Remote</span>
                      : j.location && <span className="flex items-center gap-0.5"><MapPin className="w-3 h-3" /> {j.location}</span>}
                    {(j.budgetMin > 0 || j.budgetMax > 0) && (
                      <span className="flex items-center gap-0.5 text-neon-green">
                        <DollarSign className="w-3 h-3" />{j.budgetMin}–{j.budgetMax}
                      </span>
                    )}
                  </div>
                </div>
                <span className={`text-[10px] px-1.5 py-0.5 rounded shrink-0 ${j.status === 'open' ? 'bg-neon-green/10 text-neon-green' : 'bg-white/5 text-gray-400'}`}>
                  {j.status}
                </span>
              </div>

              {j.description && <p className="text-xs text-gray-400 mt-2 whitespace-pre-wrap">{j.description}</p>}

              {j.tags.length > 0 && (
                <div className="flex flex-wrap gap-1 mt-2">
                  {j.tags.map((t) => <span key={t} className="text-[10px] px-1.5 py-0.5 bg-white/5 rounded text-gray-400">#{t}</span>)}
                </div>
              )}

              <div className="flex items-center justify-between mt-3 pt-2 border-t border-white/10 text-[11px] text-gray-400">
                <span className="flex items-center gap-1"><Users className="w-3 h-3" /> {j.applicationCount} applicant{j.applicationCount === 1 ? '' : 's'}</span>
                <div className="flex items-center gap-2">
                  {view === 'mine' && j.status === 'open' && (
                    <button onClick={() => closeJob(j.id)} className="text-gray-400 hover:text-red-400">Close</button>
                  )}
                  {view !== 'mine' && j.status === 'open' && (
                    j.applied
                      ? <span className="flex items-center gap-1 text-neon-green"><CheckCircle2 className="w-3 h-3" /> Applied</span>
                      : <button onClick={() => setApplyingId(applyingId === j.id ? null : j.id)} className="text-neon-pink hover:underline">Apply</button>
                  )}
                </div>
              </div>

              {/* Inline apply form */}
              {applyingId === j.id && (
                <div className="mt-3 space-y-2 bg-white/5 rounded-lg p-3">
                  <textarea value={appMessage} onChange={(e) => setAppMessage(e.target.value)} placeholder="Pitch / cover message" rows={2} className="w-full px-3 py-1.5 bg-white/5 border border-white/10 rounded-lg text-sm" />
                  <div className="flex gap-2">
                    <input value={appQuote} onChange={(e) => setAppQuote(e.target.value)} type="number" placeholder="Your quote (optional)" className="flex-1 px-3 py-1.5 bg-white/5 border border-white/10 rounded-lg text-sm" />
                    <button onClick={() => apply(j.id)} className="px-3 py-1.5 bg-neon-pink/20 rounded-lg text-xs hover:bg-neon-pink/30 flex items-center gap-1">
                      <Send className="w-3 h-3" /> Submit
                    </button>
                  </div>
                </div>
              )}

              {/* Owner sees applicants */}
              {view === 'mine' && j.applications.length > 0 && (
                <div className="mt-3 space-y-1.5">
                  <h4 className="text-[11px] font-semibold text-gray-400">Applicants</h4>
                  {j.applications.map((a, i) => (
                    <div key={i} className="bg-white/5 rounded-lg p-2 text-[11px]">
                      <div className="flex justify-between">
                        <span className="text-gray-300">{a.userId}</span>
                        {a.quote != null && <span className="text-neon-green">${a.quote}</span>}
                      </div>
                      {a.message && <p className="text-gray-400 mt-0.5">{a.message}</p>}
                    </div>
                  ))}
                </div>
              )}
            </div>
          ))}
        </div>
      )}

      {/* Post job modal */}
      {showPost && (
        <div className="fixed inset-0 bg-black/60 flex items-center justify-center z-50 p-4" onClick={() => setShowPost(false)} role="button" tabIndex={0} onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); (e.currentTarget as HTMLElement).click(); } }}>
          <div className="bg-gray-900 border border-white/10 rounded-lg p-6 w-full max-w-lg max-h-[85vh] overflow-y-auto" onClick={(e) => e.stopPropagation()} role="button" tabIndex={0} onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); (e.currentTarget as HTMLElement).click(); } }}>
            <div className="flex justify-between items-center mb-4">
              <h3 className="font-semibold">Post a Job / Commission</h3>
              <button onClick={() => setShowPost(false)} aria-label="Close"><X className="w-4 h-4" /></button>
            </div>
            <div className="space-y-3">
              <input value={jTitle} onChange={(e) => setJTitle(e.target.value)} placeholder="Job title" className="w-full px-3 py-2 bg-white/5 border border-white/10 rounded-lg text-sm" />
              <textarea value={jDesc} onChange={(e) => setJDesc(e.target.value)} placeholder="Description / brief" rows={3} className="w-full px-3 py-2 bg-white/5 border border-white/10 rounded-lg text-sm" />
              <div className="grid grid-cols-2 gap-2">
                <select value={jDiscipline} onChange={(e) => setJDiscipline(e.target.value)} className="px-3 py-2 bg-white/5 border border-white/10 rounded-lg text-sm">
                  {['illustration', 'painting', 'photography', '3d', 'animation', 'graphic-design', 'concept-art', 'typography'].map((d) => <option key={d} value={d}>{d}</option>)}
                </select>
                <select value={jKind} onChange={(e) => setJKind(e.target.value)} className="px-3 py-2 bg-white/5 border border-white/10 rounded-lg text-sm">
                  {KINDS.map((k) => <option key={k} value={k}>{k}</option>)}
                </select>
              </div>
              <div className="grid grid-cols-2 gap-2">
                <input value={jMin} onChange={(e) => setJMin(e.target.value)} type="number" placeholder="Budget min" className="px-3 py-2 bg-white/5 border border-white/10 rounded-lg text-sm" />
                <input value={jMax} onChange={(e) => setJMax(e.target.value)} type="number" placeholder="Budget max" className="px-3 py-2 bg-white/5 border border-white/10 rounded-lg text-sm" />
              </div>
              <div className="flex items-center gap-3">
                <label className="flex items-center gap-2 text-sm text-gray-300">
                  <input type="checkbox" checked={jRemote} onChange={(e) => setJRemote(e.target.checked)} /> Remote
                </label>
                <input value={jLocation} onChange={(e) => setJLocation(e.target.value)} placeholder="Location" className="flex-1 px-3 py-2 bg-white/5 border border-white/10 rounded-lg text-sm" />
              </div>
              <input value={jTags} onChange={(e) => setJTags(e.target.value)} placeholder="Tags (comma separated)" className="w-full px-3 py-2 bg-white/5 border border-white/10 rounded-lg text-sm" />
              <button onClick={post} disabled={saving || !jTitle.trim()} className="w-full py-2 bg-neon-pink/20 rounded-lg text-sm hover:bg-neon-pink/30 disabled:opacity-50">
                {saving ? 'Posting...' : 'Post Job'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
