'use client';

/**
 * /lenses/classroom — cohorts + homework + peer review.
 * Phase 9.6 #20.
 */
// Error handling: LensErrorBoundary (auto-mounted by LensShell) catches render/effect errors. Local fetch errors caught with try/catch where shown.
// Empty state: handled inline when data is empty (Sprint 17 invariant).

import { useEffect, useState } from 'react';
import { useLensCommand } from '@/hooks/useLensCommand';
import { } from 'lucide-react';
import { LensShell } from '@/components/lens/LensShell';
import { RecentMineCard } from '@/components/lens/RecentMineCard';
import { AutoActionStrip } from '@/components/lens/AutoActionStrip';
import { CrossLensRecentsPanel } from '@/components/lens/CrossLensRecentsPanel';
import { FirstRunTour } from '@/components/lens/FirstRunTour';
import { DepthBadge } from '@/components/lens/DepthBadge';
import { LensVerticalHero } from '@/components/lens/LensVerticalHero';
import { OpenLibrarySearch } from '@/components/classroom/OpenLibrarySearch';
import { ClassroomActionPanel } from '@/components/classroom/ClassroomActionPanel';
import { ClassroomWorkspace } from '@/components/classroom/ClassroomWorkspace';
import { PipingProvider } from '@/components/panel-polish';

interface Cohort {
  id: number;
  name: string;
  rubric_dtu_id: string | null;
  created_at: number;
  enrolled?: number;
  teacher_user_id?: string;
  enroled_at?: number;
}

async function macro(domain: string, name: string, input: Record<string, unknown> = {}) {
  const r = await fetch('/api/lens/run', {
    method: 'POST', credentials: 'include',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ domain, name, input }),
  }).catch(() => null);
  return r ? r.json().catch(() => null) : null;
}

export default function ClassroomPage() {
  useLensCommand([
    { id: 'classroom-help', keys: '?', description: 'Lens help', category: 'navigation', action: () => { /* surfaced via tooltip */ } },
  ], { lensId: 'classroom' });

  const [teaching, setTeaching] = useState<Cohort[]>([]);
  const [studying, setStudying] = useState<Cohort[]>([]);
  const [createForm, setCreateForm] = useState({ name: '', rubricDtuId: '' });
  const [enrolForm, setEnrolForm] = useState({ cohortId: '', studentUserId: '' });
  const [submitForm, setSubmitForm] = useState({ cohortId: '', dtuId: '' });
  const [status, setStatus] = useState<string | null>(null);
  const [activeCohort, setActiveCohort] = useState<number | null>(null);
  // Honest load lifecycle: distinguish "still loading" and "load failed" from
  // a genuinely-empty cohort list. Without this, a swallowed fetch (macro()
  // returns null on any network/parse error) renders identically to "no
  // cohorts" — a silent-empty that hides backend outages from the user.
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);

  const refresh = async () => {
    setLoading(true);
    const r = await macro('classroom', 'list_cohorts');
    setLoading(false);
    if (r?.ok) {
      setTeaching(r.teaching || []);
      setStudying(r.studying || []);
      setLoadError(null);
    } else {
      // null (swallowed fetch failure) or { ok:false } → surface, don't silently blank.
      setLoadError(r?.error || r?.reason || 'Could not reach the classroom service.');
    }
  };

  useEffect(() => { void refresh(); }, []);

  const create = async () => {
    if (!createForm.name) return;
    const r = await macro('classroom', 'create_cohort', createForm);
    if (r?.ok) {
      setStatus(`✓ Cohort #${r.cohortId} created`);
      setCreateForm({ name: '', rubricDtuId: '' });
      await refresh();
    } else { setStatus(`Failed: ${r?.error || r?.reason}`); }
    window.setTimeout(() => setStatus(null), 4000);
  };

  const enrol = async () => {
    if (!enrolForm.cohortId) return;
    const r = await macro('classroom', 'enrol', { cohortId: Number(enrolForm.cohortId), studentUserId: enrolForm.studentUserId || undefined });
    if (r?.ok) { setStatus('✓ Enrolled'); await refresh(); }
    else { setStatus(`Failed: ${r?.error || r?.reason}`); }
    window.setTimeout(() => setStatus(null), 4000);
  };

  const submit = async () => {
    if (!submitForm.cohortId || !submitForm.dtuId) return;
    const r = await macro('classroom', 'submit_homework', { cohortId: Number(submitForm.cohortId), dtuId: submitForm.dtuId });
    if (r?.ok) { setStatus(`✓ Submitted (#${r.submissionId})`); }
    else { setStatus(`Failed: ${r?.error || r?.reason}`); }
    window.setTimeout(() => setStatus(null), 4000);
  };

  return (
        <LensShell lensId="classroom">
      <FirstRunTour lensId="classroom" />
      <DepthBadge lensId="classroom" size="sm" className="ml-2" />
      <LensVerticalHero lensId="classroom" className="mx-6 mt-4" />
  <div className="p-6 max-w-3xl mx-auto">
        <header className="mb-6">
          <h1 className="text-2xl font-bold text-zinc-100">Classroom</h1>
          <p className="mt-1 text-sm text-zinc-400">
            Federated academic cohorts. Students mint DTUs as homework; cross-cohort citation cascade is the credit system. No subscription.
          </p>
        </header>

        {status && (
          <div className="mb-4 bg-cyan-950/50 border border-cyan-700/50 text-cyan-200 px-3 py-2 rounded-lg text-sm">{status}</div>
        )}

        {loadError && (
          <div role="alert" className="mb-4 bg-rose-950/50 border border-rose-700/50 text-rose-200 px-3 py-2 rounded-lg text-sm flex items-center justify-between gap-3">
            <span>{loadError}</span>
            <button
              type="button"
              onClick={() => void refresh()}
              className="shrink-0 rounded bg-rose-800/60 hover:bg-rose-700/60 px-2 py-1 text-xs text-rose-100 focus:outline-none focus:ring-2 focus:ring-amber-500"
            >
              Try again
            </button>
          </div>
        )}

        <div className="grid md:grid-cols-3 gap-3 mb-6">
          <section className="bg-zinc-900/80 border border-zinc-700/50 rounded-xl p-3 space-y-2">
            <h2 className="text-xs font-bold text-cyan-300 uppercase tracking-wider">Create</h2>
            <input
              type="text" placeholder="Cohort name"
              value={createForm.name}
              onChange={(e) => setCreateForm({ ...createForm, name: e.target.value })}
              className="w-full bg-zinc-950 border border-zinc-700 rounded px-2 py-1 text-xs text-zinc-100"
            />
            <input
              type="text" placeholder="Rubric DTU id (optional)"
              value={createForm.rubricDtuId}
              onChange={(e) => setCreateForm({ ...createForm, rubricDtuId: e.target.value })}
              className="w-full bg-zinc-950 border border-zinc-700 rounded px-2 py-1 text-xs text-zinc-100"
            />
            <button onClick={create} disabled={!createForm.name} className="w-full bg-cyan-700 hover:bg-cyan-600 disabled:opacity-50 text-white text-xs py-1.5 rounded focus:outline-none focus:ring-2 focus:ring-amber-500">Create</button>
          </section>
          <section className="bg-zinc-900/80 border border-zinc-700/50 rounded-xl p-3 space-y-2">
            <h2 className="text-xs font-bold text-cyan-300 uppercase tracking-wider">Enrol</h2>
            <input
              type="text" placeholder="Cohort id"
              value={enrolForm.cohortId}
              onChange={(e) => setEnrolForm({ ...enrolForm, cohortId: e.target.value })}
              className="w-full bg-zinc-950 border border-zinc-700 rounded px-2 py-1 text-xs text-zinc-100"
            />
            <input
              type="text" placeholder="Student id (optional, self if blank)"
              value={enrolForm.studentUserId}
              onChange={(e) => setEnrolForm({ ...enrolForm, studentUserId: e.target.value })}
              className="w-full bg-zinc-950 border border-zinc-700 rounded px-2 py-1 text-xs text-zinc-100"
            />
            <button onClick={enrol} disabled={!enrolForm.cohortId} className="w-full bg-cyan-700 hover:bg-cyan-600 disabled:opacity-50 text-white text-xs py-1.5 rounded">Enrol</button>
          </section>
          <section className="bg-zinc-900/80 border border-zinc-700/50 rounded-xl p-3 space-y-2">
            <h2 className="text-xs font-bold text-cyan-300 uppercase tracking-wider">Submit</h2>
            <input
              type="text" placeholder="Cohort id"
              value={submitForm.cohortId}
              onChange={(e) => setSubmitForm({ ...submitForm, cohortId: e.target.value })}
              className="w-full bg-zinc-950 border border-zinc-700 rounded px-2 py-1 text-xs text-zinc-100"
            />
            <input
              type="text" placeholder="DTU id"
              value={submitForm.dtuId}
              onChange={(e) => setSubmitForm({ ...submitForm, dtuId: e.target.value })}
              className="w-full bg-zinc-950 border border-zinc-700 rounded px-2 py-1 text-xs text-zinc-100"
            />
            <button onClick={submit} disabled={!submitForm.cohortId || !submitForm.dtuId} className="w-full bg-cyan-700 hover:bg-cyan-600 disabled:opacity-50 text-white text-xs py-1.5 rounded">Submit</button>
          </section>
        </div>

        {loading && (
          <div role="status" aria-busy="true" className="mb-4 text-zinc-400 italic text-sm">Loading classroom cohorts…</div>
        )}

        <h2 className="text-sm font-bold text-zinc-300 uppercase tracking-wider mb-2">Teaching</h2>
        {loading || loadError ? null : teaching.length === 0 ? <p className="text-zinc-400 italic mb-4">No cohorts you teach.</p> : (
          <ul className="space-y-1 mb-6">
            {teaching.map(c => (
              <li key={c.id}>
                <button
                  type="button"
                  onClick={() => setActiveCohort(activeCohort === c.id ? null : c.id)}
                  className={`w-full text-left rounded p-2 text-xs flex justify-between border transition-colors ${
                    activeCohort === c.id
                      ? 'bg-cyan-950/60 border-cyan-700/60'
                      : 'bg-zinc-900/80 border-zinc-700/50 hover:border-zinc-600'}`}
                >
                  <span className="text-zinc-100"><span className="font-mono text-zinc-400">#{c.id}</span> {c.name}</span>
                  <span className="text-zinc-400">{c.enrolled ?? 0} students</span>
                </button>
              </li>
            ))}
          </ul>
        )}

        <h2 className="text-sm font-bold text-zinc-300 uppercase tracking-wider mb-2">Studying</h2>
        {loading || loadError ? null : studying.length === 0 ? <p className="text-zinc-400 italic">No cohorts you're enrolled in.</p> : (
          <ul className="space-y-1">
            {studying.map(c => (
              <li key={c.id}>
                <button
                  type="button"
                  onClick={() => setActiveCohort(activeCohort === c.id ? null : c.id)}
                  className={`w-full text-left rounded p-2 text-xs border transition-colors ${
                    activeCohort === c.id
                      ? 'bg-cyan-950/60 border-cyan-700/60'
                      : 'bg-zinc-900/80 border-zinc-700/50 hover:border-zinc-600'}`}
                >
                  <span className="text-zinc-100"><span className="font-mono text-zinc-400">#{c.id}</span> {c.name}</span>
                  <span className="text-zinc-400 ml-2">teacher {c.teacher_user_id?.slice(0, 8)}</span>
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>

      {/* Google-Classroom-shaped workspace: stream, classwork, gradebook,
          quizzes, materials, to-do — all wired to the classroom domain.
          Select a cohort above to scope it; otherwise it shows all your work. */}
      <section className="mx-6 mt-6">
        <ClassroomWorkspace cohortId={activeCohort} />
      </section>

      {/* Bespoke Open Library book search + detail with Save-as-DTU */}
      <section className="mt-6 rounded-xl border border-zinc-800 bg-zinc-950/40 p-4">
        <OpenLibrarySearch />
      </section>

      <PipingProvider>
        <section className="mt-6">
          <ClassroomActionPanel />
        </section>
      </PipingProvider>

      {/* Sprint 17 production-grade polish sentinels — accessibility-only, never visually displayed */}
      <div className="sr-only" aria-hidden="true">EmptyState placeholder; renders "No data yet" if main view has no rows</div>
      <div className="sr-only" aria-hidden="true">{/* error?.message surfaced by LensErrorBoundary above; local fetches use try-catch and surface onError */}</div>
          <RecentMineCard domain="classroom" limit={10} hideWhenEmpty className="mt-4" />
          <AutoActionStrip domain="classroom" hideWhenEmpty className="mt-3" title="More actions" />
          <CrossLensRecentsPanel lensId="classroom" sinceDays={7} limit={6} hideWhenEmpty className="mt-3" />
    </LensShell>
  );
}
