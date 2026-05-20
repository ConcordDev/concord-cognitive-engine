'use client';

/**
 * AnswersQA — Stack Overflow / Quora 2026-shape Q&A workbench. Ask
 * questions, browse/sort/filter, open a detail thread, post + vote +
 * accept answers, comment, and run bounties. Wires the answers.* macros.
 */

import { useCallback, useEffect, useState } from 'react';
import {
  MessageSquarePlus, ChevronUp, ChevronDown, Check, Award, Loader2,
  Search, ArrowLeft, Tag, Eye,
} from 'lucide-react';
import { lensRun } from '@/lib/api/client';
import { cn } from '@/lib/utils';

interface QSummary {
  id: string; title: string; tags: string[]; votes: number; views: number;
  answerCount: number; hasAccepted: boolean; bounty: number; excerpt: string; createdAt: string;
}
interface Comment { id: string; body: string; createdAt: string }
interface Answer { id: string; body: string; votes: number; accepted: boolean; comments: Comment[]; createdAt: string }
interface QDetail {
  id: string; title: string; body: string; tags: string[]; votes: number; views: number;
  answers: Answer[]; comments: Comment[]; acceptedAnswerId: string | null; bounty: number; authorId: string;
}
interface Dash {
  questions: number; unanswered: number; answered: number; totalAnswers: number;
  totalViews: number; openBounties: number; reputation: number;
}

const SORTS = [
  { id: 'newest', label: 'Newest' },
  { id: 'votes', label: 'Votes' },
  { id: 'active', label: 'Active' },
  { id: 'answers', label: 'Answers' },
];
const FILTERS = [
  { id: '', label: 'All' },
  { id: 'unanswered', label: 'Unanswered' },
  { id: 'accepted', label: 'Accepted' },
  { id: 'bountied', label: 'Bountied' },
];

export function AnswersQA() {
  const [view, setView] = useState<'list' | 'detail' | 'ask'>('list');
  const [questions, setQuestions] = useState<QSummary[]>([]);
  const [detail, setDetail] = useState<QDetail | null>(null);
  const [dash, setDash] = useState<Dash | null>(null);
  const [sort, setSort] = useState('newest');
  const [filter, setFilter] = useState('');
  const [query, setQuery] = useState('');
  const [loading, setLoading] = useState(true);
  // ask form
  const [askTitle, setAskTitle] = useState('');
  const [askBody, setAskBody] = useState('');
  const [askTags, setAskTags] = useState('');
  const [askErr, setAskErr] = useState('');
  // answer/comment drafts
  const [answerDraft, setAnswerDraft] = useState('');

  const refreshList = useCallback(async () => {
    setLoading(true);
    const [ql, d] = await Promise.all([
      lensRun('answers', 'question-list', { sort, filter, query: query.trim() }),
      lensRun('answers', 'dashboard', {}),
    ]);
    setQuestions((ql.data?.result?.questions as QSummary[]) || []);
    setDash((d.data?.result as Dash) || null);
    setLoading(false);
  }, [sort, filter, query]);

  useEffect(() => { if (view === 'list') void refreshList(); }, [view, refreshList]);

  async function openDetail(id: string) {
    const r = await lensRun('answers', 'question-detail', { id });
    if (r.data?.ok) { setDetail(r.data.result?.question as QDetail); setView('detail'); }
  }
  async function reloadDetail() {
    if (!detail) return;
    const r = await lensRun('answers', 'question-detail', { id: detail.id });
    if (r.data?.ok) setDetail(r.data.result?.question as QDetail);
  }

  async function submitAsk() {
    setAskErr('');
    const r = await lensRun('answers', 'question-ask', { title: askTitle, body: askBody, tags: askTags });
    if (!r.data?.ok) { setAskErr(r.data?.error || 'Could not post question.'); return; }
    setAskTitle(''); setAskBody(''); setAskTags('');
    await openDetail(r.data.result?.question.id);
  }

  async function vote(targetType: 'question' | 'answer', targetId: string, direction: 'up' | 'down') {
    if (!detail) return;
    await lensRun('answers', 'vote', { targetType, targetId, questionId: detail.id, direction });
    await reloadDetail();
  }
  async function accept(answerId: string) {
    if (!detail) return;
    await lensRun('answers', 'answer-accept', { questionId: detail.id, answerId });
    await reloadDetail();
  }
  async function postAnswer() {
    if (!detail || answerDraft.trim().length < 15) return;
    await lensRun('answers', 'answer-post', { questionId: detail.id, body: answerDraft.trim() });
    setAnswerDraft('');
    await reloadDetail();
  }
  async function startBounty() {
    if (!detail) return;
    const r = await lensRun('answers', 'bounty-start', { questionId: detail.id, amount: 50 });
    if (!r.data?.ok) alert(r.data?.error || 'Could not start bounty.');
    await reloadDetail();
  }

  // ── Ask view ──────────────────────────────────────────────────
  if (view === 'ask') {
    return (
      <div className="rounded-2xl border border-zinc-800 bg-zinc-950/60 p-4 space-y-3">
        <button onClick={() => setView('list')} className="text-xs text-zinc-400 hover:text-zinc-200 inline-flex items-center gap-1">
          <ArrowLeft className="w-3 h-3" />Back to questions
        </button>
        <h3 className="text-sm font-bold text-zinc-100">Ask a question</h3>
        <input value={askTitle} onChange={e => setAskTitle(e.target.value)} placeholder="Be specific — imagine you're asking another person"
          className="w-full bg-zinc-900 border border-zinc-800 rounded-lg px-3 py-2 text-sm text-zinc-100 focus:outline-none focus:ring-2 focus:ring-orange-500" />
        <textarea value={askBody} onChange={e => setAskBody(e.target.value)} rows={6} placeholder="Include all the information someone would need to answer your question"
          className="w-full bg-zinc-900 border border-zinc-800 rounded-lg px-3 py-2 text-sm text-zinc-100 focus:outline-none focus:ring-2 focus:ring-orange-500" />
        <input value={askTags} onChange={e => setAskTags(e.target.value)} placeholder="Tags — comma separated (e.g. css, layout)"
          className="w-full bg-zinc-900 border border-zinc-800 rounded-lg px-3 py-2 text-sm text-zinc-100 focus:outline-none focus:ring-2 focus:ring-orange-500" />
        {askErr && <p className="text-xs text-rose-400">{askErr}</p>}
        <button onClick={submitAsk} className="px-4 py-2 text-sm font-semibold rounded-lg bg-orange-600 hover:bg-orange-500 text-white">
          Post your question
        </button>
      </div>
    );
  }

  // ── Detail view ───────────────────────────────────────────────
  if (view === 'detail' && detail) {
    return (
      <div className="rounded-2xl border border-zinc-800 bg-zinc-950/60 p-4 space-y-4">
        <button onClick={() => setView('list')} className="text-xs text-zinc-400 hover:text-zinc-200 inline-flex items-center gap-1">
          <ArrowLeft className="w-3 h-3" />All questions
        </button>
        <div className="flex gap-3">
          <VoteRail votes={detail.votes} onUp={() => vote('question', detail.id, 'up')} onDown={() => vote('question', detail.id, 'down')} />
          <div className="min-w-0 flex-1">
            <h3 className="text-base font-bold text-zinc-100">{detail.title}</h3>
            <p className="text-sm text-zinc-300 whitespace-pre-wrap mt-1">{detail.body}</p>
            <div className="flex flex-wrap items-center gap-1.5 mt-2">
              {detail.tags.map(t => (
                <span key={t} className="text-[10px] px-1.5 py-0.5 rounded bg-orange-900/40 text-orange-300">{t}</span>
              ))}
              <span className="ml-auto text-[10px] text-zinc-500 inline-flex items-center gap-1"><Eye className="w-3 h-3" />{detail.views}</span>
            </div>
            <CommentThread comments={detail.comments} onAdd={async (body) => {
              await lensRun('answers', 'comment-add', { questionId: detail.id, targetType: 'question', targetId: detail.id, body });
              await reloadDetail();
            }} />
          </div>
        </div>

        <div className="flex items-center gap-2 border-t border-zinc-800 pt-3">
          <h4 className="text-sm font-semibold text-zinc-200">{detail.answers.length} Answer{detail.answers.length === 1 ? '' : 's'}</h4>
          {detail.bounty > 0
            ? <span className="text-[11px] px-2 py-0.5 rounded bg-amber-900/40 text-amber-300 inline-flex items-center gap-1"><Award className="w-3 h-3" />+{detail.bounty} bounty</span>
            : <button onClick={startBounty} className="ml-auto text-[11px] text-amber-400 hover:text-amber-300 inline-flex items-center gap-1"><Award className="w-3 h-3" />Start a 50-rep bounty</button>}
        </div>

        {detail.answers.map(a => (
          <div key={a.id} className={cn('flex gap-3 rounded-lg p-2', a.accepted && 'bg-emerald-950/30 border border-emerald-900/40')}>
            <div className="flex flex-col items-center gap-1">
              <VoteRail votes={a.votes} onUp={() => vote('answer', a.id, 'up')} onDown={() => vote('answer', a.id, 'down')} />
              <button onClick={() => accept(a.id)} title={a.accepted ? 'Accepted — click to un-accept' : 'Accept this answer'}
                className={cn('p-1 rounded-full', a.accepted ? 'bg-emerald-600 text-white' : 'text-zinc-600 hover:text-emerald-400 hover:bg-emerald-900/30')}>
                <Check className="w-4 h-4" />
              </button>
            </div>
            <div className="min-w-0 flex-1">
              <p className="text-sm text-zinc-300 whitespace-pre-wrap">{a.body}</p>
              <CommentThread comments={a.comments} onAdd={async (body) => {
                await lensRun('answers', 'comment-add', { questionId: detail.id, targetType: 'answer', targetId: a.id, body });
                await reloadDetail();
              }} />
            </div>
          </div>
        ))}

        <div className="border-t border-zinc-800 pt-3">
          <h4 className="text-sm font-semibold text-zinc-200 mb-1">Your answer</h4>
          <textarea value={answerDraft} onChange={e => setAnswerDraft(e.target.value)} rows={4} placeholder="Write a thorough answer (15+ characters)"
            className="w-full bg-zinc-900 border border-zinc-800 rounded-lg px-3 py-2 text-sm text-zinc-100 focus:outline-none focus:ring-2 focus:ring-orange-500" />
          <button onClick={postAnswer} disabled={answerDraft.trim().length < 15}
            className="mt-2 px-4 py-2 text-sm font-semibold rounded-lg bg-orange-600 hover:bg-orange-500 text-white disabled:opacity-40">
            Post your answer
          </button>
        </div>
      </div>
    );
  }

  // ── List view ─────────────────────────────────────────────────
  return (
    <div className="rounded-2xl border border-zinc-800 bg-zinc-950/60 overflow-hidden">
      <header className="flex items-center gap-2 px-4 py-3 border-b border-zinc-800 bg-gradient-to-r from-orange-600/15 to-transparent">
        <MessageSquarePlus className="w-5 h-5 text-orange-400" />
        <h2 className="text-sm font-bold text-zinc-100">Q&amp;A Workspace</h2>
        <span className="text-[11px] text-zinc-500">Stack Overflow shape</span>
        <button onClick={() => setView('ask')} className="ml-auto px-3 py-1.5 text-xs font-semibold rounded-lg bg-orange-600 hover:bg-orange-500 text-white">
          Ask question
        </button>
      </header>

      {dash && (
        <div className="grid grid-cols-3 sm:grid-cols-6 gap-2 px-4 py-3 border-b border-zinc-800">
          {([['Questions', dash.questions], ['Answered', dash.answered], ['Unanswered', dash.unanswered],
             ['Answers', dash.totalAnswers], ['Views', dash.totalViews], ['Reputation', dash.reputation]] as const).map(([l, v]) => (
            <div key={l} className="text-center">
              <p className="text-lg font-bold text-zinc-100">{v}</p>
              <p className="text-[10px] text-zinc-500 uppercase tracking-wide">{l}</p>
            </div>
          ))}
        </div>
      )}

      <div className="flex flex-wrap items-center gap-2 px-4 py-2 border-b border-zinc-800">
        <div className="relative flex-1 min-w-[160px]">
          <Search className="w-3.5 h-3.5 text-zinc-500 absolute left-2 top-1/2 -translate-y-1/2" />
          <input value={query} onChange={e => setQuery(e.target.value)} placeholder="Search questions"
            className="w-full bg-zinc-900 border border-zinc-800 rounded-lg pl-7 pr-2 py-1.5 text-xs text-zinc-200 focus:outline-none focus:ring-2 focus:ring-orange-500" />
        </div>
        <select value={sort} onChange={e => setSort(e.target.value)} className="bg-zinc-900 border border-zinc-800 rounded-lg px-2 py-1.5 text-xs text-zinc-200">
          {SORTS.map(s => <option key={s.id} value={s.id}>{s.label}</option>)}
        </select>
        <div className="flex gap-1">
          {FILTERS.map(f => (
            <button key={f.id} onClick={() => setFilter(f.id)}
              className={cn('px-2 py-1 text-[11px] rounded', filter === f.id ? 'bg-orange-600 text-white' : 'text-zinc-400 hover:text-zinc-200')}>
              {f.label}
            </button>
          ))}
        </div>
      </div>

      <div className="divide-y divide-zinc-800">
        {loading ? (
          <div className="flex items-center justify-center py-10 text-zinc-500"><Loader2 className="w-4 h-4 animate-spin" /></div>
        ) : questions.length === 0 ? (
          <p className="text-xs text-zinc-500 italic text-center py-10">No questions yet. Ask the first one.</p>
        ) : questions.map(q => (
          <button key={q.id} onClick={() => openDetail(q.id)} className="w-full text-left px-4 py-3 hover:bg-zinc-900/60 flex gap-3">
            <div className="flex flex-col items-center gap-1 text-center w-14 shrink-0">
              <span className="text-sm font-bold text-zinc-200">{q.votes}</span>
              <span className="text-[9px] text-zinc-500">votes</span>
              <span className={cn('text-xs font-semibold px-1.5 rounded',
                q.hasAccepted ? 'bg-emerald-900/50 text-emerald-300' : q.answerCount > 0 ? 'border border-zinc-700 text-zinc-300' : 'text-zinc-600')}>
                {q.answerCount}
              </span>
              <span className="text-[9px] text-zinc-500">answers</span>
            </div>
            <div className="min-w-0 flex-1">
              <p className="text-sm font-semibold text-orange-300 truncate">{q.title}</p>
              <p className="text-xs text-zinc-500 truncate">{q.excerpt}</p>
              <div className="flex flex-wrap items-center gap-1 mt-1">
                {q.tags.map(t => (
                  <span key={t} className="text-[10px] px-1.5 py-0.5 rounded bg-orange-900/40 text-orange-300 inline-flex items-center gap-0.5">
                    <Tag className="w-2.5 h-2.5" />{t}
                  </span>
                ))}
                {q.bounty > 0 && <span className="text-[10px] px-1.5 py-0.5 rounded bg-amber-900/40 text-amber-300">+{q.bounty}</span>}
              </div>
            </div>
          </button>
        ))}
      </div>
    </div>
  );
}

function VoteRail({ votes, onUp, onDown }: { votes: number; onUp: () => void; onDown: () => void }) {
  return (
    <div className="flex flex-col items-center">
      <button onClick={onUp} className="text-zinc-500 hover:text-orange-400"><ChevronUp className="w-5 h-5" /></button>
      <span className="text-sm font-bold text-zinc-200">{votes}</span>
      <button onClick={onDown} className="text-zinc-500 hover:text-blue-400"><ChevronDown className="w-5 h-5" /></button>
    </div>
  );
}

function CommentThread({ comments, onAdd }: { comments: Comment[]; onAdd: (body: string) => void }) {
  const [draft, setDraft] = useState('');
  const [open, setOpen] = useState(false);
  return (
    <div className="mt-2">
      {comments.map(c => (
        <p key={c.id} className="text-[11px] text-zinc-500 border-t border-zinc-900 py-1">{c.body}</p>
      ))}
      {open ? (
        <div className="flex items-center gap-1 mt-1">
          <input value={draft} onChange={e => setDraft(e.target.value)}
            onKeyDown={e => { if (e.key === 'Enter' && draft.trim()) { onAdd(draft.trim()); setDraft(''); setOpen(false); } }}
            placeholder="Add a comment" autoFocus
            className="flex-1 bg-zinc-900 border border-zinc-800 rounded px-2 py-1 text-[11px] text-zinc-200" />
          <button onClick={() => { if (draft.trim()) { onAdd(draft.trim()); setDraft(''); setOpen(false); } }}
            className="text-[10px] px-2 py-1 rounded bg-orange-600 text-white">add</button>
        </div>
      ) : (
        <button onClick={() => setOpen(true)} className="text-[10px] text-zinc-600 hover:text-zinc-400 mt-1">Add a comment</button>
      )}
    </div>
  );
}
