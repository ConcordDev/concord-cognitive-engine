'use client';

/**
 * A course's title page: what it is, who wrote it, what you'll learn, the
 * contents (each lesson with its kind, length and whether you've done it),
 * enrolling or buying it, the certificate once every lesson is done, and
 * the reviews of people who took it.
 */
import { useCallback, useEffect, useState } from 'react';
import { ArrowLeft, BookOpen, Check, ClipboardCheck, Lock, PenLine, PlayCircle, Star } from 'lucide-react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { cc, isSignedOutError, minutes, pct, pub, rx, type CourseView, type OutlineItem } from './rr';

const KIND_ICON = { reading: BookOpen, video: PlayCircle, check: ClipboardCheck } as const;

export function CoursePage({ id, onBack, onLesson, onCertificate, onStudio, onToast }: {
  id: string; onBack: () => void; onLesson: (lessonId: string) => void; onCertificate: (code: string) => void; onStudio: (id: string) => void; onToast: (m: string) => void;
}) {
  const [view, setView] = useState<CourseView | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [confirmBuy, setConfirmBuy] = useState(false);
  const [busy, setBusy] = useState(false);
  const [certErr, setCertErr] = useState<{ msg: string; remaining?: string[] } | null>(null);

  const load = useCallback(async () => {
    const r = await pub<CourseView>(`/courses/${encodeURIComponent(id)}`);
    if (!r.ok) { setError(r.error); return; }
    setError(null); setView(r.result);
  }, [id]);
  useEffect(() => { setView(null); void load(); }, [load]);

  if (error) return <div className="mx-auto max-w-3xl p-6"><BackLink onBack={onBack} /><p className="rr-room-error mt-4" role="alert">{error === 'course not found' ? 'That course isn\'t on the shelves (it may have been withdrawn).' : error}</p></div>;
  if (!view) return <div className="mx-auto max-w-4xl p-6" aria-busy="true"><div className="rr-skeleton h-10 w-40" /><div className="rr-skeleton mt-4 h-[420px]" /></div>;

  const { course, outline, progress, isCreator } = view;
  const paid = course.priceCC > 0;
  const enrolled = course.enrolled;
  const next = outline.find((l) => l.id === progress.next) || outline[0];

  async function enroll() {
    setBusy(true);
    const r = await rx<{ enrolled: boolean; paid: number; firstLessonId: string | null }>('rr-enroll', { courseId: id });
    setBusy(false); setConfirmBuy(false);
    if (!r.ok) { onToast(isSignedOutError(r.error) ? 'Sign in to take this course.' : r.error || 'Not enrolled.'); return; }
    onToast(r.result!.paid > 0 ? `Bought for ${cc(r.result!.paid)}. It's on your desk.` : 'Enrolled. It\'s on your desk.');
    await load();
  }
  async function certificate() {
    setBusy(true);
    const r = await rx<{ code: string }>('rr-certificate', { courseId: id });
    setBusy(false);
    if (!r.ok) {
      const remaining = view?.outline.filter((l) => !l.done).map((l) => l.title);
      setCertErr({ msg: r.error || 'Not issued.', remaining: remaining?.length ? remaining : undefined });
      return;
    }
    setCertErr(null);
    onCertificate(r.result!.code);
  }

  return (
    <div className="mx-auto w-full max-w-5xl px-4 py-6 md:px-6" data-testid="rr-course">
      <BackLink onBack={onBack} />
      <div className="mt-3 grid gap-5 lg:grid-cols-[1fr_300px]">
        <article className="rr-page p-6 md:p-10">
          <p className="rr-type text-[12px] uppercase tracking-widest text-[var(--rr-ink-2)]">{course.category} · {course.level}{course.status !== 'published' ? ' · draft' : ''}</p>
          <h1 className="rr-book mt-2 text-[30px] font-bold leading-tight md:text-[36px]" data-testid="rr-course-title">{course.title}</h1>
          <p className="rr-book mt-2 text-[15px] italic text-[var(--rr-ink-2)]">by {course.creator.name}</p>
          {course.summary && <p className="rr-book mt-5 text-[17px] leading-relaxed">{course.summary}</p>}
          {course.outcomes.length > 0 && (
            <section className="mt-6">
              <h2 className="rr-type text-[13px] uppercase tracking-widest text-[var(--rr-ink-2)]">You will learn to</h2>
              <ul className="mt-2 grid gap-1.5 sm:grid-cols-2">{course.outcomes.map((o) => <li key={o} className="flex gap-2 text-[14.5px]"><Check className="mt-1 h-4 w-4 shrink-0 text-[var(--rr-lamp)]" aria-hidden />{o}</li>)}</ul>
            </section>
          )}
          {course.description && <div className="rr-prose mt-6 border-t border-[var(--rr-line)] pt-4 text-[15px]"><ReactMarkdown remarkPlugins={[remarkGfm]}>{course.description}</ReactMarkdown></div>}

          <section className="mt-8" aria-label="Contents">
            <h2 className="rr-book text-center text-[20px] font-bold tracking-wide">Contents</h2>
            {outline.length === 0 ? <p className="mt-3 text-center text-[14px] text-[var(--rr-ink-2)]">No lessons yet.</p> : (
              <ol className="mt-3">
                {outline.map((l) => <OutlineRow key={l.id} l={l} onOpen={() => onLesson(l.id)} />)}
              </ol>
            )}
          </section>

          <Reviews view={view} courseId={id} onToast={onToast} onSaved={load} />
        </article>

        <aside className="flex flex-col gap-4 self-start lg:sticky lg:top-4">
          <div className="rr-page p-5" data-testid="rr-course-card">
            <p className="rr-type text-[26px] leading-none">{paid ? cc(course.priceCC) : 'Free'}</p>
            <p className="mt-2 text-[13px] text-[var(--rr-ink-2)]">{course.lessons} lessons{course.minutes ? ` · ${minutes(course.minutes)}` : ''} · {course.learners} {course.learners === 1 ? 'learner' : 'learners'}{course.rating != null ? ` · ★ ${course.rating.toFixed(1)}` : ''}</p>
            {isCreator ? (
              <>
                <p className="mt-4 text-[13.5px]">This is your course.</p>
                <button type="button" className="rr-btn rr-btn-lamp mt-3 w-full" onClick={() => onStudio(id)} data-testid="rr-edit-course"><PenLine className="h-4 w-4" /> Edit in Teaching</button>
              </>
            ) : enrolled ? (
              <>
                <div className="mt-4 flex items-center justify-between text-[13px]"><span>Your progress</span><span className="rr-num font-semibold">{progress.done} / {progress.total}</span></div>
                <div className="rr-ribbon mt-1.5"><span style={{ width: `${progress.total ? (progress.done / progress.total) * 100 : 0}%` }} /></div>
                {progress.done < progress.total && next && <button type="button" className="rr-btn rr-btn-lamp mt-4 w-full" onClick={() => onLesson(next.id)} data-testid="rr-continue">{progress.done ? 'Continue' : 'Start'}: {next.title}</button>}
                {view.certificate ? (
                  <button type="button" className="rr-btn mt-3 w-full" onClick={() => onCertificate(view.certificate!)} data-testid="rr-view-cert">View your certificate</button>
                ) : (
                  <button type="button" className="rr-btn mt-3 w-full" disabled={busy || progress.done < progress.total} onClick={certificate} data-testid="rr-claim-cert" title={progress.done < progress.total ? 'Finish every lesson first' : ''}>Claim certificate</button>
                )}
                {certErr && <div className="mt-2 text-[12.5px]" role="alert"><p className="rr-error">{certErr.msg}</p>{certErr.remaining && <ul className="mt-1 list-disc pl-5 text-[var(--rr-ink-2)]">{certErr.remaining.map((t) => <li key={t}>{t}</li>)}</ul>}</div>}
              </>
            ) : confirmBuy ? (
              <div className="mt-4" data-testid="rr-confirm-buy">
                <p className="text-[13.5px]">This takes <strong>{cc(course.priceCC)}</strong> from your wallet; {course.creator.name} is paid through the marketplace. Buy it?</p>
                <div className="mt-3 flex gap-2"><button type="button" className="rr-btn rr-btn-lamp flex-1" disabled={busy} onClick={enroll}>{busy ? 'Buying…' : `Buy for ${cc(course.priceCC)}`}</button><button type="button" className="rr-btn" onClick={() => setConfirmBuy(false)}>Cancel</button></div>
              </div>
            ) : (
              <>
                <button type="button" className="rr-btn rr-btn-lamp mt-4 w-full" disabled={busy || course.status !== 'published'} onClick={() => (paid ? setConfirmBuy(true) : enroll())} data-testid="rr-enroll">{busy ? 'Enrolling…' : paid ? `Buy for ${cc(course.priceCC)}` : 'Enroll for free'}</button>
                {outline.some((l) => l.preview) && <p className="mt-2 text-[12.5px] text-[var(--rr-ink-2)]">Lessons marked “preview” are open to read before you {paid ? 'buy' : 'enroll'}.</p>}
              </>
            )}
          </div>
          <div className="rr-page p-5 text-[13px] text-[var(--rr-ink-2)]">
            <p className="rr-type text-[12px] uppercase tracking-widest text-[var(--rr-ink)]">How the certificate works</p>
            <p className="mt-2">Every lesson has to be done: a lesson with a check is done when you pass its check, graded on the server; the others once you've read them. The certificate names you, the course and {course.creator.name}, and anyone can verify it from its code.</p>
          </div>
        </aside>
      </div>
    </div>
  );
}

function BackLink({ onBack }: { onBack: () => void }) {
  return <button type="button" className="rr-btn rr-btn-room h-8" onClick={onBack}><ArrowLeft className="h-4 w-4" /> Catalogue</button>;
}

function OutlineRow({ l, onOpen }: { l: OutlineItem; onOpen: () => void }) {
  const Icon = KIND_ICON[l.kind] || BookOpen;
  return (
    <li>
      <button type="button" className="flex w-full items-end gap-2 rounded px-2 py-2 text-left transition-colors hover:bg-[rgba(0,0,0,0.04)]" onClick={onOpen} data-testid={`rr-outline-${l.n}`}>
        <span className="rr-num rr-book w-6 shrink-0 text-right text-[14px] text-[var(--rr-ink-2)]">{l.n}.</span>
        <Icon className="mb-0.5 h-4 w-4 shrink-0 text-[var(--rr-ink-2)]" aria-label={l.kind} />
        <span className="rr-book text-[15px]">{l.title}</span>
        {l.preview && !l.done && <span className="rr-type mb-0.5 text-[11px] text-[var(--rr-lamp)]">preview</span>}
        <span className="rr-leader" aria-hidden />
        <span className="rr-num mb-0.5 shrink-0 text-[12.5px] text-[var(--rr-ink-2)]">
          {l.checkQuestions ? `${l.checkQuestions} q · ` : ''}{l.durationMin ? `${l.durationMin} min` : ''}
          {l.bestScore != null && !l.done ? ` · best ${pct(l.bestScore)}` : ''}
        </span>
        <span className="mb-0.5 w-5 shrink-0">{l.done ? <Check className="h-4 w-4 text-[var(--rr-good)]" aria-label="done" /> : !l.readable ? <Lock className="h-3.5 w-3.5 text-[var(--rr-muted)]" aria-label="locked" /> : null}</span>
      </button>
    </li>
  );
}

function Reviews({ view, courseId, onToast, onSaved }: { view: CourseView; courseId: string; onToast: (m: string) => void; onSaved: () => void }) {
  const mine = view.reviews.find((r) => r.mine);
  const [stars, setStars] = useState(mine?.stars || 0);
  const [text, setText] = useState(mine?.text || '');
  const [open, setOpen] = useState(false);
  const canReview = view.course.enrolled && !view.isCreator && view.progress.done > 0;
  return (
    <section className="mt-10 border-t border-[var(--rr-line)] pt-5" aria-label="Reviews">
      <div className="flex items-center justify-between">
        <h2 className="rr-book text-[20px] font-bold">Reviews{view.course.rating != null ? ` · ★ ${view.course.rating.toFixed(1)}` : ''}</h2>
        {canReview && !open && <button type="button" className="rr-btn h-8" onClick={() => setOpen(true)} data-testid="rr-write-review">{mine ? 'Edit your review' : 'Write a review'}</button>}
      </div>
      {open && (
        <form className="mt-3 rounded border border-[var(--rr-line)] p-3" onSubmit={async (e) => {
          e.preventDefault();
          const r = await rx('rr-review', { courseId, stars, text });
          if (!r.ok) { onToast(r.error || 'Not saved.'); return; }
          setOpen(false); onToast('Thanks — your review is up.'); onSaved();
        }}>
          <div className="flex gap-1" role="radiogroup" aria-label="Stars">
            {[1, 2, 3, 4, 5].map((n) => (
              <button key={n} type="button" role="radio" aria-checked={stars === n} aria-label={`${n} star${n > 1 ? 's' : ''}`} className="p-0.5 transition-transform hover:scale-110" onClick={() => setStars(n)}>
                <Star className={`h-6 w-6 ${n <= stars ? 'fill-[var(--rr-brass)] text-[var(--rr-brass)]' : 'text-[var(--rr-muted)]'}`} />
              </button>
            ))}
          </div>
          <textarea className="rr-input mt-2" rows={3} maxLength={2000} value={text} onChange={(e) => setText(e.target.value)} placeholder="What was it like?" aria-label="Review" />
          <div className="mt-2 flex gap-2"><button type="submit" className="rr-btn rr-btn-lamp" disabled={!stars}>Post review</button><button type="button" className="rr-btn" onClick={() => setOpen(false)}>Cancel</button></div>
        </form>
      )}
      {view.reviews.length === 0 ? (
        <p className="mt-3 text-[14px] text-[var(--rr-ink-2)]">No reviews yet. Only people taking the course can write one, after they finish a lesson.</p>
      ) : (
        <ul className="mt-3 space-y-4">
          {view.reviews.map((r, i) => (
            <li key={`${r.name}-${i}`}>
              <p className="text-[13px]"><span className="text-[var(--rr-brass)]" aria-label={`${r.stars} stars`}>{'★'.repeat(r.stars)}<span className="text-[var(--rr-line)]">{'★'.repeat(5 - r.stars)}</span></span> <strong className="ml-1">{r.name}</strong>{r.mine ? ' (you)' : ''}</p>
              {r.text && <p className="rr-book mt-1 text-[14.5px] leading-relaxed">{r.text}</p>}
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
