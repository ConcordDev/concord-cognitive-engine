'use client';

/**
 * The carrel: one lesson under the lamp. The reading, the video, and the
 * check (graded on the server — the right answers come back only once you
 * pass), with the margin beside it: the tutor, your notes, the lesson's Q&A
 * and flashcards made from it.
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import { ArrowLeft, ArrowRight, Check, Lock, X } from 'lucide-react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { useLensCommand } from '@/hooks/useLensCommand';
import { isSignedOutError, pct, pub, rx, videoEmbed, type CheckResult, type LessonView, type Question } from './rr';
import { Margin } from './Margin';

type Answer = number | number[] | string;

export function LessonReader({ courseId, lessonId, courseTitle, onCourse, onLesson, onToast }: {
  courseId: string; lessonId: string; courseTitle: string | null; onCourse: () => void; onLesson: (id: string) => void; onToast: (m: string) => void;
}) {
  const [view, setView] = useState<LessonView | null>(null);
  const [error, setError] = useState<string | null>(null);
  const videoRef = useRef<HTMLVideoElement | null>(null);

  const load = useCallback(async () => {
    const r = await pub<LessonView>(`/courses/${encodeURIComponent(courseId)}/lessons/${encodeURIComponent(lessonId)}`);
    if (!r.ok) { setError(r.error); return; }
    setError(null); setView(r.result);
  }, [courseId, lessonId]);
  useEffect(() => { setView(null); void load(); }, [load]);

  const l = view?.lesson;
  useLensCommand([
    { id: 'rr-next-lesson', keys: 'n', description: 'Next lesson', category: 'navigation', action: () => { if (l?.nextId) onLesson(l.nextId); } },
    { id: 'rr-prev-lesson', keys: 'p', description: 'Previous lesson', category: 'navigation', action: () => { if (l?.prevId) onLesson(l.prevId); } },
  ], { lensId: 'education' });

  if (error) return <div className="mx-auto max-w-3xl p-6"><button type="button" className="rr-btn rr-btn-room h-8" onClick={onCourse}><ArrowLeft className="h-4 w-4" /> The course</button><p className="rr-room-error mt-4" role="alert">{error}</p></div>;
  if (!view || !l) return <div className="rr-carrel mx-auto max-w-6xl p-6" aria-busy="true"><div className="rr-skeleton mx-auto h-[520px] max-w-3xl" /></div>;

  const canStudy = !l.locked && !!(view.enrolled || view.isCreator);

  return (
    <div className="rr-carrel w-full px-3 pb-10 pt-4 md:px-6" data-testid="rr-lesson">
      <div className="mx-auto flex max-w-6xl flex-wrap items-center gap-2">
        <button type="button" className="rr-btn rr-btn-room h-8" onClick={onCourse}><ArrowLeft className="h-4 w-4" /> {courseTitle || 'The course'}</button>
        <span className="rr-type ml-auto text-[13px] text-[#e8dcbc]">Lesson {l.n} of {l.of}</span>
      </div>
      <div className="mt-3 flex justify-center" aria-hidden><span className="rr-lamp" /></div>

      <div className="mx-auto mt-4 grid max-w-6xl gap-5 lg:grid-cols-[minmax(0,1fr)_340px]">
        <article className="rr-page p-6 md:p-10">
          <p className="rr-type text-[12px] uppercase tracking-widest text-[var(--rr-ink-2)]">{l.durationMin ? `${l.durationMin} min` : ''}{l.preview ? ' · preview' : ''}{view.progress?.done ? ' · done' : ''}</p>
          <h1 className="rr-book mt-1 text-[28px] font-bold leading-tight" data-testid="rr-lesson-title">{l.title}</h1>

          {l.locked ? (
            <div className="mt-8 rounded border border-dashed border-[var(--rr-line)] p-6 text-center" data-testid="rr-locked">
              <Lock className="mx-auto h-6 w-6 text-[var(--rr-muted)]" aria-hidden />
              <p className="rr-book mt-3 text-[16px]">{view.reason || 'This lesson is part of the course.'}</p>
              <button type="button" className="rr-btn rr-btn-lamp mt-4" onClick={onCourse}>Go to the course page</button>
            </div>
          ) : (
            <>
              {l.video && <Video src={l.video.src} kind={l.video.kind} videoRef={videoRef} />}
              {l.body ? <div className="rr-prose mt-6" data-testid="rr-reading"><ReactMarkdown remarkPlugins={[remarkGfm]}>{l.body}</ReactMarkdown></div> : !l.video && !l.check ? <p className="mt-6 text-[var(--rr-ink-2)]">This lesson is empty.</p> : null}
              {l.check ? (
                <CheckForm key={l.id} courseId={courseId} lessonId={l.id} check={l.check} done={!!view.progress?.done} best={view.progress?.bestScore ?? null}
                  canTake={canStudy} onPassed={() => { void load(); }} onToast={onToast} />
              ) : canStudy ? (
                <div className="mt-8 flex items-center gap-3 border-t border-[var(--rr-line)] pt-5">
                  {view.progress?.done ? (
                    <p className="flex items-center gap-2 font-semibold text-[var(--rr-good)]" data-testid="rr-done"><Check className="h-5 w-5" /> Done</p>
                  ) : (
                    <button type="button" className="rr-btn rr-btn-lamp" data-testid="rr-mark-done" onClick={async () => {
                      const r = await rx<{ done: number; total: number }>('rr-complete', { courseId, lessonId: l.id });
                      if (!r.ok) { onToast(r.error || 'Not marked.'); return; }
                      onToast(`Marked done — ${r.result!.done} of ${r.result!.total} lessons.`);
                      await load();
                    }}><Check className="h-4 w-4" /> Mark this lesson done</button>
                  )}
                </div>
              ) : (
                <p className="mt-8 border-t border-[var(--rr-line)] pt-5 text-[14px] text-[var(--rr-ink-2)]">Enroll in the course to keep track of what you've done{l.check ? ' and take its checks' : ''}.</p>
              )}
            </>
          )}

          <nav className="mt-10 flex items-center justify-between border-t border-[var(--rr-line)] pt-4" aria-label="Lessons">
            <button type="button" className="rr-btn rr-btn-ghost" disabled={!l.prevId} onClick={() => l.prevId && onLesson(l.prevId)}><ArrowLeft className="h-4 w-4" /> Previous <kbd className="rr-type text-[10px] opacity-60">P</kbd></button>
            <button type="button" className="rr-btn rr-btn-ghost" disabled={!l.nextId} onClick={() => l.nextId && onLesson(l.nextId)} data-testid="rr-next">Next <kbd className="rr-type text-[10px] opacity-60">N</kbd> <ArrowRight className="h-4 w-4" /></button>
          </nav>
        </article>

        {!l.locked && <Margin courseId={courseId} lessonId={l.id} lessonTitle={l.title} courseTitle={courseTitle} body={l.body || ''} canTalk={canStudy} videoRef={videoRef} hasVideo={l.video?.kind === 'file'} onToast={onToast} />}
      </div>
    </div>
  );
}

function Video({ src, kind, videoRef }: { src: string; kind: 'file' | 'link'; videoRef: React.MutableRefObject<HTMLVideoElement | null> }) {
  const e = kind === 'file' ? { kind: 'file' as const, src } : videoEmbed(src);
  const [failed, setFailed] = useState(false);
  // Inline allowlist at the sink: our own media stream, or an https link (the
  // server already refuses anything else; this keeps javascript:/data: out
  // even if a bad value ever reached the page).
  const playable = e.src.startsWith('/api/media/') || e.src.startsWith('https://');
  const openable = src.startsWith('https://');
  if (!playable) return <p className="mt-5 rounded bg-black p-6 text-center text-[14px] text-[#e8dcbc]" role="alert">This lesson's video link isn't one that can be played.</p>;
  return (
    <div className="mt-5 overflow-hidden rounded bg-black" data-testid="rr-video">
      {e.kind === 'iframe' ? (
        <iframe src={e.src} title="Lesson video" className="aspect-video w-full" allow="accelerometer; encrypted-media; picture-in-picture; fullscreen" allowFullScreen />
      ) : failed ? (
        <p className="p-6 text-center text-[14px] text-[#e8dcbc]" role="alert">This video can't be played here. {kind === 'link' && openable ? <a href={src} target="_blank" rel="noreferrer" className="underline">Open it in a new tab</a> : 'You may need to enroll to watch it.'}</p>
      ) : (
        <video ref={videoRef} src={e.src} controls preload="metadata" className="aspect-video w-full" onError={() => setFailed(true)} />
      )}
    </div>
  );
}

function CheckForm({ courseId, lessonId, check, done, best, canTake, onPassed, onToast }: {
  courseId: string; lessonId: string; check: { passMark: number; questions: Question[] }; done: boolean; best: number | null; canTake: boolean;
  onPassed: () => void; onToast: (m: string) => void;
}) {
  const [answers, setAnswers] = useState<Record<string, Answer>>({});
  const [result, setResult] = useState<CheckResult | null>(null);
  const [busy, setBusy] = useState(false);
  const answered = check.questions.filter((q) => { const a = answers[q.id]; return Array.isArray(a) ? a.length > 0 : a !== undefined && a !== ''; }).length;
  const resultOf = (id: string) => result?.results.find((r) => r.id === id);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    const r = await rx<CheckResult>('rr-check', { courseId, lessonId, answers });
    setBusy(false);
    if (!r.ok) { onToast(isSignedOutError(r.error) ? 'Sign in to take the check.' : r.error || 'Not graded.'); return; }
    setResult(r.result);
    if (r.result!.passed) { onToast(`Passed with ${pct(r.result!.score)}. Lesson done.`); onPassed(); }
  }

  return (
    <form className="mt-8 rounded border-2 border-[var(--rr-line)] bg-[rgba(255,255,255,0.35)] p-5" onSubmit={submit} data-testid="rr-check">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h2 className="rr-type text-[18px]">Check</h2>
        <p className="rr-num text-[12.5px] text-[var(--rr-ink-2)]">{check.questions.length} questions · pass at {pct(check.passMark)}{best != null ? ` · your best ${pct(best)}` : ''}{done ? ' · passed' : ''}</p>
      </div>
      {check.questions.map((q, i) => {
        const res = resultOf(q.id);
        return (
          <div key={q.id} className="rr-check-q" data-testid={`rr-q-${i + 1}`}><fieldset>
            <legend className="rr-book flex gap-2 text-[15.5px]">
              <span className="rr-num text-[var(--rr-ink-2)]">{i + 1}.</span>
              <span>{q.prompt}</span>
              {res && (res.correct ? <Check className="rr-mark-right h-5 w-5 shrink-0" aria-label="right" /> : <X className="rr-mark-wrong h-5 w-5 shrink-0" aria-label="wrong" />)}
            </legend>
            <div className="mt-2 pl-5">
              <QuestionInput q={q} value={answers[q.id]} onChange={(v) => { setAnswers({ ...answers, [q.id]: v }); setResult(null); }} disabled={!canTake} answer={res?.answer} />
              {res?.explain && <p className="mt-2 text-[13.5px] italic text-[var(--rr-ink-2)]">{res.explain}</p>}
            </div>
          </fieldset></div>
        );
      })}
      {result && (
        <p className={`mt-2 rounded px-3 py-2 text-[14px] font-semibold ${result.passed ? 'bg-[rgba(45,110,69,0.12)] text-[var(--rr-good)]' : 'bg-[rgba(168,56,47,0.1)] text-[var(--rr-bad)]'}`} role="status" data-testid="rr-check-result">
          {result.right} of {result.total} right ({pct(result.score)}). {result.passed ? 'Passed — the right answers are shown above.' : `You need ${pct(result.passMark)} to pass. Read the notes above and try again (attempt ${result.attempts}).`}
        </p>
      )}
      {canTake ? (
        <div className="mt-4 flex items-center gap-3">
          <button type="submit" className="rr-btn rr-btn-lamp" disabled={busy || answered === 0} data-testid="rr-submit-check">{busy ? 'Grading…' : result && !result.passed ? 'Try again' : done ? 'Take it again' : 'Hand it in'}</button>
          <span className="rr-num text-[12.5px] text-[var(--rr-ink-2)]">{answered} of {check.questions.length} answered</span>
        </div>
      ) : <p className="mt-3 text-[13.5px] text-[var(--rr-ink-2)]">Enroll in the course to take this check.</p>}
    </form>
  );
}

function QuestionInput({ q, value, onChange, disabled, answer }: { q: Question; value: Answer | undefined; onChange: (v: Answer) => void; disabled: boolean; answer?: number | number[] | string[] }) {
  if (q.type === 'choice' || q.type === 'multi') {
    const picked = q.type === 'multi' ? (Array.isArray(value) ? value : []) : [];
    return (
      <div className="flex flex-col gap-1">
        {(q.options || []).map((o, i) => {
          const on = q.type === 'multi' ? picked.includes(i) : value === i;
          const right = answer !== undefined && (Array.isArray(answer) ? (answer as number[]).includes(i) : answer === i);
          return (
            <label key={i} className="rr-opt" data-picked={on}>
              <input type={q.type === 'multi' ? 'checkbox' : 'radio'} name={q.id} className="mt-1 accent-[var(--rr-lamp)]" checked={on} disabled={disabled}
                onChange={() => onChange(q.type === 'multi' ? (on ? picked.filter((x) => x !== i) : [...picked, i]) : i)} />
              <span className="text-[14.5px]">{o}{right && <strong className="ml-2 text-[12px] text-[var(--rr-good)]">✓ right answer</strong>}</span>
            </label>
          );
        })}
        {q.type === 'multi' && <p className="text-[12px] text-[var(--rr-muted)]">Tick every one that applies.</p>}
      </div>
    );
  }
  return (
    <div>
      <input className="rr-input max-w-sm" inputMode={q.type === 'numeric' ? 'decimal' : 'text'} value={typeof value === 'string' ? value : ''} disabled={disabled}
        onChange={(e) => onChange(e.target.value)} placeholder={q.type === 'numeric' ? 'A number' : 'Your answer'} aria-label={`Answer to: ${q.prompt}`} />
      {answer !== undefined && <p className="mt-1 text-[12.5px] text-[var(--rr-good)]">Accepted: {Array.isArray(answer) ? answer.join(' / ') : String(answer)}</p>}
    </div>
  );
}
