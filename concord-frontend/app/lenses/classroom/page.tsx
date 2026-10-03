'use client';

/**
 * /lenses/classroom — cohorts + homework + peer review.
 * Phase 9.6 #20.
 */
// Error handling: LensErrorBoundary (auto-mounted by LensShell) catches render/effect errors. Local fetch errors caught with try/catch where shown.
// Empty state: handled inline when data is empty (Sprint 17 invariant).

import { useCallback, useEffect, useState } from 'react';
import { BookOpen, GraduationCap, Library, Plus } from 'lucide-react';
import { useLensNav } from '@/hooks/useLensNav';
import { useLensCommand } from '@/hooks/useLensCommand';
import { useLensIdentity } from '@/hooks/useLensIdentity';
import { useAuth } from '@/hooks/useAuth';
import { titleCaseDisplayName } from '@/components/chat/claudeCleanGreeting';
import { DTUExportButton } from '@/components/lens/DTUExportButton';
import { cn } from '@/lib/utils';
import { LensShell } from '@/components/lens/LensShell';
import { CrossLensRecentsPanel } from '@/components/lens/CrossLensRecentsPanel';
import { FirstRunTour } from '@/components/lens/FirstRunTour';
import { DepthBadge } from '@/components/lens/DepthBadge';
import { OpenLibrarySearch } from '@/components/classroom/OpenLibrarySearch';
import { ClassroomWorkspace } from '@/components/classroom/ClassroomWorkspace';

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
  const j = r ? await r.json().catch(() => null) : null;
  // POST /api/lens/run always answers { ok: true, result: PAYLOAD } where
  // `ok` is just the transport flag — PAYLOAD (the macro's own { ok, ... })
  // carries the real success/failure + fields. Unwrap it here, once, so
  // every caller below can keep reading r?.ok / r?.teaching / r?.cohortId /
  // r?.submissionId etc. directly.
  return j ? (j.result ?? j) : null;
}

type ClassView = 'cohorts' | 'workspace' | 'library';

const VIEWS: { id: ClassView; label: string; keys: string; title: string; hint: string; icon: typeof GraduationCap }[] = [
  { id: 'cohorts', label: 'Cohorts', keys: '1', title: 'The room', hint: 'Create, enrol, submit and open a cohort', icon: GraduationCap },
  { id: 'workspace', label: 'Workspace', keys: '2', title: 'The work', hint: 'Stream, classwork, gradebook, quizzes, materials', icon: BookOpen },
  { id: 'library', label: 'Library', keys: '3', title: 'The shelf', hint: 'Open Library book search', icon: Library },
];

const inputCls = 'w-full rounded-lg border border-white/10 bg-black/30 px-3 py-2 text-[13px] text-zinc-100 placeholder:text-zinc-600 focus:border-teal-400/50 focus:outline-none';
const submitCls = 'w-full rounded-full bg-white/10 py-2 text-[13px] text-zinc-100 transition-colors hover:bg-white/15 disabled:opacity-40';

export default function ClassroomPage() {
  useLensNav('classroom');
  useLensIdentity('classroom');
  const { user } = useAuth();
  const who = titleCaseDisplayName(user?.username);
  const [view, setView] = useState<ClassView>('cohorts');

  const newCohort = useCallback(() => {
    setView('cohorts');
    requestAnimationFrame(() => {
      const el = document.getElementById('classroom-cohort-name');
      el?.focus();
      el?.scrollIntoView({ behavior: 'smooth', block: 'center' });
    });
  }, []);

  useLensCommand([
    ...VIEWS.map((v) => ({
      id: `view-${v.id}`,
      keys: v.keys,
      description: `${v.label} — ${v.hint}`,
      category: 'navigation' as const,
      action: () => setView(v.id),
    })),
    { id: 'classroom-new-cohort', keys: 'n', description: 'Create a cohort', category: 'actions' as const, action: newCohort },
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

  const current = VIEWS.find((v) => v.id === view)!;
  const cardCls = 'rounded-2xl border border-white/10 bg-[#111] p-4';
  const cohortRow = (c: Cohort, right: string) => (
    <li key={c.id}>
      <button
        type="button"
        onClick={() => setActiveCohort(activeCohort === c.id ? null : c.id)}
        className={cn(
          'flex w-full items-center justify-between gap-3 rounded-xl border px-3 py-2.5 text-left text-[13px] transition-colors',
          activeCohort === c.id ? 'border-teal-400/40 bg-teal-400/10' : 'border-white/10 bg-white/[0.02] hover:border-white/20',
        )}
      >
        <span className="text-zinc-100"><span className="font-mono text-zinc-500">#{c.id}</span> {c.name}</span>
        <span className="text-zinc-500">{right}</span>
      </button>
    </li>
  );

  return (
    <LensShell lensId="classroom" asMain={false}>
      <FirstRunTour lensId="classroom" />
      <DepthBadge lensId="classroom" size="sm" className="ml-2" />
      <div data-lens-theme="classroom" className="relative min-h-full px-8 pb-28 pt-6">
        <div className="flex items-start justify-between gap-4">
          <div className="min-w-0">
            <p className="text-[14px] text-zinc-500">Classroom</p>
            <h1 className="mb-5 mt-1 font-vault text-[2.25rem] leading-tight text-zinc-100 sm:text-5xl">
              {current.title}{view === 'cohorts' && who ? `, ${who}` : ''}
            </h1>
          </div>
          <div className="flex shrink-0 items-center gap-3 pt-2">
            <DTUExportButton domain="classroom" data={{}} compact />
          </div>
        </div>

        <nav className="mb-6 inline-flex max-w-full items-center gap-1 overflow-x-auto rounded-full border border-white/10 bg-white/[0.03] p-1" aria-label="Classroom views">
          {VIEWS.map((v) => {
            const Icon = v.icon;
            const on = view === v.id;
            return (
              <button
                key={v.id}
                type="button"
                onClick={() => setView(v.id)}
                aria-current={on ? 'page' : undefined}
                title={`${v.hint} (${v.keys})`}
                className={cn(
                  'inline-flex items-center gap-2 whitespace-nowrap rounded-full px-4 py-1.5 text-[14px] transition-colors',
                  on ? 'bg-white/10 text-zinc-50' : 'text-zinc-500 hover:text-zinc-200',
                )}
              >
                <Icon className="h-3.5 w-3.5" />
                {v.label}
                <kbd className="hidden rounded border border-white/10 bg-white/5 px-1 py-0.5 font-mono text-[10px] text-white/30 sm:inline-block">{v.keys}</kbd>
              </button>
            );
          })}
        </nav>

        {status && (
          <div className="mb-4 rounded-xl border border-teal-400/30 bg-teal-400/10 px-3 py-2 text-[13px] text-teal-100">{status}</div>
        )}

        {loadError && (
          <div role="alert" className="mb-4 flex items-center justify-between gap-3 rounded-xl border border-rose-700/50 bg-rose-950/50 px-3 py-2 text-[13px] text-rose-200">
            <span>{loadError}</span>
            <button type="button" onClick={() => void refresh()} className="shrink-0 rounded-full bg-rose-800/60 px-3 py-1 text-xs text-rose-100 hover:bg-rose-700/60">
              Try again
            </button>
          </div>
        )}

        {view === 'cohorts' && (
          <div className="space-y-5">
            <div className="grid gap-5 md:grid-cols-3">
              <section className={cn(cardCls, 'space-y-2.5')}>
                <h2 className="text-[13px] font-medium text-zinc-300">Create a cohort</h2>
                <input id="classroom-cohort-name" type="text" placeholder="Cohort name" value={createForm.name}
                  onChange={(e) => setCreateForm({ ...createForm, name: e.target.value })} className={inputCls} />
                <input type="text" placeholder="Rubric DTU id (optional)" value={createForm.rubricDtuId}
                  onChange={(e) => setCreateForm({ ...createForm, rubricDtuId: e.target.value })} className={inputCls} />
                <button onClick={create} disabled={!createForm.name} className={submitCls}>Create</button>
              </section>
              <section className={cn(cardCls, 'space-y-2.5')}>
                <h2 className="text-[13px] font-medium text-zinc-300">Enrol</h2>
                <input type="text" placeholder="Cohort id" value={enrolForm.cohortId}
                  onChange={(e) => setEnrolForm({ ...enrolForm, cohortId: e.target.value })} className={inputCls} />
                <input type="text" placeholder="Student id (optional, self if blank)" value={enrolForm.studentUserId}
                  onChange={(e) => setEnrolForm({ ...enrolForm, studentUserId: e.target.value })} className={inputCls} />
                <button onClick={enrol} disabled={!enrolForm.cohortId} className={submitCls}>Enrol</button>
              </section>
              <section className={cn(cardCls, 'space-y-2.5')}>
                <h2 className="text-[13px] font-medium text-zinc-300">Submit homework</h2>
                <input type="text" placeholder="Cohort id" value={submitForm.cohortId}
                  onChange={(e) => setSubmitForm({ ...submitForm, cohortId: e.target.value })} className={inputCls} />
                <input type="text" placeholder="DTU id" value={submitForm.dtuId}
                  onChange={(e) => setSubmitForm({ ...submitForm, dtuId: e.target.value })} className={inputCls} />
                <button onClick={submit} disabled={!submitForm.cohortId || !submitForm.dtuId} className={submitCls}>Submit</button>
              </section>
            </div>

            {loading && <div role="status" aria-busy="true" className="text-[13px] italic text-zinc-500">Loading classroom cohorts…</div>}

            <div className="grid gap-5 lg:grid-cols-2">
              <section className={cardCls}>
                <h2 className="mb-3 text-[13px] font-medium text-zinc-300">Teaching</h2>
                {loading || loadError ? null : teaching.length === 0
                  ? <p className="text-[13px] italic text-zinc-500">No cohorts you teach.</p>
                  : <ul className="space-y-1.5">{teaching.map((c) => cohortRow(c, `${c.enrolled ?? 0} students`))}</ul>}
              </section>
              <section className={cardCls}>
                <h2 className="mb-3 text-[13px] font-medium text-zinc-300">Studying</h2>
                {loading || loadError ? null : studying.length === 0
                  ? <p className="text-[13px] italic text-zinc-500">No cohorts you are enrolled in.</p>
                  : <ul className="space-y-1.5">{studying.map((c) => cohortRow(c, c.teacher_user_id ? `teacher ${c.teacher_user_id.slice(0, 8)}` : ''))}</ul>}
              </section>
            </div>
          </div>
        )}

        {view === 'workspace' && (
          <section>
            <p className="mb-3 text-[13px] text-zinc-500">
              {activeCohort ? `Scoped to cohort #${activeCohort}. Pick another on the Cohorts view.` : 'Showing all your work. Select a cohort on the Cohorts view to scope it.'}
            </p>
            <ClassroomWorkspace cohortId={activeCohort} />
          </section>
        )}

        {view === 'library' && (
          <section className={cardCls}>
            <OpenLibrarySearch />
          </section>
        )}

        <CrossLensRecentsPanel lensId="classroom" sinceDays={7} limit={6} hideWhenEmpty className="mt-8" />

        <button
          type="button"
          onClick={newCohort}
          title="Create a cohort (N)"
          className="fixed bottom-8 right-8 z-30 inline-flex items-center gap-2 rounded-full bg-teal-400 px-6 py-3.5 text-[15px] font-medium text-black shadow-[0_8px_32px_rgba(45,212,191,0.25)] transition-colors hover:bg-teal-300"
        >
          <Plus className="h-4 w-4" />
          Create a cohort
        </button>
      </div>
    </LensShell>
  );
}
