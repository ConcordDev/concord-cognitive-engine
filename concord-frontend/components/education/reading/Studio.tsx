'use client';

/**
 * Teaching: anyone can write a course here. The list of your courses, and
 * the course desk: its title page, its lessons (a reading, a video you
 * upload or link, and a check you write the answers to), publishing it free
 * or for sale in CC, and your learners — the funnel, how each check is
 * going, the money and the reviews.
 */
import { useCallback, useEffect, useState } from 'react';
import { ArrowDown, ArrowUp, Eye, Plus, Trash2, Upload } from 'lucide-react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { cc, isSignedOutError, LEVELS, rx, uploadVideo, type AuthorLesson, type AuthorQuestion, type CourseCard, type Learners, type Level, type MyLearning, type Studio as StudioData } from './rr';

export function Teaching({ onStudio, onToast }: { onStudio: (id: string) => void; onToast: (m: string) => void }) {
  const [courses, setCourses] = useState<CourseCard[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [title, setTitle] = useState('');
  useEffect(() => { void rx<MyLearning>('rr-my-learning').then((r) => { if (!r.ok) setError(r.error); else setCourses(r.result!.teaching); }); }, []);
  if (error) return <div className="mx-auto max-w-3xl p-6"><div className="rr-page p-6">{isSignedOutError(error) ? <><p className="rr-book text-[20px]">Sign in to teach.</p><p className="mt-2 text-[14px] text-[var(--rr-ink-2)]">Anyone can write a course and publish it free or for sale.</p></> : <p className="rr-error" role="alert">{error}</p>}</div></div>;
  return (
    <div className="mx-auto w-full max-w-4xl px-4 py-6 md:px-6" data-testid="rr-teaching">
      <h2 className="rr-book text-[24px] text-[#f0e6cc]">Your courses</h2>
      <form className="mt-3 flex gap-2" onSubmit={async (e) => {
        e.preventDefault(); if (!title.trim()) return;
        const r = await rx<{ course: CourseCard }>('rr-course-save', { title: title.trim() });
        if (!r.ok) { onToast(r.error || 'Not created.'); return; }
        onStudio(r.result!.course.id);
      }}>
        <input className="rr-input rr-input-room flex-1" value={title} onChange={(e) => setTitle(e.target.value)} maxLength={160} placeholder="Title of a new course" aria-label="New course title" data-testid="rr-new-course" />
        <button type="submit" className="rr-btn rr-btn-lamp" disabled={!title.trim()}><Plus className="h-4 w-4" /> Start writing</button>
      </form>
      {!courses ? <div className="rr-skeleton mt-4 h-32" aria-busy="true" /> : courses.length === 0 ? (
        <p className="mt-4 text-[14px] text-[#e8dcbc]">No courses yet. Give your first one a title above; it stays a draft, visible only to you, until you publish it.</p>
      ) : (
        <ul className="mt-4 space-y-2">
          {courses.map((c) => (
            <li key={c.id}>
              <button type="button" className="rr-page flex w-full items-center gap-3 p-4 text-left transition-transform hover:-translate-y-0.5" onClick={() => onStudio(c.id)} data-testid={`rr-teach-${c.id}`}>
                <span className="min-w-0 flex-1"><span className="rr-book block text-[17px] font-bold">{c.title}</span><span className="text-[12.5px] text-[var(--rr-ink-2)]">{c.lessons} lessons · {c.learners} learners{c.rating != null ? ` · ★ ${c.rating.toFixed(1)}` : ''} · {c.priceCC > 0 ? cc(c.priceCC) : 'free'}</span></span>
                <span className={`rr-stamp rr-type text-[11px] ${c.status === 'published' ? 'text-[var(--rr-good)]' : 'text-[var(--rr-muted)]'}`}>{c.status === 'published' ? 'ON THE SHELF' : 'DRAFT'}</span>
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

type Pane = 'page' | 'lessons' | 'learners';

export function StudioDesk({ id, onBack, onPreview, onToast }: { id: string; onBack: () => void; onPreview: (id: string) => void; onToast: (m: string) => void }) {
  const [data, setData] = useState<StudioData | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pane, setPane] = useState<Pane>('lessons');
  // Which editor is open: a lesson id, or `new-N` for an unsaved lesson. A
  // save only moves the view if that same editor is still open, so moving on
  // while a save is in flight never drops you into the wrong lesson.
  const [editing, setEditing] = useState<string | null>(null);
  const [newSeq, setNewSeq] = useState(0);
  const load = useCallback(async () => {
    const r = await rx<StudioData>('rr-studio', { id });
    if (!r.ok) { setError(r.error); return; }
    setError(null); setData(r.result);
  }, [id]);
  useEffect(() => { void load(); }, [load]);
  if (error) return <div className="mx-auto max-w-3xl p-6"><button type="button" className="rr-btn rr-btn-room h-8" onClick={onBack}>Your courses</button><p className="rr-room-error mt-4" role="alert">{error}</p></div>;
  if (!data) return <div className="mx-auto max-w-5xl p-6" aria-busy="true"><div className="rr-skeleton h-[420px]" /></div>;
  const c = data.course;
  const published = c.status === 'published';

  async function publish(on: boolean) {
    const r = await rx('rr-publish', { id, publish: on });
    if (!r.ok) { onToast(r.error || 'Not published.'); return; }
    onToast(on ? (c.priceCC > 0 ? `On the shelf for ${cc(c.priceCC)}.` : 'On the shelf, free.') : 'Taken off the shelf.');
    await load();
  }

  return (
    <div className="mx-auto w-full max-w-6xl px-4 py-6 md:px-6" data-testid="rr-studio">
      <div className="flex flex-wrap items-center gap-2">
        <button type="button" className="rr-btn rr-btn-room h-8" onClick={onBack}>Your courses</button>
        <h2 className="rr-book min-w-0 flex-1 truncate text-[22px] text-[#f0e6cc]">{c.title}</h2>
        <span className={`rr-stamp rr-type text-[11px] ${published ? 'text-[#9fd8b0]' : 'text-[#e8dcbc]'}`}>{published ? 'ON THE SHELF' : 'DRAFT'}</span>
        <button type="button" className="rr-btn rr-btn-room h-8" onClick={() => onPreview(id)}><Eye className="h-4 w-4" /> See it as a learner</button>
        {published
          ? <button type="button" className="rr-btn rr-btn-room h-8" onClick={() => publish(false)} data-testid="rr-unpublish">Take off the shelf</button>
          : <button type="button" className="rr-btn rr-btn-lamp h-8" onClick={() => publish(true)} data-testid="rr-publish">Publish{c.priceCC > 0 ? ` for ${cc(c.priceCC)}` : ' free'}</button>}
      </div>
      <div role="tablist" aria-label="Course desk" className="mt-4 flex gap-1">
        {(['page', 'lessons', 'learners'] as Pane[]).map((p) => <button key={p} type="button" role="tab" aria-selected={pane === p} className="rr-room" aria-current={pane === p ? 'page' : undefined} onClick={() => setPane(p)} data-testid={`rr-pane-${p}`}>{p === 'page' ? 'Title page' : p === 'lessons' ? `Lessons (${data.lessons.length})` : 'Learners'}</button>)}
      </div>

      {pane === 'page' && <CourseForm data={data} onSaved={load} onToast={onToast} />}
      {pane === 'lessons' && (
        <div className="mt-4 grid gap-4 lg:grid-cols-[280px_1fr]">
          <div className="rr-page self-start p-3">
            {data.lessons.length === 0 ? <p className="p-2 text-[13.5px] text-[var(--rr-ink-2)]">No lessons yet. A lesson can be a reading, a video, a check, or all three.</p> : (
              <ol className="space-y-1">
                {data.lessons.map((l, i) => (
                  <li key={l.id} className={`flex items-center gap-1 rounded ${editing === l.id ? 'bg-[rgba(46,107,76,0.12)]' : ''}`}>
                    <button type="button" className="min-w-0 flex-1 truncate px-2 py-1.5 text-left text-[13.5px]" onClick={() => setEditing(l.id)} data-testid={`rr-edit-lesson-${i + 1}`}><span className="rr-num text-[var(--rr-ink-2)]">{i + 1}.</span> {l.title}{l.check ? <span className="text-[11px] text-[var(--rr-ink-2)]"> · {l.check.questions.length}q</span> : null}{l.preview ? <span className="text-[11px] text-[var(--rr-lamp)]"> · preview</span> : null}</button>
                    <button type="button" className="rr-btn rr-btn-ghost h-7 px-1" aria-label="Move up" disabled={i === 0} onClick={async () => { const r = await rx('rr-lesson-move', { courseId: id, lessonId: l.id, toIndex: i - 1 }); if (!r.ok) onToast(r.error || ''); await load(); }}><ArrowUp className="h-3.5 w-3.5" /></button>
                    <button type="button" className="rr-btn rr-btn-ghost h-7 px-1" aria-label="Move down" disabled={i === data.lessons.length - 1} onClick={async () => { const r = await rx('rr-lesson-move', { courseId: id, lessonId: l.id, toIndex: i + 1 }); if (!r.ok) onToast(r.error || ''); await load(); }}><ArrowDown className="h-3.5 w-3.5" /></button>
                  </li>
                ))}
              </ol>
            )}
            <button type="button" className="rr-btn rr-btn-lamp mt-3 w-full" onClick={() => { const n = newSeq + 1; setNewSeq(n); setEditing(`new-${n}`); }} data-testid="rr-add-lesson"><Plus className="h-4 w-4" /> Add a lesson</button>
          </div>
          {editing ? (
            <LessonEditor key={editing} courseId={id} lesson={editing.startsWith('new-') ? null : data.lessons.find((l) => l.id === editing) || null} published={published}
              onSaved={async (lid) => { const from = editing; await load(); setEditing((cur) => (cur === from ? lid : cur)); }}
              onDeleted={async () => { const from = editing; setEditing((cur) => (cur === from ? null : cur)); await load(); }} onToast={onToast} />
          ) : (
            <div className="rr-page p-6 text-[14px] text-[var(--rr-ink-2)]">Pick a lesson to edit, or add one.</div>
          )}
        </div>
      )}
      {pane === 'learners' && <LearnersPane id={id} />}
    </div>
  );
}

function CourseForm({ data, onSaved, onToast }: { data: StudioData; onSaved: () => void; onToast: (m: string) => void }) {
  const c = data.course;
  const [f, setF] = useState({ title: c.title, summary: c.summary === c.description.slice(0, 200) ? '' : c.summary, description: c.description, category: c.category, level: c.level, outcomes: (c.outcomes || []).join('\n'), price: c.priceCC ? String(c.priceCC) : '' });
  const [saving, setSaving] = useState(false);
  const priceNum = f.price.trim() === '' ? 0 : Number(f.price);
  return (
    <form className="rr-page mt-4 grid gap-4 p-6 md:grid-cols-2" data-testid="rr-course-form" onSubmit={async (e) => {
      e.preventDefault(); setSaving(true);
      const r = await rx('rr-course-save', { id: c.id, title: f.title, summary: f.summary, description: f.description, category: f.category, level: f.level, outcomes: f.outcomes.split('\n').map((x) => x.trim()).filter(Boolean), priceCC: Math.round(priceNum * 100) / 100 });
      setSaving(false);
      if (!r.ok) { onToast(r.error || 'Not saved.'); return; }
      onToast('Saved.'); onSaved();
    }}>
      <label className="md:col-span-2"><span className="text-[12.5px] font-semibold">Title</span><input className="rr-input mt-1" value={f.title} maxLength={160} onChange={(e) => setF({ ...f, title: e.target.value })} /></label>
      <label className="md:col-span-2"><span className="text-[12.5px] font-semibold">In one or two sentences</span><input className="rr-input mt-1" value={f.summary} maxLength={300} onChange={(e) => setF({ ...f, summary: e.target.value })} placeholder="What a learner gets from this course" data-testid="rr-summary" /></label>
      <label><span className="text-[12.5px] font-semibold">Subject</span><input className="rr-input mt-1" value={f.category} maxLength={40} onChange={(e) => setF({ ...f, category: e.target.value })} placeholder="e.g. engineering" /></label>
      <label><span className="text-[12.5px] font-semibold">Level</span><select className="rr-input mt-1" value={f.level} onChange={(e) => setF({ ...f, level: e.target.value as Level })}>{LEVELS.map((l) => <option key={l} value={l}>{l}</option>)}</select></label>
      <label className="md:col-span-2"><span className="text-[12.5px] font-semibold">You will learn to… (one per line)</span><textarea className="rr-input mt-1" rows={4} value={f.outcomes} onChange={(e) => setF({ ...f, outcomes: e.target.value })} /></label>
      <label className="md:col-span-2"><span className="text-[12.5px] font-semibold">About the course (markdown)</span><textarea className="rr-input mt-1" rows={6} value={f.description} maxLength={8000} onChange={(e) => setF({ ...f, description: e.target.value })} /></label>
      <label><span className="text-[12.5px] font-semibold">Price in CC (blank or 0 is free)</span><input className="rr-input mt-1" inputMode="decimal" value={f.price} onChange={(e) => setF({ ...f, price: e.target.value })} placeholder="0" data-testid="rr-price" />
        <span className="mt-1 block text-[12px] text-[var(--rr-ink-2)]">{Number.isFinite(priceNum) && priceNum > 0 ? `Sold through the marketplace: you keep ${cc(Math.round(priceNum * 95) / 100)} of each sale (5% platform fee). ${c.status === 'published' ? 'To switch between free and paid, take the course off the shelf first.' : ''}` : 'Free: anyone can enroll.'}</span>
      </label>
      <div className="flex items-end md:col-span-2"><button type="submit" className="rr-btn rr-btn-lamp" disabled={saving || !f.title.trim() || !Number.isFinite(priceNum)}>{saving ? 'Saving…' : 'Save title page'}</button></div>
    </form>
  );
}

type Q = AuthorQuestion & { key: string };
// Row keys for the check builder (React identity only; never saved).
let keySeq = 0;
const nextKey = () => `q-row-${++keySeq}`;
const blankQ = (type: Q['type'] = 'choice'): Q => ({ key: nextKey(), id: '', type, prompt: '', options: type === 'choice' || type === 'multi' ? ['', ''] : undefined, answer: type === 'multi' ? [] : type === 'text' ? [] : undefined, explain: '' });

function LessonEditor({ courseId, lesson, published, onSaved, onDeleted, onToast }: {
  courseId: string; lesson: AuthorLesson | null; published: boolean; onSaved: (id: string) => void; onDeleted: () => void; onToast: (m: string) => void;
}) {
  const [title, setTitle] = useState(lesson?.title || '');
  const [body, setBody] = useState(lesson?.body || '');
  const [duration, setDuration] = useState(String(lesson?.durationMin || ''));
  const [preview, setPreview] = useState(!!lesson?.preview);
  const [video, setVideo] = useState<{ mediaId?: string; url?: string } | null>(lesson?.video || null);
  const [videoMode, setVideoMode] = useState<'none' | 'upload' | 'link'>(lesson?.video?.mediaId ? 'upload' : lesson?.video?.url ? 'link' : 'none');
  const [uploading, setUploading] = useState(false);
  const [showPreview, setShowPreview] = useState(false);
  const [questions, setQuestions] = useState<Q[]>(() => (lesson?.check?.questions || []).map((q) => ({ ...q, key: nextKey() })));
  const [passMark, setPassMark] = useState(Math.round((lesson?.check?.passMark || 0.7) * 100));
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const setQ = (i: number, patch: Partial<Q>) => setQuestions(questions.map((q, j) => (j === i ? { ...q, ...patch } : q)));

  async function save() {
    setSaving(true); setError(null);
    const check = questions.length ? { passMark: passMark / 100, questions: questions.map((q, i) => ({ id: q.id || `q${i + 1}`, type: q.type, prompt: q.prompt, options: q.options?.filter((o) => o.trim()), answer: q.answer, tolerance: q.tolerance, explain: q.explain })) } : null;
    const r = await rx<{ lesson: AuthorLesson }>('rr-lesson-save', {
      courseId, ...(lesson ? { lessonId: lesson.id } : {}), title, body, durationMin: Number(duration) || 0, preview,
      video: videoMode === 'none' ? null : video, check,
    });
    setSaving(false);
    if (!r.ok) { setError(r.error || 'Not saved.'); return; }
    onToast('Lesson saved.'); onSaved(r.result!.lesson.id);
  }

  return (
    <div className="rr-page p-5 md:p-6" data-testid="rr-lesson-editor">
      <div className="flex flex-wrap items-center gap-2">
        <input className="rr-input rr-book flex-1 text-[18px]" value={title} onChange={(e) => setTitle(e.target.value)} placeholder="Lesson title" aria-label="Lesson title" maxLength={160} data-testid="rr-lesson-title-input" />
        <input className="rr-input w-24" inputMode="numeric" value={duration} onChange={(e) => setDuration(e.target.value.replace(/\D/g, ''))} placeholder="min" aria-label="Minutes" />
        <label className="flex items-center gap-1.5 text-[13px]"><input type="checkbox" checked={preview} onChange={(e) => setPreview(e.target.checked)} className="accent-[var(--rr-lamp)]" /> Open preview</label>
      </div>

      <section className="mt-5">
        <div className="flex items-center justify-between"><h3 className="rr-type text-[14px]">Reading</h3><button type="button" className="text-[12.5px] underline" onClick={() => setShowPreview(!showPreview)}>{showPreview ? 'Write' : 'Preview'}</button></div>
        {showPreview ? <div className="rr-prose mt-2 min-h-[160px] rounded border border-[var(--rr-line)] p-4">{body ? <ReactMarkdown remarkPlugins={[remarkGfm]}>{body}</ReactMarkdown> : <p className="text-[var(--rr-muted)]">Nothing written yet.</p>}</div>
          : <textarea className="rr-input rr-book mt-2 text-[15px]" rows={12} value={body} onChange={(e) => setBody(e.target.value)} placeholder={'Write the lesson in markdown.\n\n# Headings, **bold**, lists, tables and links all work.'} aria-label="Reading" data-testid="rr-lesson-body" />}
        <p className="rr-num mt-1 text-right text-[11.5px] text-[var(--rr-muted)]">{body.length.toLocaleString()} / 60,000</p>
      </section>

      <section className="mt-4">
        <h3 className="rr-type text-[14px]">Video</h3>
        <div className="mt-2 flex flex-wrap gap-3 text-[13px]">
          {(['none', 'upload', 'link'] as const).map((m) => <label key={m} className="flex items-center gap-1.5"><input type="radio" name="vmode" checked={videoMode === m} onChange={() => setVideoMode(m)} className="accent-[var(--rr-lamp)]" />{m === 'none' ? 'No video' : m === 'upload' ? 'Upload a video' : 'Link (YouTube, Vimeo, or a https file)'}</label>)}
        </div>
        {videoMode === 'upload' && (
          <div className="mt-2 flex flex-wrap items-center gap-2">
            <label className="rr-btn cursor-pointer"><Upload className="h-4 w-4" />{uploading ? 'Uploading…' : video?.mediaId ? 'Replace video' : 'Choose a video'}
              <input type="file" accept="video/*" className="sr-only" disabled={uploading} onChange={async (e) => {
                const file = e.target.files?.[0]; e.target.value = ''; if (!file) return;
                setUploading(true); const r = await uploadVideo(file, title || file.name); setUploading(false);
                if (!r.ok) { setError(r.error); return; }
                setVideo({ mediaId: r.mediaId }); onToast('Video uploaded. Save the lesson to keep it.');
              }} />
            </label>
            {video?.mediaId && <span className="text-[12.5px] text-[var(--rr-ink-2)]">Uploaded · plays for {published ? 'learners now' : 'learners once published'}{preview ? '' : ' (enrolled learners only)'}</span>}
          </div>
        )}
        {videoMode === 'link' && <input className="rr-input mt-2" value={video?.url || ''} onChange={(e) => setVideo({ url: e.target.value })} placeholder="https://www.youtube.com/watch?v=…" aria-label="Video link" />}
      </section>

      <section className="mt-5" data-testid="rr-check-builder">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h3 className="rr-type text-[14px]">Check {questions.length ? `· ${questions.length} questions` : ''}</h3>
          {questions.length > 0 && <label className="flex items-center gap-2 text-[13px]">Pass at <input type="range" min={50} max={100} step={5} value={passMark} onChange={(e) => setPassMark(Number(e.target.value))} aria-label="Pass mark" /> <span className="rr-num w-10 font-semibold">{passMark}%</span></label>}
        </div>
        <p className="mt-1 text-[12.5px] text-[var(--rr-ink-2)]">Graded on the server: learners never see your answers until they pass. A lesson with a check is done only when its check is passed.</p>
        <ol className="mt-3 space-y-3">
          {questions.map((q, i) => (
            <li key={q.key} className="rounded border border-[var(--rr-line)] bg-[rgba(255,255,255,0.4)] p-3" data-testid={`rr-builder-q-${i + 1}`}>
              <div className="flex flex-wrap items-center gap-2">
                <span className="rr-num text-[13px] font-semibold">{i + 1}.</span>
                <select className="rr-input h-8 w-auto" value={q.type} onChange={(e) => { const t = e.target.value as Q['type']; setQ(i, { ...blankQ(t), key: q.key, prompt: q.prompt, explain: q.explain, options: t === 'choice' || t === 'multi' ? (q.options?.length ? q.options : ['', '']) : undefined }); }} aria-label="Question type">
                  <option value="choice">One right option</option><option value="multi">Several right options</option><option value="numeric">A number</option><option value="text">A word or phrase</option>
                </select>
                <button type="button" className="rr-btn rr-btn-ghost rr-btn-danger ml-auto h-8 px-2" aria-label="Remove question" onClick={() => setQuestions(questions.filter((_, j) => j !== i))}><Trash2 className="h-4 w-4" /></button>
              </div>
              <input className="rr-input mt-2" value={q.prompt} onChange={(e) => setQ(i, { prompt: e.target.value })} placeholder="The question" aria-label="Question" maxLength={1000} />
              {(q.type === 'choice' || q.type === 'multi') && (
                <div className="mt-2 space-y-1.5">
                  {(q.options || []).map((o, k) => {
                    const right = q.type === 'choice' ? q.answer === k : Array.isArray(q.answer) && (q.answer as number[]).includes(k);
                    return (
                      <div key={k} className="flex items-center gap-2">
                        <input type={q.type === 'choice' ? 'radio' : 'checkbox'} name={`right-${q.key}`} checked={right} aria-label={`Option ${k + 1} is right`} className="accent-[var(--rr-good)]"
                          onChange={() => setQ(i, { answer: q.type === 'choice' ? k : right ? (q.answer as number[]).filter((x) => x !== k) : [...((q.answer as number[]) || []), k] })} />
                        <input className="rr-input h-8" value={o} onChange={(e) => setQ(i, { options: q.options!.map((x, m) => (m === k ? e.target.value : x)) })} placeholder={`Option ${k + 1}`} aria-label={`Option ${k + 1}`} maxLength={300} />
                        {(q.options || []).length > 2 && <button type="button" className="rr-btn rr-btn-ghost h-8 px-1" aria-label="Remove option" onClick={() => setQ(i, { options: q.options!.filter((_, m) => m !== k), answer: q.type === 'choice' ? (q.answer === k ? undefined : typeof q.answer === 'number' && q.answer > k ? q.answer - 1 : q.answer) : ((q.answer as number[]) || []).filter((x) => x !== k).map((x) => (x > k ? x - 1 : x)) })}>×</button>}
                      </div>
                    );
                  })}
                  {(q.options || []).length < 8 && <button type="button" className="text-[12.5px] underline" onClick={() => setQ(i, { options: [...(q.options || []), ''] })}>Add an option</button>}
                  <p className="text-[11.5px] text-[var(--rr-ink-2)]">Tick the {q.type === 'choice' ? 'right option' : 'right options'}.</p>
                </div>
              )}
              {q.type === 'numeric' && (
                <div className="mt-2 flex flex-wrap gap-2">
                  <label className="text-[12.5px]">Answer <input className="rr-input mt-1 h-8 w-32" inputMode="decimal" value={q.answer === undefined ? '' : String(q.answer)} onChange={(e) => setQ(i, { answer: e.target.value === '' ? undefined : (Number(e.target.value) as number) })} /></label>
                  <label className="text-[12.5px]">± tolerance <input className="rr-input mt-1 h-8 w-28" inputMode="decimal" value={q.tolerance ? String(q.tolerance) : ''} onChange={(e) => setQ(i, { tolerance: Number(e.target.value) || 0 })} placeholder="0" /></label>
                </div>
              )}
              {q.type === 'text' && <input className="rr-input mt-2" value={Array.isArray(q.answer) ? (q.answer as string[]).join(', ') : ''} onChange={(e) => setQ(i, { answer: e.target.value.split(',').map((x) => x.trim()) })} placeholder="Accepted answers, separated by commas (case doesn't matter)" aria-label="Accepted answers" />}
              <input className="rr-input mt-2" value={q.explain || ''} onChange={(e) => setQ(i, { explain: e.target.value })} placeholder="Why (shown after they hand it in)" aria-label="Explanation" maxLength={1500} />
            </li>
          ))}
        </ol>
        <button type="button" className="rr-btn mt-3" onClick={() => setQuestions([...questions, blankQ()])} data-testid="rr-add-question"><Plus className="h-4 w-4" /> Add a question</button>
      </section>

      {error && <p className="rr-error mt-4" role="alert">{error}</p>}
      <div className="mt-5 flex flex-wrap items-center gap-2 border-t border-[var(--rr-line)] pt-4">
        <button type="button" className="rr-btn rr-btn-lamp" disabled={saving || !title.trim()} onClick={save} data-testid="rr-save-lesson">{saving ? 'Saving…' : lesson ? 'Save lesson' : 'Add lesson'}</button>
        {lesson && <button type="button" className="rr-btn rr-btn-ghost rr-btn-danger ml-auto" onClick={async () => { if (!window.confirm(`Delete “${lesson.title}”? Learners' progress on it goes too.`)) return; const r = await rx('rr-lesson-delete', { courseId, lessonId: lesson.id }); if (!r.ok) { onToast(r.error || 'Not deleted.'); return; } onDeleted(); }}><Trash2 className="h-4 w-4" /> Delete lesson</button>}
      </div>
    </div>
  );
}

function LearnersPane({ id }: { id: string }) {
  const [d, setD] = useState<Learners | null>(null);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => { void rx<Learners>('rr-learners', { courseId: id }).then((r) => (r.ok ? setD(r.result) : setError(r.error))); }, [id]);
  if (error) return <p className="rr-room-error mt-4" role="alert">{error}</p>;
  if (!d) return <div className="rr-skeleton mt-4 h-64" aria-busy="true" />;
  const max = Math.max(1, d.learners);
  return (
    <div className="mt-4 grid gap-4 lg:grid-cols-[1fr_320px]" data-testid="rr-learners">
      <div className="rr-page p-5">
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
          {[{ k: 'Learners', v: String(d.learners) }, { k: 'Certificates', v: String(d.certificates) }, { k: 'Earned', v: cc(d.revenueCC) }, { k: 'Rating', v: d.rating != null ? `★ ${d.rating.toFixed(1)} (${d.reviews})` : '—' }].map((s) => (
            <div key={s.k}><p className="rr-type text-[11px] uppercase tracking-widest text-[var(--rr-ink-2)]">{s.k}</p><p className="rr-book rr-num mt-1 text-[24px]" data-testid={`rr-stat-${s.k.toLowerCase()}`}>{s.v}</p></div>
          ))}
        </div>
        <h3 className="rr-type mt-6 text-[14px]">Lesson by lesson</h3>
        {d.lessons.length === 0 ? <p className="mt-2 text-[13.5px] text-[var(--rr-ink-2)]">No lessons yet.</p> : (
          <table className="mt-2 w-full text-[13px]">
            <thead><tr className="text-left text-[11.5px] text-[var(--rr-ink-2)]"><th className="py-1 font-semibold">Lesson</th><th className="font-semibold">Done</th><th className="hidden font-semibold sm:table-cell">Check pass rate</th><th className="hidden font-semibold sm:table-cell">Avg score</th></tr></thead>
            <tbody>
              {d.lessons.map((l, i) => (
                <tr key={l.id} className="border-t border-[var(--rr-line)]">
                  <td className="py-2 pr-2"><span className="rr-num text-[var(--rr-ink-2)]">{i + 1}.</span> {l.title}</td>
                  <td className="w-40 pr-2"><div className="flex items-center gap-2"><div className="rr-ribbon flex-1"><span style={{ width: `${(l.done / max) * 100}%` }} /></div><span className="rr-num w-10 text-right">{l.done}</span></div></td>
                  <td className="hidden sm:table-cell">{l.check ? (l.check.passRate == null ? 'no attempts' : `${l.check.passRate}% of ${l.check.attempts}`) : '—'}</td>
                  <td className="hidden sm:table-cell">{l.check?.avgScore != null ? `${l.check.avgScore}%` : '—'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
      <div className="rr-page self-start p-5">
        <h3 className="rr-type text-[14px]">Your learners</h3>
        {d.people.length === 0 ? <p className="mt-2 text-[13.5px] text-[var(--rr-ink-2)]">No one has enrolled yet.</p> : (
          <ul className="mt-2 space-y-2">{d.people.map((p, i) => <li key={`${p.name}-${i}`} className="text-[13px]"><div className="flex justify-between"><span>{p.name}</span><span className="rr-num text-[var(--rr-ink-2)]">{p.done}/{p.total}{p.done === p.total && p.total > 0 ? ' ✓' : ''}</span></div><div className="rr-ribbon mt-1"><span style={{ width: `${p.total ? (p.done / p.total) * 100 : 0}%` }} /></div></li>)}</ul>
        )}
        <p className="mt-4 text-[12px] text-[var(--rr-ink-2)]">Pass rates and average scores count every check attempt by your learners, not your own test runs.</p>
      </div>
    </div>
  );
}
