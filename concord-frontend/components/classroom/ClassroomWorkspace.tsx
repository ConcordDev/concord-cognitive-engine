'use client';
/* eslint-disable @typescript-eslint/no-explicit-any */

/**
 * ClassroomWorkspace — Google-Classroom-shaped teacher/student surface.
 *
 * Wires the classroom-domain workspace macros into purpose-built UI:
 *   assignment-create / assignment-list / assignment-delete
 *   submission-create / submission-list
 *   grade-submission / gradebook
 *   announce / stream-list
 *   material-add / material-list / material-delete
 *   todo
 *   quiz-create / quiz-list / quiz-get / quiz-submit / quiz-attempts
 *
 * Every value rendered comes from a real macro round-trip; no mock data.
 */

import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  ClipboardList, GraduationCap, Megaphone, FolderOpen,
  ListChecks, FileQuestion, Plus, Trash2, Check, Loader2, AlertTriangle,
} from 'lucide-react';
import { lensRun } from '@/lib/api/client';
import { ChartKit, TimelineView } from '@/components/viz';

type TabId = 'stream' | 'assignments' | 'gradebook' | 'materials' | 'todo' | 'quizzes';

interface Assignment {
  id: string; cohortId: number; title: string; instructions: string;
  attachments: string[]; dueAt: string | null; points: number; topic: string | null;
  status: string; createdAt: string; submissionCount?: number; gradedCount?: number;
}
interface Submission {
  id: string; assignmentId: string; studentId: string; content: string;
  dtuId: string | null; attachments: string[]; status: string; submittedAt: string;
  grade?: Grade | null;
}
interface Grade {
  id: string; submissionId: string; assignmentId: string; studentId: string;
  score: number; maxPoints: number; percent: number; feedback: string;
  rubricScores: Array<{ criterion: string; points: number; max: number }>;
  returned: boolean; gradedAt: string;
}
interface GradebookCell {
  assignmentId: string; assignmentTitle: string; submitted: boolean;
  score: number | null; maxPoints: number; percent: number | null;
}
interface GradebookRow {
  studentId: string; cells: GradebookCell[];
  totalEarned: number; totalPossible: number; average: number | null;
}
interface StreamEntry {
  id: string; kind: string; text: string; cohortId: number | null; createdAt: string;
}
interface Material {
  id: string; cohortId: number; title: string; kind: string;
  url: string | null; dtuId: string | null; topic: string | null;
  notes: string; createdAt: string;
}
interface TodoItem {
  assignmentId: string; title: string; cohortId: number; points: number;
  dueAt: string | null; submitted: boolean; status: string; score: number | null;
}
interface QuizQuestion {
  id: string; kind: string; prompt: string; options: string[]; points: number;
}
interface Quiz {
  id: string; cohortId: number; title: string; description: string;
  dueAt: string | null; questions: QuizQuestion[]; totalPoints: number;
  createdAt: string; questionCount?: number; attemptCount?: number;
}
interface QuizAttempt {
  id: string; quizId: string; cohortId: number; studentId: string;
  score: number; totalPoints: number; percent: number;
  breakdown: Array<{ questionId: string; prompt: string; given: string; correctAnswer: string; correct: boolean; points: number; awarded: number }>;
  submittedAt: string;
}

async function run<T = any>(name: string, params: Record<string, unknown> = {}): Promise<T | null> {
  const r = await lensRun<T>('classroom', name, params);
  return r.data?.ok ? (r.data.result as T) : null;
}

const TABS: Array<{ id: TabId; label: string; icon: typeof ClipboardList }> = [
  { id: 'stream', label: 'Stream', icon: Megaphone },
  { id: 'assignments', label: 'Classwork', icon: ClipboardList },
  { id: 'gradebook', label: 'Gradebook', icon: GraduationCap },
  { id: 'quizzes', label: 'Quizzes', icon: FileQuestion },
  { id: 'materials', label: 'Materials', icon: FolderOpen },
  { id: 'todo', label: 'To-do', icon: ListChecks },
];

const inputCls = 'w-full bg-zinc-950 border border-zinc-700 rounded px-2 py-1 text-xs text-zinc-100 focus:outline-none focus:ring-1 focus:ring-cyan-500';
const btnCls = 'inline-flex items-center gap-1 bg-cyan-700 hover:bg-cyan-600 disabled:opacity-40 text-white text-xs px-2.5 py-1 rounded focus:outline-none focus:ring-2 focus:ring-amber-500';
const cardCls = 'bg-zinc-900/80 border border-zinc-700/50 rounded-lg p-3';

export function ClassroomWorkspace({ cohortId }: { cohortId: number | null }) {
  const [tab, setTab] = useState<TabId>('stream');
  const [note, setNote] = useState<{ kind: 'ok' | 'err'; text: string } | null>(null);

  const flash = useCallback((kind: 'ok' | 'err', text: string) => {
    setNote({ kind, text });
    window.setTimeout(() => setNote(null), 3500);
  }, []);

  return (
    <div className="rounded-xl border border-zinc-800 bg-zinc-950/40 p-4">
      <div className="flex items-center gap-2 border-b border-zinc-800 pb-2 mb-3 flex-wrap">
        <h3 className="text-sm font-bold text-zinc-100 mr-2">Classroom workspace</h3>
        {TABS.map(({ id, label, icon: Icon }) => (
          <button key={id} type="button" onClick={() => setTab(id)}
            className={`inline-flex items-center gap-1 text-xs px-2.5 py-1 rounded transition-colors ${
              tab === id ? 'bg-cyan-700 text-white' : 'bg-zinc-900 text-zinc-400 hover:text-zinc-200'}`}>
            <Icon className="w-3 h-3" /> {label}
          </button>
        ))}
        {cohortId != null && (
          <span className="ml-auto text-[10px] font-mono text-zinc-400">cohort #{cohortId}</span>
        )}
      </div>

      {note && (
        <div className={`mb-3 px-3 py-1.5 rounded text-xs flex items-center gap-1.5 border ${
          note.kind === 'ok'
            ? 'bg-emerald-500/10 text-emerald-300 border-emerald-500/30'
            : 'bg-rose-500/10 text-rose-300 border-rose-500/30'}`}>
          {note.kind === 'ok' ? <Check className="w-3 h-3" /> : <AlertTriangle className="w-3 h-3" />}
          {note.text}
        </div>
      )}

      {tab === 'stream' && <StreamTab cohortId={cohortId} flash={flash} />}
      {tab === 'assignments' && <AssignmentsTab cohortId={cohortId} flash={flash} />}
      {tab === 'gradebook' && <GradebookTab cohortId={cohortId} flash={flash} />}
      {tab === 'quizzes' && <QuizzesTab cohortId={cohortId} flash={flash} />}
      {tab === 'materials' && <MaterialsTab cohortId={cohortId} flash={flash} />}
      {tab === 'todo' && <TodoTab cohortId={cohortId} />}
    </div>
  );
}

type FlashFn = (kind: 'ok' | 'err', text: string) => void;
interface TabProps { cohortId: number | null; flash: FlashFn }

/* ── Stream / announcements ─────────────────────────────────────────── */
function StreamTab({ cohortId, flash }: TabProps) {
  const [stream, setStream] = useState<StreamEntry[]>([]);
  const [text, setText] = useState('');
  const [busy, setBusy] = useState(false);

  const refresh = useCallback(async () => {
    const r = await run<{ stream: StreamEntry[] }>('stream-list',
      cohortId != null ? { cohortId } : {});
    setStream(r?.stream ?? []);
  }, [cohortId]);

  useEffect(() => { void refresh(); }, [refresh]);

  const post = async () => {
    if (!text.trim()) return;
    setBusy(true);
    const r = await run('announce', { text: text.trim(), cohortId: cohortId ?? undefined });
    setBusy(false);
    if (r) { flash('ok', 'Announcement posted'); setText(''); void refresh(); }
    else flash('err', 'Announcement failed');
  };

  const events = stream.map((e) => ({
    id: e.id, label: e.text, time: e.createdAt,
    tone: (e.kind === 'grade' ? 'good' : e.kind === 'assignment' ? 'info'
      : e.kind === 'quiz' ? 'warn' : 'default') as 'good' | 'info' | 'warn' | 'default',
    detail: e.kind,
  }));

  return (
    <div className="space-y-3">
      <div className={cardCls}>
        <h4 className="text-xs font-bold text-cyan-300 uppercase tracking-wider mb-2">Announce</h4>
        <textarea value={text} onChange={(e) => setText(e.target.value)} rows={2}
          placeholder="Share something with the class…" className={inputCls} />
        <div className="mt-2">
          <button onClick={post} disabled={busy || !text.trim()} className={btnCls}>
            {busy ? <Loader2 className="w-3 h-3 animate-spin" /> : <Megaphone className="w-3 h-3" />} Post
          </button>
        </div>
      </div>
      {events.length > 0 && (
        <div className={cardCls}>
          <h4 className="text-xs font-bold text-zinc-400 uppercase tracking-wider mb-2">Class timeline</h4>
          <TimelineView events={events} />
        </div>
      )}
      {stream.length === 0 ? (
        <p className="text-zinc-400 italic text-xs">No stream activity yet.</p>
      ) : (
        <ul className="space-y-1">
          {stream.map((e) => (
            <li key={e.id} className="bg-zinc-900/60 border border-zinc-800 rounded p-2 text-xs">
              <div className="flex justify-between gap-2">
                <span className="text-zinc-200">{e.text}</span>
                <span className="text-[10px] text-zinc-400 whitespace-nowrap">
                  {new Date(e.createdAt).toLocaleString()}
                </span>
              </div>
              <span className="text-[10px] font-mono text-cyan-500/80">{e.kind}</span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

/* ── Assignments (create + list + submit + grade) ───────────────────── */
function AssignmentsTab({ cohortId, flash }: TabProps) {
  const [assignments, setAssignments] = useState<Assignment[]>([]);
  const [form, setForm] = useState({ title: '', instructions: '', dueAt: '', points: '100', topic: '' });
  const [busy, setBusy] = useState(false);
  const [openId, setOpenId] = useState<string | null>(null);
  const [submissions, setSubmissions] = useState<Submission[]>([]);
  const [subForm, setSubForm] = useState({ content: '', studentId: '', dtuId: '' });
  const [gradeForm, setGradeForm] = useState<{ subId: string; score: string; feedback: string } | null>(null);

  const refresh = useCallback(async () => {
    const r = await run<{ assignments: Assignment[] }>('assignment-list',
      cohortId != null ? { cohortId } : {});
    setAssignments(r?.assignments ?? []);
  }, [cohortId]);

  useEffect(() => { void refresh(); }, [refresh]);

  const create = async () => {
    if (!form.title.trim() || cohortId == null) { flash('err', 'Title + cohort required'); return; }
    setBusy(true);
    const r = await run('assignment-create', {
      cohortId, title: form.title.trim(), instructions: form.instructions,
      dueAt: form.dueAt || undefined, points: Number(form.points) || 100,
      topic: form.topic || undefined,
    });
    setBusy(false);
    if (r) {
      flash('ok', 'Assignment created');
      setForm({ title: '', instructions: '', dueAt: '', points: '100', topic: '' });
      void refresh();
    } else flash('err', 'Create failed');
  };

  const remove = async (id: string) => {
    const r = await run('assignment-delete', { assignmentId: id });
    if (r) { flash('ok', 'Deleted'); void refresh(); if (openId === id) setOpenId(null); }
    else flash('err', 'Delete failed');
  };

  const openSubmissions = async (id: string) => {
    setOpenId(openId === id ? null : id);
    if (openId === id) return;
    const r = await run<{ submissions: Submission[] }>('submission-list', { assignmentId: id });
    setSubmissions(r?.submissions ?? []);
  };

  const submit = async (assignmentId: string) => {
    if (!subForm.content.trim()) { flash('err', 'Submission content required'); return; }
    const r = await run('submission-create', {
      assignmentId, content: subForm.content.trim(),
      studentId: subForm.studentId || undefined, dtuId: subForm.dtuId || undefined,
    });
    if (r) {
      flash('ok', 'Submission recorded');
      setSubForm({ content: '', studentId: '', dtuId: '' });
      const sr = await run<{ submissions: Submission[] }>('submission-list', { assignmentId });
      setSubmissions(sr?.submissions ?? []);
      void refresh();
    } else flash('err', 'Submit failed');
  };

  const grade = async (assignmentId: string) => {
    if (!gradeForm) return;
    const r = await run('grade-submission', {
      submissionId: gradeForm.subId, score: Number(gradeForm.score) || 0,
      feedback: gradeForm.feedback, returned: true,
    });
    if (r) {
      flash('ok', 'Graded & returned');
      setGradeForm(null);
      const sr = await run<{ submissions: Submission[] }>('submission-list', { assignmentId });
      setSubmissions(sr?.submissions ?? []);
      void refresh();
    } else flash('err', 'Grade failed');
  };

  return (
    <div className="space-y-3">
      <div className={cardCls}>
        <h4 className="text-xs font-bold text-cyan-300 uppercase tracking-wider mb-2">New assignment</h4>
        <div className="grid sm:grid-cols-2 gap-2">
          <input className={inputCls} placeholder="Title" value={form.title}
            onChange={(e) => setForm({ ...form, title: e.target.value })} />
          <input className={inputCls} placeholder="Topic (optional)" value={form.topic}
            onChange={(e) => setForm({ ...form, topic: e.target.value })} />
          <input className={inputCls} type="datetime-local" value={form.dueAt}
            onChange={(e) => setForm({ ...form, dueAt: e.target.value })} />
          <input className={inputCls} type="number" min={0} max={1000} placeholder="Points" value={form.points}
            onChange={(e) => setForm({ ...form, points: e.target.value })} />
          <textarea className={`${inputCls} sm:col-span-2`} rows={2} placeholder="Instructions"
            value={form.instructions}
            onChange={(e) => setForm({ ...form, instructions: e.target.value })} />
        </div>
        <div className="mt-2">
          <button onClick={create} disabled={busy} className={btnCls}>
            {busy ? <Loader2 className="w-3 h-3 animate-spin" /> : <Plus className="w-3 h-3" />} Create
          </button>
        </div>
      </div>

      {assignments.length === 0 ? (
        <p className="text-zinc-400 italic text-xs">No assignments yet.</p>
      ) : assignments.map((a) => (
        <div key={a.id} className={cardCls}>
          <div className="flex justify-between gap-2 items-start">
            <div>
              <div className="text-sm font-semibold text-zinc-100">{a.title}</div>
              {a.instructions && <div className="text-xs text-zinc-400 mt-0.5">{a.instructions}</div>}
              <div className="text-[10px] text-zinc-400 mt-1 flex gap-3 flex-wrap">
                <span>{a.points} pts</span>
                {a.dueAt && <span>due {new Date(a.dueAt).toLocaleString()}</span>}
                {a.topic && <span className="text-cyan-500/80">#{a.topic}</span>}
                <span>{a.submissionCount ?? 0} submitted · {a.gradedCount ?? 0} graded</span>
              </div>
            </div>
            <div className="flex gap-1">
              <button onClick={() => openSubmissions(a.id)}
                className="text-[10px] px-2 py-1 rounded bg-zinc-800 text-zinc-300 hover:bg-zinc-700">
                {openId === a.id ? 'Hide' : 'Open'}
              </button>
              <button aria-label="Delete" onClick={() => remove(a.id)}
                className="text-[10px] px-1.5 py-1 rounded bg-rose-900/40 text-rose-300 hover:bg-rose-900/60">
                <Trash2 className="w-3 h-3" />
              </button>
            </div>
          </div>

          {openId === a.id && (
            <div className="mt-3 border-t border-zinc-800 pt-3 space-y-2">
              <div className="bg-zinc-950/60 rounded p-2 space-y-1">
                <div className="text-[10px] font-bold text-zinc-400 uppercase">Add submission</div>
                <textarea className={inputCls} rows={2} placeholder="Submission content"
                  value={subForm.content}
                  onChange={(e) => setSubForm({ ...subForm, content: e.target.value })} />
                <div className="grid grid-cols-2 gap-1">
                  <input className={inputCls} placeholder="Student id (optional)" value={subForm.studentId}
                    onChange={(e) => setSubForm({ ...subForm, studentId: e.target.value })} />
                  <input className={inputCls} placeholder="DTU id (optional)" value={subForm.dtuId}
                    onChange={(e) => setSubForm({ ...subForm, dtuId: e.target.value })} />
                </div>
                <button onClick={() => submit(a.id)} className={btnCls}>Submit work</button>
              </div>

              {submissions.length === 0 ? (
                <p className="text-zinc-400 italic text-[11px]">No submissions.</p>
              ) : submissions.map((s) => (
                <div key={s.id} className="bg-zinc-950/60 rounded p-2 text-xs">
                  <div className="flex justify-between gap-2">
                    <span className="font-mono text-[10px] text-zinc-400">{s.studentId}</span>
                    <span className={`text-[10px] px-1.5 rounded ${
                      s.status === 'returned' ? 'bg-emerald-900/50 text-emerald-300'
                        : s.status === 'graded' ? 'bg-amber-900/50 text-amber-300'
                        : 'bg-zinc-800 text-zinc-400'}`}>{s.status}</span>
                  </div>
                  <div className="text-zinc-300 mt-0.5">{s.content}</div>
                  {s.grade ? (
                    <div className="mt-1 text-[11px] text-emerald-300">
                      {s.grade.score}/{s.grade.maxPoints} ({s.grade.percent}%)
                      {s.grade.feedback && <span className="text-zinc-400"> — {s.grade.feedback}</span>}
                    </div>
                  ) : gradeForm?.subId === s.id ? (
                    <div className="mt-1.5 flex gap-1 items-center flex-wrap">
                      <input className={`${inputCls} w-20`} type="number" placeholder="Score"
                        value={gradeForm.score}
                        onChange={(e) => setGradeForm({ ...gradeForm, score: e.target.value })} />
                      <input className={`${inputCls} flex-1 min-w-[8rem]`} placeholder="Feedback"
                        value={gradeForm.feedback}
                        onChange={(e) => setGradeForm({ ...gradeForm, feedback: e.target.value })} />
                      <button onClick={() => grade(a.id)} className={btnCls}>Return</button>
                    </div>
                  ) : (
                    <button onClick={() => setGradeForm({ subId: s.id, score: '', feedback: '' })}
                      className="mt-1 text-[10px] px-2 py-0.5 rounded bg-cyan-900/50 text-cyan-300 hover:bg-cyan-900/70">
                      Grade
                    </button>
                  )}
                </div>
              ))}
            </div>
          )}
        </div>
      ))}
    </div>
  );
}

/* ── Gradebook ──────────────────────────────────────────────────────── */
function GradebookTab({ cohortId, flash }: TabProps) {
  const [data, setData] = useState<{
    assignments: Array<{ id: string; title: string; points: number }>;
    rows: GradebookRow[]; studentCount: number; classAverage: number | null;
  } | null>(null);

  const refresh = useCallback(async () => {
    const r = await run<{
      assignments: Array<{ id: string; title: string; points: number }>;
      rows: GradebookRow[]; studentCount: number; classAverage: number | null;
    }>('gradebook', cohortId != null ? { cohortId } : {});
    if (r) setData(r); else flash('err', 'Gradebook unavailable');
  }, [cohortId, flash]);

  useEffect(() => { void refresh(); }, [refresh]);

  const chartData = useMemo(
    () => (data?.rows ?? []).filter((r) => r.average != null)
      .map((r) => ({ student: r.studentId.slice(0, 8), average: r.average as number })),
    [data],
  );

  if (!data) return <p className="text-zinc-400 italic text-xs">Loading gradebook…</p>;
  if (data.rows.length === 0) {
    return <p className="text-zinc-400 italic text-xs">No graded submissions yet.</p>;
  }

  return (
    <div className="space-y-3">
      <div className={`${cardCls} flex gap-6 text-xs`}>
        <div><span className="text-zinc-400">Students</span> <span className="text-zinc-100 font-bold">{data.studentCount}</span></div>
        <div><span className="text-zinc-400">Class average</span> <span className="text-cyan-300 font-bold">{data.classAverage ?? '—'}%</span></div>
        <div><span className="text-zinc-400">Assignments</span> <span className="text-zinc-100 font-bold">{data.assignments.length}</span></div>
      </div>
      {chartData.length > 0 && (
        <div className={cardCls}>
          <h4 className="text-xs font-bold text-zinc-400 uppercase tracking-wider mb-2">Per-student average</h4>
          <ChartKit kind="bar" data={chartData} xKey="student"
            series={[{ key: 'average', label: 'Average %', color: '#06b6d4' }]} height={200} />
        </div>
      )}
      <div className={`${cardCls} overflow-x-auto`}>
        <table className="text-xs w-full">
          <thead>
            <tr className="text-zinc-400 text-[10px] uppercase">
              <th className="text-left py-1 pr-3">Student</th>
              {data.assignments.map((a) => (
                <th key={a.id} className="text-center px-2">{a.title}</th>
              ))}
              <th className="text-right pl-3">Total</th>
            </tr>
          </thead>
          <tbody>
            {data.rows.map((r) => (
              <tr key={r.studentId} className="border-t border-zinc-800">
                <td className="py-1 pr-3 font-mono text-[10px] text-zinc-400">{r.studentId.slice(0, 12)}</td>
                {r.cells.map((c) => (
                  <td key={c.assignmentId} className="text-center px-2 text-zinc-200">
                    {c.score != null ? `${c.score}/${c.maxPoints}`
                      : c.submitted ? <span className="text-amber-400">·</span>
                      : <span className="text-zinc-700">—</span>}
                  </td>
                ))}
                <td className="text-right pl-3 text-cyan-300 font-bold">
                  {r.average != null ? `${r.average}%` : '—'}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

/* ── Materials ──────────────────────────────────────────────────────── */
function MaterialsTab({ cohortId, flash }: TabProps) {
  const [byTopic, setByTopic] = useState<Record<string, Material[]>>({});
  const [form, setForm] = useState({ title: '', kind: 'link', url: '', topic: '', notes: '' });
  const [busy, setBusy] = useState(false);

  const refresh = useCallback(async () => {
    const r = await run<{ byTopic: Record<string, Material[]> }>('material-list',
      cohortId != null ? { cohortId } : {});
    setByTopic(r?.byTopic ?? {});
  }, [cohortId]);

  useEffect(() => { void refresh(); }, [refresh]);

  const add = async () => {
    if (!form.title.trim() || cohortId == null) { flash('err', 'Title + cohort required'); return; }
    setBusy(true);
    const r = await run('material-add', {
      cohortId, title: form.title.trim(), kind: form.kind,
      url: form.url || undefined, topic: form.topic || undefined, notes: form.notes,
    });
    setBusy(false);
    if (r) {
      flash('ok', 'Material added');
      setForm({ title: '', kind: 'link', url: '', topic: '', notes: '' });
      void refresh();
    } else flash('err', 'Add failed');
  };

  const remove = async (id: string) => {
    const r = await run('material-delete', { materialId: id });
    if (r) { flash('ok', 'Removed'); void refresh(); }
    else flash('err', 'Remove failed');
  };

  const topics = Object.keys(byTopic);

  return (
    <div className="space-y-3">
      <div className={cardCls}>
        <h4 className="text-xs font-bold text-cyan-300 uppercase tracking-wider mb-2">Add material</h4>
        <div className="grid sm:grid-cols-2 gap-2">
          <input className={inputCls} placeholder="Title" value={form.title}
            onChange={(e) => setForm({ ...form, title: e.target.value })} />
          <select className={inputCls} value={form.kind}
            onChange={(e) => setForm({ ...form, kind: e.target.value })}>
            <option value="link">Link</option>
            <option value="book">Book</option>
            <option value="dtu">DTU</option>
            <option value="file">File</option>
            <option value="note">Note</option>
          </select>
          <input className={inputCls} placeholder="URL (optional)" value={form.url}
            onChange={(e) => setForm({ ...form, url: e.target.value })} />
          <input className={inputCls} placeholder="Topic (optional)" value={form.topic}
            onChange={(e) => setForm({ ...form, topic: e.target.value })} />
          <textarea className={`${inputCls} sm:col-span-2`} rows={2} placeholder="Notes" value={form.notes}
            onChange={(e) => setForm({ ...form, notes: e.target.value })} />
        </div>
        <div className="mt-2">
          <button onClick={add} disabled={busy} className={btnCls}>
            {busy ? <Loader2 className="w-3 h-3 animate-spin" /> : <Plus className="w-3 h-3" />} Add
          </button>
        </div>
      </div>

      {topics.length === 0 ? (
        <p className="text-zinc-400 italic text-xs">No materials yet.</p>
      ) : topics.map((t) => (
        <div key={t} className={cardCls}>
          <h4 className="text-xs font-bold text-zinc-300 uppercase tracking-wider mb-1.5">{t}</h4>
          <ul className="space-y-1">
            {byTopic[t].map((m) => (
              <li key={m.id} className="flex justify-between items-start gap-2 bg-zinc-950/60 rounded p-2 text-xs">
                <div>
                  <span className="text-[9px] font-mono px-1 rounded bg-zinc-800 text-zinc-400 mr-1.5">{m.kind}</span>
                  {m.url ? (
                    <a href={m.url} target="_blank" rel="noreferrer" className="text-cyan-300 hover:underline">{m.title}</a>
                  ) : <span className="text-zinc-200">{m.title}</span>}
                  {m.notes && <div className="text-[10px] text-zinc-400 mt-0.5">{m.notes}</div>}
                </div>
                <button aria-label="Delete" onClick={() => remove(m.id)}
                  className="text-[10px] px-1.5 py-0.5 rounded bg-rose-900/40 text-rose-300 hover:bg-rose-900/60">
                  <Trash2 className="w-3 h-3" />
                </button>
              </li>
            ))}
          </ul>
        </div>
      ))}
    </div>
  );
}

/* ── Student to-do list ─────────────────────────────────────────────── */
function TodoTab({ cohortId }: { cohortId: number | null }) {
  const [data, setData] = useState<{
    upcoming: TodoItem[]; missing: TodoItem[]; done: TodoItem[];
    counts: { upcoming: number; missing: number; done: number };
  } | null>(null);
  const [studentId, setStudentId] = useState('');

  const refresh = useCallback(async () => {
    const r = await run<{
      upcoming: TodoItem[]; missing: TodoItem[]; done: TodoItem[];
      counts: { upcoming: number; missing: number; done: number };
    }>('todo', { cohortId: cohortId ?? undefined, studentId: studentId || undefined });
    setData(r);
  }, [cohortId, studentId]);

  useEffect(() => { void refresh(); }, [refresh]);

  const section = (title: string, items: TodoItem[], tone: string) => (
    <div className={cardCls}>
      <h4 className={`text-xs font-bold uppercase tracking-wider mb-1.5 ${tone}`}>
        {title} ({items.length})
      </h4>
      {items.length === 0 ? (
        <p className="text-zinc-600 italic text-[11px]">Nothing here.</p>
      ) : (
        <ul className="space-y-1">
          {items.map((i) => (
            <li key={i.assignmentId} className="bg-zinc-950/60 rounded p-2 text-xs flex justify-between gap-2">
              <span className="text-zinc-200">{i.title}</span>
              <span className="text-[10px] text-zinc-400 whitespace-nowrap">
                {i.score != null ? `${i.score} pts`
                  : i.dueAt ? `due ${new Date(i.dueAt).toLocaleDateString()}` : `${i.points} pts`}
              </span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );

  return (
    <div className="space-y-3">
      <div className={`${cardCls} flex gap-2 items-center`}>
        <input className={inputCls} placeholder="View as student id (blank = me)"
          value={studentId} onChange={(e) => setStudentId(e.target.value)} />
        <button onClick={() => void refresh()} className={btnCls}>View</button>
      </div>
      {data ? (
        <>
          {section('Missing', data.missing, 'text-rose-400')}
          {section('Upcoming', data.upcoming, 'text-amber-400')}
          {section('Done', data.done, 'text-emerald-400')}
        </>
      ) : <p className="text-zinc-400 italic text-xs">Loading…</p>}
    </div>
  );
}

/* ── Quizzes (builder + auto-graded attempts) ───────────────────────── */
interface DraftQuestion { kind: string; prompt: string; options: string[]; correctAnswer: string; points: string }
function QuizzesTab({ cohortId, flash }: TabProps) {
  const [quizzes, setQuizzes] = useState<Quiz[]>([]);
  const [title, setTitle] = useState('');
  const [questions, setQuestions] = useState<DraftQuestion[]>([
    { kind: 'multiple_choice', prompt: '', options: ['', ''], correctAnswer: '', points: '1' },
  ]);
  const [busy, setBusy] = useState(false);
  const [taking, setTaking] = useState<Quiz | null>(null);
  const [answers, setAnswers] = useState<Record<string, string>>({});
  const [result, setResult] = useState<QuizAttempt | null>(null);
  const [attempts, setAttempts] = useState<{ count: number; averagePercent: number | null } | null>(null);

  const refresh = useCallback(async () => {
    const r = await run<{ quizzes: Quiz[] }>('quiz-list', cohortId != null ? { cohortId } : {});
    setQuizzes(r?.quizzes ?? []);
  }, [cohortId]);

  useEffect(() => { void refresh(); }, [refresh]);

  const setQ = (i: number, patch: Partial<DraftQuestion>) =>
    setQuestions((qs) => qs.map((q, idx) => (idx === i ? { ...q, ...patch } : q)));

  const create = async () => {
    if (!title.trim() || cohortId == null) { flash('err', 'Title + cohort required'); return; }
    setBusy(true);
    const r = await run('quiz-create', {
      cohortId, title: title.trim(),
      questions: questions.map((q) => ({
        kind: q.kind, prompt: q.prompt,
        options: q.kind === 'multiple_choice' ? q.options.filter(Boolean) : undefined,
        correctAnswer: q.correctAnswer, points: Number(q.points) || 1,
      })),
    });
    setBusy(false);
    if (r) {
      flash('ok', 'Quiz created');
      setTitle('');
      setQuestions([{ kind: 'multiple_choice', prompt: '', options: ['', ''], correctAnswer: '', points: '1' }]);
      void refresh();
    } else flash('err', 'Quiz create failed — check question prompts/options');
  };

  const take = async (q: Quiz) => {
    const r = await run<{ quiz: Quiz }>('quiz-get', { quizId: q.id });
    if (r?.quiz) { setTaking(r.quiz); setAnswers({}); setResult(null); }
  };

  const submitQuiz = async () => {
    if (!taking) return;
    const r = await run<QuizAttempt>('quiz-submit', { quizId: taking.id, answers });
    if (r) {
      setResult(r);
      flash('ok', `Scored ${r.score}/${r.totalPoints} (${r.percent}%)`);
      const ar = await run<{ count: number; averagePercent: number | null }>('quiz-attempts', { quizId: taking.id });
      setAttempts(ar);
      void refresh();
    } else flash('err', 'Quiz submit failed');
  };

  return (
    <div className="space-y-3">
      <div className={cardCls}>
        <h4 className="text-xs font-bold text-cyan-300 uppercase tracking-wider mb-2">Quiz builder</h4>
        <input className={inputCls} placeholder="Quiz title" value={title}
          onChange={(e) => setTitle(e.target.value)} />
        <div className="mt-2 space-y-2">
          {questions.map((q, i) => (
            <div key={i} className="bg-zinc-950/60 rounded p-2 space-y-1">
              <div className="flex gap-1">
                <select className={`${inputCls} w-36`} value={q.kind}
                  onChange={(e) => setQ(i, { kind: e.target.value })}>
                  <option value="multiple_choice">Multiple choice</option>
                  <option value="true_false">True / false</option>
                  <option value="short_answer">Short answer</option>
                </select>
                <input className={`${inputCls} w-20`} type="number" min={1} placeholder="Points"
                  value={q.points} onChange={(e) => setQ(i, { points: e.target.value })} />
                {questions.length > 1 && (
                  <button aria-label="Delete" onClick={() => setQuestions((qs) => qs.filter((_, idx) => idx !== i))}
                    className="text-[10px] px-1.5 rounded bg-rose-900/40 text-rose-300">
                    <Trash2 className="w-3 h-3" />
                  </button>
                )}
              </div>
              <input className={inputCls} placeholder={`Question ${i + 1} prompt`} value={q.prompt}
                onChange={(e) => setQ(i, { prompt: e.target.value })} />
              {q.kind === 'multiple_choice' && (
                <div className="grid grid-cols-2 gap-1">
                  {q.options.map((opt, oi) => (
                    <input key={oi} className={inputCls} placeholder={`Option ${oi + 1}`} value={opt}
                      onChange={(e) => setQ(i, {
                        options: q.options.map((o, idx) => (idx === oi ? e.target.value : o)),
                      })} />
                  ))}
                  <button onClick={() => setQ(i, { options: [...q.options, ''] })}
                    className="text-[10px] text-cyan-400 hover:underline text-left">+ option</button>
                </div>
              )}
              <input className={inputCls}
                placeholder={q.kind === 'true_false' ? 'Correct answer (True / False)' : 'Correct answer'}
                value={q.correctAnswer}
                onChange={(e) => setQ(i, { correctAnswer: e.target.value })} />
            </div>
          ))}
        </div>
        <div className="mt-2 flex gap-2">
          <button onClick={() => setQuestions((qs) => [...qs,
            { kind: 'multiple_choice', prompt: '', options: ['', ''], correctAnswer: '', points: '1' }])}
            className="text-xs px-2.5 py-1 rounded bg-zinc-800 text-zinc-300 hover:bg-zinc-700">
            + Question
          </button>
          <button onClick={create} disabled={busy} className={btnCls}>
            {busy ? <Loader2 className="w-3 h-3 animate-spin" /> : <Plus className="w-3 h-3" />} Create quiz
          </button>
        </div>
      </div>

      {quizzes.length === 0 ? (
        <p className="text-zinc-400 italic text-xs">No quizzes yet.</p>
      ) : quizzes.map((q) => (
        <div key={q.id} className={cardCls}>
          <div className="flex justify-between gap-2 items-start">
            <div>
              <div className="text-sm font-semibold text-zinc-100">{q.title}</div>
              <div className="text-[10px] text-zinc-400 mt-0.5">
                {q.questionCount ?? q.questions.length} questions · {q.totalPoints} pts · {q.attemptCount ?? 0} attempts
              </div>
            </div>
            <button onClick={() => take(q)} className={btnCls}>Take</button>
          </div>
        </div>
      ))}

      {taking && (
        <div className={`${cardCls} border-cyan-700/50`}>
          <h4 className="text-sm font-bold text-cyan-300 mb-2">{taking.title}</h4>
          <div className="space-y-2">
            {taking.questions.map((q, i) => (
              <div key={q.id} className="bg-zinc-950/60 rounded p-2">
                <div className="text-xs text-zinc-200 mb-1">{i + 1}. {q.prompt} <span className="text-zinc-400">({q.points} pt)</span></div>
                {q.kind === 'short_answer' ? (
                  <input className={inputCls} placeholder="Your answer"
                    value={answers[q.id] ?? ''}
                    onChange={(e) => setAnswers({ ...answers, [q.id]: e.target.value })} />
                ) : (
                  <div className="flex flex-col gap-0.5">
                    {q.options.map((opt) => (
                      <label key={opt} className="flex items-center gap-1.5 text-xs text-zinc-300 cursor-pointer">
                        <input type="radio" name={q.id} checked={answers[q.id] === opt}
                          onChange={() => setAnswers({ ...answers, [q.id]: opt })} />
                        {opt}
                      </label>
                    ))}
                  </div>
                )}
              </div>
            ))}
          </div>
          <div className="mt-2 flex gap-2">
            <button onClick={submitQuiz} className={btnCls}>Submit quiz</button>
            <button onClick={() => { setTaking(null); setResult(null); }}
              className="text-xs px-2.5 py-1 rounded bg-zinc-800 text-zinc-300">Close</button>
          </div>

          {result && (
            <div className="mt-3 border-t border-zinc-800 pt-2">
              <div className="text-sm font-bold text-emerald-300">
                Auto-graded: {result.score}/{result.totalPoints} ({result.percent}%)
              </div>
              {attempts && (
                <div className="text-[10px] text-zinc-400">
                  {attempts.count} attempts · class average {attempts.averagePercent ?? '—'}%
                </div>
              )}
              <ul className="mt-1.5 space-y-1">
                {result.breakdown.map((b) => (
                  <li key={b.questionId} className="text-[11px] flex justify-between gap-2 bg-zinc-950/60 rounded p-1.5">
                    <span className="text-zinc-300">{b.prompt}</span>
                    <span className={b.correct ? 'text-emerald-400' : 'text-rose-400'}>
                      {b.correct ? `+${b.awarded}` : `0 (→ ${b.correctAnswer})`}
                    </span>
                  </li>
                ))}
              </ul>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
