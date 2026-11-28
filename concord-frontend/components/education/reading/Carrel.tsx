'use client';

/**
 * My carrel: the courses on your desk (with where you left off), the cards
 * due for review today, and the certificates you've earned.
 */
import { useCallback, useEffect, useState } from 'react';
import { Award, RotateCcw } from 'lucide-react';
import { callNumber, isSignedOutError, rx, type Deck, type FlashCard, type MyLearning } from './rr';

export function Carrel({ onCourse, onLesson, onCertificate, onCatalogue, onToast }: {
  onCourse: (id: string) => void; onLesson: (courseId: string, lessonId: string) => void; onCertificate: (code: string) => void; onCatalogue: () => void; onToast: (m: string) => void;
}) {
  const [data, setData] = useState<MyLearning | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [decks, setDecks] = useState<Deck[]>([]);
  const [reviewing, setReviewing] = useState(false);

  const load = useCallback(async () => {
    const [r, d] = await Promise.all([rx<MyLearning>('rr-my-learning'), rx<{ decks: Deck[] }>('flashcards-decks')]);
    if (!r.ok) { setError(r.error); return; }
    setError(null); setData(r.result);
    if (d.ok) setDecks(d.result!.decks);
  }, []);
  useEffect(() => { void load(); }, [load]);

  if (error) return <div className="mx-auto max-w-3xl p-6"><div className="rr-page p-6">{isSignedOutError(error) ? <><p className="rr-book text-[20px]">Sign in to sit at your carrel.</p><p className="mt-2 text-[14px] text-[var(--rr-ink-2)]">Your courses, progress, cards and certificates are kept for you here.</p></> : <p className="rr-error" role="alert">{error}</p>}</div></div>;
  if (!data) return <div className="mx-auto max-w-5xl p-6" aria-busy="true"><div className="rr-skeleton h-40" /><div className="rr-skeleton mt-4 h-40" /></div>;

  const due = decks.reduce((s, d) => s + d.due, 0);
  if (reviewing) return <Review onDone={() => { setReviewing(false); void load(); }} onToast={onToast} />;

  return (
    <div className="mx-auto w-full max-w-5xl px-4 py-6 md:px-6" data-testid="rr-carrel">
      <div className="grid gap-5 lg:grid-cols-[1fr_300px]">
        <section aria-label="On your desk">
          <h2 className="rr-book text-[24px] text-[#f0e6cc]">On your desk</h2>
          {data.courses.length === 0 ? (
            <div className="rr-page mt-3 p-6">
              <p className="rr-book text-[18px]">Nothing on your desk yet.</p>
              <p className="mt-1 text-[14px] text-[var(--rr-ink-2)]">Find a course in the catalogue and enroll; it will wait for you here.</p>
              <button type="button" className="rr-btn rr-btn-lamp mt-4" onClick={onCatalogue}>Open the catalogue</button>
            </div>
          ) : (
            <ul className="mt-3 space-y-3">
              {data.courses.map((c) => (
                <li key={c.id} className="rr-page flex flex-col gap-3 p-4 sm:flex-row sm:items-center" data-testid={`rr-desk-${c.id}`}>
                  <button type="button" className="min-w-0 flex-1 text-left" onClick={() => onCourse(c.id)}>
                    <p className="rr-type text-[11.5px] text-[var(--rr-ink-2)]">{callNumber(c)} · {c.creator.name}</p>
                    <p className="rr-book mt-0.5 text-[18px] font-bold">{c.title}</p>
                    <div className="mt-2 flex items-center gap-3"><div className="rr-ribbon flex-1"><span style={{ width: `${c.total ? (c.done / c.total) * 100 : 0}%` }} /></div><span className="rr-num text-[12.5px]">{c.done}/{c.total}</span></div>
                  </button>
                  {c.certificate ? (
                    <button type="button" className="rr-btn shrink-0" onClick={() => onCertificate(c.certificate!)}><Award className="h-4 w-4" /> Certificate</button>
                  ) : c.nextLessonId ? (
                    <button type="button" className="rr-btn rr-btn-lamp shrink-0" onClick={() => onLesson(c.id, c.nextLessonId!)} title={c.nextLessonTitle || ''}>{c.done ? 'Continue' : 'Start'}</button>
                  ) : (
                    <button type="button" className="rr-btn rr-btn-lamp shrink-0" onClick={() => onCourse(c.id)}>Claim certificate</button>
                  )}
                </li>
              ))}
            </ul>
          )}
        </section>
        <aside className="flex flex-col gap-4">
          <div className="rr-page p-5" data-testid="rr-due">
            <p className="rr-type text-[12px] uppercase tracking-widest">Cards to review</p>
            <p className="rr-book mt-2 text-[34px] leading-none">{due}</p>
            <p className="mt-1 text-[13px] text-[var(--rr-ink-2)]">{decks.length === 0 ? 'No decks yet: make cards from any lesson\'s margin.' : `due now across ${decks.length} ${decks.length === 1 ? 'deck' : 'decks'}`}</p>
            <button type="button" className="rr-btn rr-btn-lamp mt-3 w-full" disabled={due === 0} onClick={() => setReviewing(true)} data-testid="rr-start-review">Review now</button>
            {decks.length > 0 && <ul className="mt-3 space-y-1 text-[12.5px]">{decks.map((d) => <li key={d.id} className="flex justify-between gap-2"><span className="truncate">{d.title}</span><span className="rr-num shrink-0 text-[var(--rr-ink-2)]">{d.due} / {d.count}</span></li>)}</ul>}
          </div>
          <div className="rr-page p-5">
            <p className="rr-type text-[12px] uppercase tracking-widest">Certificates</p>
            {data.certificates.length === 0 ? <p className="mt-2 text-[13px] text-[var(--rr-ink-2)]">None yet. Finish every lesson of a course to earn one.</p> : (
              <ul className="mt-2 space-y-2">{data.certificates.map((c) => <li key={c.code}><button type="button" className="text-left text-[13.5px] underline decoration-dotted" onClick={() => onCertificate(c.code)}>{c.course}<span className="rr-type block text-[11px] text-[var(--rr-ink-2)] no-underline">{c.code}</span></button></li>)}</ul>
            )}
          </div>
        </aside>
      </div>
    </div>
  );
}

/** A review session: the due cards one at a time; your grade sets when each comes back (SM-2, on the server). */
function Review({ onDone, onToast }: { onDone: () => void; onToast: (m: string) => void }) {
  const [cards, setCards] = useState<FlashCard[] | null>(null);
  const [i, setI] = useState(0);
  const [flipped, setFlipped] = useState(false);
  const [graded, setGraded] = useState(0);
  useEffect(() => { void rx<{ cards: FlashCard[] }>('flashcards-due', { limit: 50 }).then((r) => setCards(r.ok ? r.result!.cards : [])); }, []);
  const card = cards?.[i];
  async function grade(quality: number) {
    if (!card) return;
    const r = await rx<{ card: FlashCard }>('flashcards-review', { cardId: card.id, quality });
    if (!r.ok) { onToast(r.error || 'Not recorded.'); return; }
    setGraded((g) => g + 1); setFlipped(false); setI((x) => x + 1);
  }
  useEffect(() => {
    const k = (e: KeyboardEvent) => {
      if ((e.target as HTMLElement)?.closest('input,textarea,select')) return;
      if (e.key === ' ') { e.preventDefault(); setFlipped((f) => !f); }
      if (flipped && ['1', '2', '3', '4'].includes(e.key)) void grade([1, 3, 4, 5][Number(e.key) - 1]!);
    };
    window.addEventListener('keydown', k); return () => window.removeEventListener('keydown', k);
  });
  return (
    <div className="mx-auto w-full max-w-xl px-4 py-8" data-testid="rr-review">
      <div className="flex items-center justify-between text-[#f0e6cc]"><p className="rr-type text-[13px]">{cards ? `${Math.min(i + 1, cards.length)} of ${cards.length}` : ''}</p><button type="button" className="rr-btn rr-btn-room h-8" onClick={onDone}>Done for now</button></div>
      {!cards ? <div className="rr-skeleton mt-4 h-64" aria-busy="true" /> : !card ? (
        <div className="rr-page mt-4 p-8 text-center"><RotateCcw className="mx-auto h-6 w-6 text-[var(--rr-lamp)]" aria-hidden /><p className="rr-book mt-3 text-[20px]">That's every card due.</p><p className="mt-1 text-[14px] text-[var(--rr-ink-2)]">{graded} reviewed. They'll come back as they're due.</p><button type="button" className="rr-btn rr-btn-lamp mt-4" onClick={onDone}>Back to your carrel</button></div>
      ) : (
        <>
          <button type="button" className="rr-flip mt-4 block h-64 w-full" onClick={() => setFlipped((f) => !f)} aria-label={flipped ? 'Show the front' : 'Show the answer'} data-testid="rr-flashcard">
            <span className="rr-flip-inner block h-full" data-flipped={flipped}>
              <span className="rr-flip-face rr-card flex items-center justify-center p-6 text-center"><span className="rr-type text-[19px]">{card.front}</span></span>
              <span className="rr-flip-face rr-flip-back rr-card flex items-center justify-center p-6 text-center"><span className="rr-type text-[17px]">{card.back}</span></span>
            </span>
          </button>
          {flipped ? (
            <div className="mt-4 grid grid-cols-4 gap-2">
              {[{ q: 1, l: 'Again' }, { q: 3, l: 'Hard' }, { q: 4, l: 'Good' }, { q: 5, l: 'Easy' }].map((g, n) => (
                <button key={g.q} type="button" className={`rr-btn ${g.q === 4 ? 'rr-btn-lamp' : ''}`} onClick={() => grade(g.q)}>{g.l} <kbd className="rr-type text-[10px] opacity-60">{n + 1}</kbd></button>
              ))}
            </div>
          ) : <p className="mt-4 text-center text-[13px] text-[#e8dcbc]">Think of the answer, then turn the card over (space).</p>}
        </>
      )}
    </div>
  );
}
