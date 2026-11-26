'use client';

/**
 * The lesson's margin: the tutor (it reads the lesson; it never hands over
 * the check's answers), your own notes (stamped with the moment in the
 * video), the lesson's Q&A with everyone taking the course, and flashcards
 * for spaced review.
 */
import { useCallback, useEffect, useState } from 'react';
import { CheckCircle2, ThumbsUp, Trash2 } from 'lucide-react';
import { authorName, clock, isSignedOutError, rx, type Deck, type Note, type Post } from './rr';

type Tab = 'tutor' | 'notes' | 'qa' | 'cards';
interface Props {
  courseId: string; lessonId: string; lessonTitle: string; courseTitle: string | null; body: string; canTalk: boolean;
  videoRef: React.MutableRefObject<HTMLVideoElement | null>; hasVideo: boolean; onToast: (m: string) => void;
}

export function Margin(p: Props) {
  const [tab, setTab] = useState<Tab>('tutor');
  const tabs: { id: Tab; label: string }[] = [{ id: 'tutor', label: 'Tutor' }, { id: 'notes', label: 'Notes' }, { id: 'qa', label: 'Q&A' }, { id: 'cards', label: 'Cards' }];
  return (
    <aside className="rr-margin flex max-h-[calc(100vh-140px)] flex-col self-start lg:sticky lg:top-4" aria-label="Margin" data-testid="rr-margin">
      <div role="tablist" aria-label="Margin" className="flex gap-1 border-b border-[var(--rr-line)] px-2 pt-2">
        {tabs.map((t) => <button key={t.id} type="button" role="tab" aria-selected={tab === t.id} className="rr-tab" onClick={() => setTab(t.id)} data-testid={`rr-margin-${t.id}`}>{t.label}</button>)}
      </div>
      <div className="rr-scroll min-h-0 flex-1 overflow-y-auto p-3">
        {!p.canTalk && tab !== 'tutor' ? <p className="text-[13.5px] text-[var(--rr-ink-2)]">Enroll in the course to keep notes, ask questions and make cards.</p>
          : tab === 'tutor' ? <Tutor {...p} />
          : tab === 'notes' ? <Notes {...p} />
          : tab === 'qa' ? <QA {...p} />
          : <Cards {...p} />}
      </div>
    </aside>
  );
}

const nowIn = (ref: React.MutableRefObject<HTMLVideoElement | null>) => (ref.current && Number.isFinite(ref.current.currentTime) && ref.current.currentTime > 0 ? Math.round(ref.current.currentTime * 10) / 10 : null);
const seek = (ref: React.MutableRefObject<HTMLVideoElement | null>, t: number | null) => { if (t != null && ref.current) { ref.current.currentTime = t; void ref.current.play().catch(() => undefined); } };

function Tutor({ courseId, lessonId, lessonTitle }: Props) {
  const [history, setHistory] = useState<{ role: 'you' | 'tutor'; content: string }[]>([]);
  const [q, setQ] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => { setHistory([]); setError(null); }, [lessonId]);
  return (
    <div data-testid="rr-tutor">
      <p className="text-[12.5px] text-[var(--rr-ink-2)]">The tutor has read “{lessonTitle}”. It helps you think it through and won't give away the check.</p>
      <ul className="mt-3 space-y-2" aria-live="polite">
        {history.map((h, i) => (
          <li key={i} className={`rounded px-3 py-2 text-[13.5px] leading-relaxed ${h.role === 'you' ? 'ml-6 bg-[#fffbef]' : 'mr-6 bg-[rgba(46,107,76,0.1)] rr-book'}`}>{h.content}</li>
        ))}
      </ul>
      {error && <p className="rr-error mt-2 text-[13px]" role="alert">{error}</p>}
      <form className="mt-3 flex flex-col gap-2" onSubmit={async (e) => {
        e.preventDefault(); if (!q.trim() || busy) return;
        const question = q.trim(); setQ(''); setBusy(true); setError(null);
        const next = [...history, { role: 'you' as const, content: question }];
        setHistory(next);
        const r = await rx<{ text: string }>('rr-tutor', { courseId, lessonId, question, history });
        setBusy(false);
        if (!r.ok) { setError(isSignedOutError(r.error) ? 'Sign in to ask the tutor.' : r.error || 'The tutor did not answer.'); return; }
        setHistory([...next, { role: 'tutor', content: r.result!.text }]);
      }}>
        <textarea className="rr-input" rows={3} value={q} onChange={(e) => setQ(e.target.value)} maxLength={2000} placeholder="What's confusing you?" aria-label="Ask the tutor"
          onKeyDown={(e) => { if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) (e.currentTarget.form as HTMLFormElement).requestSubmit(); }} />
        <button type="submit" className="rr-btn rr-btn-lamp self-end" disabled={busy || !q.trim()}>{busy ? 'Thinking…' : 'Ask'}</button>
      </form>
    </div>
  );
}

function Notes({ lessonId, videoRef, hasVideo, onToast }: Props) {
  const [notes, setNotes] = useState<Note[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [text, setText] = useState('');
  const load = useCallback(async () => {
    const r = await rx<{ notes: Note[] }>('notes-list', { lessonId });
    if (!r.ok) { setError(r.error); return; }
    setError(null); setNotes(r.result!.notes);
  }, [lessonId]);
  useEffect(() => { void load(); }, [load]);
  return (
    <div data-testid="rr-notes">
      <form onSubmit={async (e) => {
        e.preventDefault(); if (!text.trim()) return;
        const r = await rx('notes-save', { lessonId, text: text.trim(), timestampSec: nowIn(videoRef) });
        if (!r.ok) { onToast(r.error || 'Not saved.'); return; }
        setText(''); await load();
      }}>
        <textarea className="rr-input" rows={3} value={text} onChange={(e) => setText(e.target.value)} placeholder="A note for yourself (only you see these)" aria-label="New note" />
        <button type="submit" className="rr-btn mt-2" disabled={!text.trim()}>Save note{hasVideo ? ' at this moment' : ''}</button>
      </form>
      {error && <p className="rr-error mt-2 text-[13px]" role="alert">{error}</p>}
      {!notes ? <div className="rr-skeleton mt-3 h-16" /> : notes.length === 0 ? <p className="mt-3 text-[13px] text-[var(--rr-ink-2)]">No notes on this lesson yet.</p> : (
        <ul className="mt-3 space-y-2">
          {notes.slice().reverse().map((n) => (
            <li key={n.id} className="group rounded bg-[#fffbef] px-3 py-2 text-[13.5px]">
              <div className="flex items-start gap-2">
                {n.videoTimestampSec != null && <button type="button" className="rr-num shrink-0 font-semibold text-[var(--rr-lamp)] underline" onClick={() => seek(videoRef, n.videoTimestampSec)} aria-label={`Play from ${clock(n.videoTimestampSec)}`}>{clock(n.videoTimestampSec)}</button>}
                <p className="flex-1 whitespace-pre-wrap">{n.text}</p>
                <button type="button" className="opacity-50 transition-opacity hover:opacity-100" aria-label="Delete note" onClick={async () => { const r = await rx('notes-delete', { id: n.id }); if (!r.ok) onToast(r.error || 'Not deleted.'); await load(); }}><Trash2 className="h-3.5 w-3.5" /></button>
              </div>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function QA({ courseId, lessonId, videoRef, hasVideo, onToast }: Props) {
  const [posts, setPosts] = useState<Post[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [text, setText] = useState('');
  const [replyTo, setReplyTo] = useState<string | null>(null);
  const [reply, setReply] = useState('');
  const load = useCallback(async () => {
    const r = await rx<{ discussions: Post[] }>('discussions-list', { courseId, lessonId });
    if (!r.ok) { setError(r.error); return; }
    setError(null); setPosts(r.result!.discussions);
  }, [courseId, lessonId]);
  useEffect(() => { void load(); }, [load]);
  const questions = (posts || []).filter((x) => !x.replyTo).sort((a, b) => b.upvotes - a.upvotes || b.createdAt.localeCompare(a.createdAt));
  const repliesTo = (id: string) => (posts || []).filter((x) => x.replyTo === id).sort((a, b) => a.createdAt.localeCompare(b.createdAt));
  const up = async (id: string) => { const r = await rx('discussions-upvote', { id }); if (!r.ok) onToast(r.error || 'Not counted.'); await load(); };

  return (
    <div data-testid="rr-qa">
      <form onSubmit={async (e) => {
        e.preventDefault(); if (!text.trim()) return;
        const r = await rx('discussions-post', { courseId, lessonId, text: text.trim(), timestampSec: nowIn(videoRef) });
        if (!r.ok) { onToast(r.error || 'Not posted.'); return; }
        setText(''); await load();
      }}>
        <textarea className="rr-input" rows={2} value={text} onChange={(e) => setText(e.target.value)} maxLength={4000} placeholder="Ask everyone on the course" aria-label="New question" />
        <button type="submit" className="rr-btn mt-2" disabled={!text.trim()} data-testid="rr-ask">Ask{hasVideo ? ' at this moment' : ''}</button>
      </form>
      {error && <p className="rr-error mt-2 text-[13px]" role="alert">{error}</p>}
      {!posts ? <div className="rr-skeleton mt-3 h-20" /> : questions.length === 0 ? <p className="mt-3 text-[13px] text-[var(--rr-ink-2)]">No questions on this lesson yet. The creator and everyone taking the course see what you ask.</p> : (
        <ul className="mt-3 space-y-3">
          {questions.map((q) => (
            <li key={q.id} className="rounded bg-[#fffbef] p-3 text-[13.5px]" data-testid="rr-question">
              <div className="flex items-start gap-2">
                <button type="button" className={`flex shrink-0 flex-col items-center rounded px-1 transition-colors ${q.upvotedByMe ? 'text-[var(--rr-lamp)]' : 'text-[var(--rr-muted)] hover:text-[var(--rr-ink)]'}`} disabled={q.mine || q.upvotedByMe} onClick={() => up(q.id)} aria-label={`Upvote (${q.upvotes})`}>
                  <ThumbsUp className="h-3.5 w-3.5" /><span className="rr-num text-[11px]">{q.upvotes}</span>
                </button>
                <div className="min-w-0 flex-1">
                  <p className="text-[11.5px] text-[var(--rr-ink-2)]"><strong>{authorName(q)}</strong>{q.timestampSec != null && <> · <button type="button" className="rr-num text-[var(--rr-lamp)] underline" onClick={() => seek(videoRef, q.timestampSec)}>{clock(q.timestampSec)}</button></>}{q.acceptedId ? ' · answered' : ''}</p>
                  <p className="mt-0.5 whitespace-pre-wrap">{q.text}</p>
                </div>
              </div>
              <ul className="mt-2 space-y-1.5 border-l-2 border-[var(--rr-line)] pl-3">
                {repliesTo(q.id).map((a) => {
                  const accepted = q.acceptedId === a.id;
                  return (
                    <li key={a.id} className={accepted ? 'rounded bg-[rgba(45,110,69,0.1)] px-2 py-1' : ''}>
                      <p className="text-[11.5px] text-[var(--rr-ink-2)]"><strong>{authorName(a)}</strong>{accepted && <span className="ml-1 font-semibold text-[var(--rr-good)]">· the answer</span>}</p>
                      <p className="whitespace-pre-wrap">{a.text}</p>
                      <span className="mt-0.5 flex gap-3 text-[11.5px]">
                        {!a.mine && !a.upvotedByMe && <button type="button" className="text-[var(--rr-ink-2)] underline" onClick={() => up(a.id)}>Helpful ({a.upvotes})</button>}
                        {(a.mine || a.upvotedByMe) && a.upvotes > 0 && <span className="text-[var(--rr-muted)]">{a.upvotes} found this helpful</span>}
                        {q.mine && <button type="button" className="inline-flex items-center gap-1 text-[var(--rr-good)] underline" data-testid="rr-accept" onClick={async () => { const r = await rx('discussions-accept', { id: q.id, answerId: accepted ? null : a.id }); if (!r.ok) onToast(r.error || 'Not marked.'); await load(); }}><CheckCircle2 className="h-3 w-3" />{accepted ? 'Unmark' : 'Mark as the answer'}</button>}
                      </span>
                    </li>
                  );
                })}
              </ul>
              {replyTo === q.id ? (
                <form className="mt-2" onSubmit={async (e) => {
                  e.preventDefault(); if (!reply.trim()) return;
                  const r = await rx('discussions-post', { courseId, text: reply.trim(), replyTo: q.id });
                  if (!r.ok) { onToast(r.error || 'Not posted.'); return; }
                  setReply(''); setReplyTo(null); await load();
                }}>
                  <textarea className="rr-input" rows={2} value={reply} onChange={(e) => setReply(e.target.value)} maxLength={4000} aria-label="Your answer" placeholder="Your answer" />
                  <div className="mt-1 flex gap-2"><button type="submit" className="rr-btn h-8" disabled={!reply.trim()}>Answer</button><button type="button" className="rr-btn rr-btn-ghost h-8" onClick={() => setReplyTo(null)}>Cancel</button></div>
                </form>
              ) : <button type="button" className="mt-2 text-[12px] text-[var(--rr-lamp)] underline" onClick={() => { setReplyTo(q.id); setReply(''); }} data-testid="rr-reply">Answer</button>}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function Cards({ lessonTitle, courseTitle, body, onToast }: Props) {
  const deckTitle = courseTitle || lessonTitle;
  const [deck, setDeck] = useState<Deck | null | undefined>(undefined);
  const [front, setFront] = useState('');
  const [back, setBack] = useState('');
  const [drafts, setDrafts] = useState<{ front: string; back: string; keep: boolean }[] | null>(null);
  const [drafting, setDrafting] = useState(false);
  const [draftErr, setDraftErr] = useState<string | null>(null);
  const loadDeck = useCallback(async () => {
    const r = await rx<{ decks: Deck[] }>('flashcards-decks');
    setDeck(r.ok ? r.result!.decks.find((d) => d.title === deckTitle) || null : null);
  }, [deckTitle]);
  useEffect(() => { void loadDeck(); }, [loadDeck]);
  async function deckId(): Promise<string | null> {
    if (deck) return deck.id;
    const r = await rx<{ deck: { id: string } }>('flashcards-deck-create', { title: deckTitle });
    if (!r.ok) { onToast(r.error || 'No deck made.'); return null; }
    return r.result!.deck.id;
  }
  async function add(cards: { front: string; back: string }[]) {
    const id = await deckId(); if (!id) return 0;
    let n = 0;
    for (const c of cards) { const r = await rx('flashcards-card-create', { deckId: id, front: c.front, back: c.back }); if (r.ok) n++; }
    await loadDeck();
    return n;
  }
  return (
    <div data-testid="rr-cards">
      <p className="text-[12.5px] text-[var(--rr-ink-2)]">Cards go into your “{deckTitle}” deck{deck ? ` (${deck.count} cards, ${deck.due} due)` : ''}. Review them from My carrel; each card comes back just before you'd forget it.</p>
      <form className="mt-3 flex flex-col gap-2" onSubmit={async (e) => {
        e.preventDefault(); if (!front.trim() || !back.trim()) return;
        const n = await add([{ front: front.trim(), back: back.trim() }]);
        if (n) { setFront(''); setBack(''); onToast('Card added.'); }
      }}>
        <input className="rr-input" value={front} onChange={(e) => setFront(e.target.value)} placeholder="Front: a question" aria-label="Card front" maxLength={1000} />
        <textarea className="rr-input" rows={2} value={back} onChange={(e) => setBack(e.target.value)} placeholder="Back: the answer" aria-label="Card back" maxLength={2000} />
        <button type="submit" className="rr-btn self-start" disabled={!front.trim() || !back.trim()}>Add card</button>
      </form>
      {body.trim().length > 40 && (
        <div className="mt-4 border-t border-dashed border-[var(--rr-line)] pt-3">
          <button type="button" className="rr-btn" disabled={drafting} onClick={async () => {
            setDrafting(true); setDraftErr(null);
            const r = await rx<{ cards: { front: string; back: string }[] }>('quiz-from-text', { source: body, count: 8 });
            setDrafting(false);
            if (!r.ok) { setDraftErr(/llm unavailable/i.test(r.error || '') ? 'Drafting cards needs the language model, and it isn\'t running right now. You can still write cards by hand above.' : r.error || 'No cards drafted.'); return; }
            setDrafts(r.result!.cards.map((c) => ({ ...c, keep: true })));
          }}>{drafting ? 'Drafting…' : 'Draft cards from this lesson'}</button>
          {draftErr && <p className="rr-error mt-2 text-[13px]" role="alert">{draftErr}</p>}
          {drafts && (drafts.length === 0 ? <p className="mt-2 text-[13px]">No cards came back.</p> : (
            <div className="mt-3">
              <p className="text-[12.5px] text-[var(--rr-ink-2)]">Drafted from the lesson's text. Keep the ones that are right.</p>
              <ul className="mt-2 space-y-1.5">
                {drafts.map((d, i) => (
                  <li key={i}><label className="flex gap-2 rounded bg-[#fffbef] p-2 text-[13px]"><input type="checkbox" checked={d.keep} onChange={() => setDrafts(drafts.map((x, j) => (j === i ? { ...x, keep: !x.keep } : x)))} className="mt-0.5 accent-[var(--rr-lamp)]" /><span><strong>{d.front}</strong><br />{d.back}</span></label></li>
                ))}
              </ul>
              <button type="button" className="rr-btn rr-btn-lamp mt-2" disabled={!drafts.some((d) => d.keep)} onClick={async () => { const n = await add(drafts.filter((d) => d.keep)); onToast(`${n} card${n === 1 ? '' : 's'} added.`); setDrafts(null); }}>Add {drafts.filter((d) => d.keep).length} cards</button>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
