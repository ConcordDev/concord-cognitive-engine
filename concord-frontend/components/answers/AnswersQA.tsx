'use client';

/**
 * AnswersQA — Stack Overflow / Quora 2026-shape Q&A workbench. Ask
 * questions with a rich markdown editor, browse/sort/filter, open a
 * detail thread, post + vote + accept answers, comment, run bounties.
 *
 * Surfaces the full feature-parity backlog:
 *  - rich markdown + code-block editor with syntax highlighting
 *  - question/answer edit history with revision diff
 *  - duplicate-question detection + linking
 *  - privilege tiers gating actions at reputation thresholds
 *  - tag-watch / question subscription + notifications
 *  - related-questions sidebar
 *  - quality flags / close-vote / community moderation queue
 */

import { useCallback, useEffect, useState } from 'react';
import {
  MessageSquarePlus, ChevronUp, ChevronDown, Check, Award, Loader2,
  Search, ArrowLeft, Tag, Eye, Pencil, History, Copy, Bookmark, XCircle,
  Lock, ShieldAlert,
} from 'lucide-react';
import { lensRun } from '@/lib/api/client';
import { cn } from '@/lib/utils';
import { RichMarkdownEditor } from './RichMarkdownEditor';
import { PostBody } from './PostBody';
import { RevisionHistory } from './RevisionHistory';
import { PrivilegePanel } from './PrivilegePanel';
import { NotificationsBell } from './NotificationsBell';
import { ModerationQueue } from './ModerationQueue';
import { FlagButton } from './FlagButton';
import { DuplicatePanel } from './DuplicatePanel';
import { RelatedSidebar } from './RelatedSidebar';
import { TagWatchPanel } from './TagWatchPanel';

interface QSummary {
  id: string; title: string; tags: string[]; votes: number; views: number;
  answerCount: number; hasAccepted: boolean; bounty: number; excerpt: string; createdAt: string;
}
interface Comment { id: string; body: string; createdAt: string }
interface Answer {
  id: string; body: string; bodyFormat?: string; votes: number; accepted: boolean;
  comments: Comment[]; authorId: string; revisions?: unknown[]; createdAt: string;
}
interface QDetail {
  id: string; title: string; body: string; bodyFormat?: string; tags: string[];
  votes: number; views: number; answers: Answer[]; comments: Comment[];
  acceptedAnswerId: string | null; bounty: number; authorId: string;
  closed?: boolean; closeReason?: string | null; closeVotes?: unknown[];
  duplicateOf?: { id: string; title: string } | null; revisions?: unknown[];
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
const CLOSE_REASONS = ['duplicate', 'needs detail or clarity', 'opinion-based', 'off-topic', 'too broad'];

type SidePanel = 'none' | 'privileges' | 'tags' | 'moderation';

export function AnswersQA() {
  const [view, setView] = useState<'list' | 'detail' | 'ask'>('list');
  const [questions, setQuestions] = useState<QSummary[]>([]);
  const [detail, setDetail] = useState<QDetail | null>(null);
  const [dash, setDash] = useState<Dash | null>(null);
  const [sort, setSort] = useState('newest');
  const [filter, setFilter] = useState('');
  const [query, setQuery] = useState('');
  const [loading, setLoading] = useState(true);
  const [sidePanel, setSidePanel] = useState<SidePanel>('none');
  const [notifKey, setNotifKey] = useState(0);
  // ask form
  const [askTitle, setAskTitle] = useState('');
  const [askBody, setAskBody] = useState('');
  const [askTags, setAskTags] = useState('');
  const [askErr, setAskErr] = useState('');
  // answer/comment drafts + edit state
  const [answerDraft, setAnswerDraft] = useState('');
  const [editingQuestion, setEditingQuestion] = useState(false);
  const [editTitle, setEditTitle] = useState('');
  const [editBody, setEditBody] = useState('');
  const [editTags, setEditTags] = useState('');
  const [editAnswerId, setEditAnswerId] = useState<string | null>(null);
  const [editAnswerBody, setEditAnswerBody] = useState('');
  const [revisionTarget, setRevisionTarget] = useState<{ answerId?: string } | null>(null);
  const [showDuplicates, setShowDuplicates] = useState(false);
  const [closeReason, setCloseReason] = useState(CLOSE_REASONS[0]);
  const [detailMsg, setDetailMsg] = useState('');

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

  const openDetail = useCallback(async (id: string) => {
    const r = await lensRun('answers', 'question-detail', { id });
    if (r.data?.ok) {
      setDetail(r.data.result?.question as QDetail);
      setView('detail');
      setEditingQuestion(false);
      setRevisionTarget(null);
      setShowDuplicates(false);
      setEditAnswerId(null);
      setDetailMsg('');
    }
  }, []);

  async function reloadDetail() {
    if (!detail) return;
    const r = await lensRun('answers', 'question-detail', { id: detail.id });
    if (r.data?.ok) setDetail(r.data.result?.question as QDetail);
  }

  async function submitAsk() {
    setAskErr('');
    const r = await lensRun('answers', 'question-ask', {
      title: askTitle, body: askBody, tags: askTags, bodyFormat: 'markdown',
    });
    if (!r.data?.ok) { setAskErr(r.data?.error || 'Could not post question.'); return; }
    setAskTitle(''); setAskBody(''); setAskTags('');
    await openDetail(r.data.result?.question.id);
  }

  async function vote(targetType: 'question' | 'answer', targetId: string, direction: 'up' | 'down') {
    if (!detail) return;
    const r = await lensRun('answers', 'vote', { targetType, targetId, questionId: detail.id, direction });
    if (!r.data?.ok) setDetailMsg(r.data?.error || 'Could not vote.');
    await reloadDetail();
  }
  async function accept(answerId: string) {
    if (!detail) return;
    await lensRun('answers', 'answer-accept', { questionId: detail.id, answerId });
    await reloadDetail();
  }
  async function postAnswer() {
    if (!detail || answerDraft.trim().length < 15) return;
    const r = await lensRun('answers', 'answer-post', {
      questionId: detail.id, body: answerDraft.trim(), bodyFormat: 'markdown',
    });
    if (!r.data?.ok) { setDetailMsg(r.data?.error || 'Could not post answer.'); return; }
    setAnswerDraft('');
    await reloadDetail();
  }
  async function startBounty() {
    if (!detail) return;
    const r = await lensRun('answers', 'bounty-start', { questionId: detail.id, amount: 50 });
    if (!r.data?.ok) setDetailMsg(r.data?.error || 'Could not start bounty.');
    await reloadDetail();
  }

  // ── edit / revision ─────────────────────────────────────────────
  function beginEditQuestion() {
    if (!detail) return;
    setEditTitle(detail.title);
    setEditBody(detail.body);
    setEditTags(detail.tags.join(', '));
    setEditingQuestion(true);
  }
  async function saveQuestionEdit() {
    if (!detail) return;
    const r = await lensRun('answers', 'question-edit', {
      id: detail.id, title: editTitle, body: editBody, tags: editTags, bodyFormat: 'markdown',
    });
    if (!r.data?.ok) { setDetailMsg(r.data?.error || 'Could not save edit.'); return; }
    setEditingQuestion(false);
    await reloadDetail();
  }
  async function saveAnswerEdit() {
    if (!detail || !editAnswerId) return;
    const r = await lensRun('answers', 'answer-edit', {
      questionId: detail.id, answerId: editAnswerId, body: editAnswerBody, bodyFormat: 'markdown',
    });
    if (!r.data?.ok) { setDetailMsg(r.data?.error || 'Could not save edit.'); return; }
    setEditAnswerId(null);
    await reloadDetail();
  }

  // ── close-vote / reopen ─────────────────────────────────────────
  async function castCloseVote() {
    if (!detail) return;
    const r = await lensRun('answers', 'close-vote', { questionId: detail.id, reason: closeReason });
    if (!r.data?.ok) { setDetailMsg(r.data?.error || 'Could not cast close vote.'); return; }
    setDetailMsg(
      r.data.result?.closed
        ? 'Question closed.'
        : `Close vote cast (${r.data.result?.closeVotes}/${r.data.result?.threshold}).`
    );
    await reloadDetail();
  }
  async function reopen() {
    if (!detail) return;
    const r = await lensRun('answers', 'reopen', { questionId: detail.id });
    if (!r.data?.ok) { setDetailMsg(r.data?.error || 'Could not reopen.'); return; }
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
        <input
          value={askTitle}
          onChange={(e) => setAskTitle(e.target.value)}
          placeholder="Be specific — imagine you're asking another person"
          className="w-full bg-zinc-900 border border-zinc-800 rounded-lg px-3 py-2 text-sm text-zinc-100 focus:outline-none focus:ring-2 focus:ring-orange-500"
        />
        <RichMarkdownEditor
          value={askBody}
          onChange={setAskBody}
          placeholder="Include all the information someone would need to answer your question — supports **markdown** and ```code blocks```"
          rows={8}
        />
        <input
          value={askTags}
          onChange={(e) => setAskTags(e.target.value)}
          placeholder="Tags — comma separated (e.g. css, layout)"
          className="w-full bg-zinc-900 border border-zinc-800 rounded-lg px-3 py-2 text-sm text-zinc-100 focus:outline-none focus:ring-2 focus:ring-orange-500"
        />
        {askErr && <p className="text-xs text-rose-400">{askErr}</p>}
        <button onClick={submitAsk} className="px-4 py-2 text-sm font-semibold rounded-lg bg-orange-600 hover:bg-orange-500 text-white">
          Post your question
        </button>
      </div>
    );
  }

  // ── Detail view ───────────────────────────────────────────────
  if (view === 'detail' && detail) {
    const isAuthor = true; // workspace is per-user; the asker owns their questions
    return (
      <div className="grid grid-cols-1 lg:grid-cols-[1fr_260px] gap-4">
        <div className="rounded-2xl border border-zinc-800 bg-zinc-950/60 p-4 space-y-4">
          <button onClick={() => setView('list')} className="text-xs text-zinc-400 hover:text-zinc-200 inline-flex items-center gap-1">
            <ArrowLeft className="w-3 h-3" />All questions
          </button>

          {detail.closed && (
            <div className="rounded border border-rose-900/40 bg-rose-950/20 px-3 py-2 flex items-center gap-2">
              <Lock className="w-3.5 h-3.5 text-rose-400" />
              <span className="text-[12px] text-rose-300">
                Closed{detail.closeReason ? ` — ${detail.closeReason}` : ''}
              </span>
              <button onClick={reopen} className="ml-auto text-[11px] text-zinc-400 hover:text-emerald-300">Reopen</button>
            </div>
          )}
          {detail.duplicateOf && (
            <div className="rounded border border-amber-900/40 bg-amber-950/20 px-3 py-2 text-[12px] text-amber-300">
              Marked as duplicate of{' '}
              <button onClick={() => openDetail(detail.duplicateOf!.id)} className="underline hover:text-amber-200">
                {detail.duplicateOf.title}
              </button>
            </div>
          )}

          <div className="flex gap-3">
            <VoteRail votes={detail.votes} onUp={() => vote('question', detail.id, 'up')} onDown={() => vote('question', detail.id, 'down')} />
            <div className="min-w-0 flex-1">
              {editingQuestion ? (
                <div className="space-y-2">
                  <input
                    value={editTitle}
                    onChange={(e) => setEditTitle(e.target.value)}
                    className="w-full bg-zinc-900 border border-zinc-800 rounded-lg px-3 py-2 text-sm text-zinc-100"
                  />
                  <RichMarkdownEditor value={editBody} onChange={setEditBody} rows={6} />
                  <input
                    value={editTags}
                    onChange={(e) => setEditTags(e.target.value)}
                    placeholder="Tags — comma separated"
                    className="w-full bg-zinc-900 border border-zinc-800 rounded-lg px-3 py-2 text-sm text-zinc-100"
                  />
                  <div className="flex gap-1.5">
                    <button onClick={saveQuestionEdit} className="px-3 py-1.5 text-xs font-semibold rounded-lg bg-orange-600 hover:bg-orange-500 text-white">
                      Save edit
                    </button>
                    <button onClick={() => setEditingQuestion(false)} className="px-3 py-1.5 text-xs text-zinc-400 hover:text-zinc-200">
                      Cancel
                    </button>
                  </div>
                </div>
              ) : (
                <>
                  <h3 className="text-base font-bold text-zinc-100">{detail.title}</h3>
                  <div className="mt-1">
                    <PostBody body={detail.body} bodyFormat={detail.bodyFormat} />
                  </div>
                  <div className="flex flex-wrap items-center gap-1.5 mt-2">
                    {detail.tags.map((t) => (
                      <span key={t} className="text-[10px] px-1.5 py-0.5 rounded bg-orange-900/40 text-orange-300">{t}</span>
                    ))}
                    <span className="ml-auto text-[10px] text-zinc-400 inline-flex items-center gap-1">
                      <Eye className="w-3 h-3" />{detail.views}
                    </span>
                  </div>
                  <div className="flex flex-wrap items-center gap-2.5 mt-2">
                    {isAuthor && (
                      <button onClick={beginEditQuestion} className="text-[10px] text-zinc-400 hover:text-orange-300 inline-flex items-center gap-0.5">
                        <Pencil className="w-2.5 h-2.5" />Edit
                      </button>
                    )}
                    <button
                      onClick={() => setRevisionTarget(revisionTarget && !revisionTarget.answerId ? null : {})}
                      className="text-[10px] text-zinc-400 hover:text-orange-300 inline-flex items-center gap-0.5"
                    >
                      <History className="w-2.5 h-2.5" />
                      History{detail.revisions?.length ? ` (${detail.revisions.length})` : ''}
                    </button>
                    <button
                      onClick={() => setShowDuplicates((s) => !s)}
                      className="text-[10px] text-zinc-400 hover:text-orange-300 inline-flex items-center gap-0.5"
                    >
                      <Copy className="w-2.5 h-2.5" />Duplicates
                    </button>
                    <FlagButton questionId={detail.id} onFlagged={() => setDetailMsg('Flag raised.')} />
                  </div>
                  {revisionTarget && !revisionTarget.answerId && (
                    <div className="mt-2">
                      <RevisionHistory questionId={detail.id} onClose={() => setRevisionTarget(null)} />
                    </div>
                  )}
                  {showDuplicates && (
                    <div className="mt-2 rounded-lg border border-zinc-800 bg-zinc-900/40 p-3">
                      <DuplicatePanel
                        questionId={detail.id}
                        duplicateOf={detail.duplicateOf ?? null}
                        onLinkChanged={reloadDetail}
                        onOpenQuestion={openDetail}
                      />
                    </div>
                  )}
                </>
              )}
              <CommentThread
                comments={detail.comments}
                onAdd={async (body) => {
                  await lensRun('answers', 'comment-add', { questionId: detail.id, targetType: 'question', targetId: detail.id, body });
                  await reloadDetail();
                }}
              />
            </div>
          </div>

          {/* Close-vote panel */}
          {!detail.closed && (
            <div className="flex items-center gap-2 rounded border border-zinc-800 bg-zinc-900/40 px-3 py-2">
              <ShieldAlert className="w-3.5 h-3.5 text-zinc-400" />
              <span className="text-[11px] text-zinc-400">Close vote:</span>
              <select
                value={closeReason}
                onChange={(e) => setCloseReason(e.target.value)}
                className="bg-zinc-950 border border-zinc-800 rounded px-1.5 py-1 text-[11px] text-zinc-200"
              >
                {CLOSE_REASONS.map((r) => <option key={r} value={r}>{r}</option>)}
              </select>
              <button onClick={castCloseVote} className="text-[11px] text-zinc-400 hover:text-rose-300 inline-flex items-center gap-0.5">
                <XCircle className="w-3 h-3" />Cast vote
              </button>
              {(detail.closeVotes?.length ?? 0) > 0 && (
                <span className="ml-auto text-[10px] text-amber-400">{detail.closeVotes!.length} close vote(s)</span>
              )}
            </div>
          )}

          {detailMsg && <p className="text-[11px] text-amber-400">{detailMsg}</p>}

          <div className="flex items-center gap-2 border-t border-zinc-800 pt-3">
            <h4 className="text-sm font-semibold text-zinc-200">
              {detail.answers.length} Answer{detail.answers.length === 1 ? '' : 's'}
            </h4>
            {detail.bounty > 0 ? (
              <span className="text-[11px] px-2 py-0.5 rounded bg-amber-900/40 text-amber-300 inline-flex items-center gap-1">
                <Award className="w-3 h-3" />+{detail.bounty} bounty
              </span>
            ) : (
              <button onClick={startBounty} className="ml-auto text-[11px] text-amber-400 hover:text-amber-300 inline-flex items-center gap-1">
                <Award className="w-3 h-3" />Start a 50-rep bounty
              </button>
            )}
          </div>

          {detail.answers.map((a) => (
            <div key={a.id} className={cn('flex gap-3 rounded-lg p-2', a.accepted && 'bg-emerald-950/30 border border-emerald-900/40')}>
              <div className="flex flex-col items-center gap-1">
                <VoteRail votes={a.votes} onUp={() => vote('answer', a.id, 'up')} onDown={() => vote('answer', a.id, 'down')} />
                <button
                  onClick={() => accept(a.id)}
                  title={a.accepted ? 'Accepted — click to un-accept' : 'Accept this answer'}
                  className={cn('p-1 rounded-full', a.accepted ? 'bg-emerald-600 text-white' : 'text-zinc-600 hover:text-emerald-400 hover:bg-emerald-900/30')}
                >
                  <Check className="w-4 h-4" />
                </button>
              </div>
              <div className="min-w-0 flex-1">
                {editAnswerId === a.id ? (
                  <div className="space-y-2">
                    <RichMarkdownEditor value={editAnswerBody} onChange={setEditAnswerBody} rows={5} />
                    <div className="flex gap-1.5">
                      <button onClick={saveAnswerEdit} className="px-3 py-1 text-xs font-semibold rounded-lg bg-orange-600 hover:bg-orange-500 text-white">
                        Save edit
                      </button>
                      <button onClick={() => setEditAnswerId(null)} className="px-3 py-1 text-xs text-zinc-400 hover:text-zinc-200">
                        Cancel
                      </button>
                    </div>
                  </div>
                ) : (
                  <>
                    <PostBody body={a.body} bodyFormat={a.bodyFormat} />
                    <div className="flex flex-wrap items-center gap-2.5 mt-1.5">
                      <button
                        onClick={() => { setEditAnswerId(a.id); setEditAnswerBody(a.body); }}
                        className="text-[10px] text-zinc-400 hover:text-orange-300 inline-flex items-center gap-0.5"
                      >
                        <Pencil className="w-2.5 h-2.5" />Edit
                      </button>
                      <button
                        onClick={() => setRevisionTarget(
                          revisionTarget?.answerId === a.id ? null : { answerId: a.id }
                        )}
                        className="text-[10px] text-zinc-400 hover:text-orange-300 inline-flex items-center gap-0.5"
                      >
                        <History className="w-2.5 h-2.5" />
                        History{a.revisions?.length ? ` (${a.revisions.length})` : ''}
                      </button>
                      <FlagButton questionId={detail.id} answerId={a.id} onFlagged={() => setDetailMsg('Flag raised.')} />
                    </div>
                    {revisionTarget?.answerId === a.id && (
                      <div className="mt-2">
                        <RevisionHistory questionId={detail.id} answerId={a.id} onClose={() => setRevisionTarget(null)} />
                      </div>
                    )}
                  </>
                )}
                <CommentThread
                  comments={a.comments}
                  onAdd={async (body) => {
                    await lensRun('answers', 'comment-add', { questionId: detail.id, targetType: 'answer', targetId: a.id, body });
                    await reloadDetail();
                  }}
                />
              </div>
            </div>
          ))}

          {!detail.closed && (
            <div className="border-t border-zinc-800 pt-3">
              <h4 className="text-sm font-semibold text-zinc-200 mb-1">Your answer</h4>
              <RichMarkdownEditor
                value={answerDraft}
                onChange={setAnswerDraft}
                placeholder="Write a thorough answer (15+ characters) — markdown + code blocks supported"
                rows={5}
              />
              <button
                onClick={postAnswer}
                disabled={answerDraft.trim().length < 15}
                className="mt-2 px-4 py-2 text-sm font-semibold rounded-lg bg-orange-600 hover:bg-orange-500 text-white disabled:opacity-40"
              >
                Post your answer
              </button>
            </div>
          )}
        </div>

        {/* Related sidebar */}
        <RelatedSidebar questionId={detail.id} onOpenQuestion={openDetail} />
      </div>
    );
  }

  // ── List view ─────────────────────────────────────────────────
  return (
    <div className="rounded-2xl border border-zinc-800 bg-zinc-950/60 overflow-hidden">
      <header className="flex items-center gap-2 px-4 py-3 border-b border-zinc-800 bg-gradient-to-r from-orange-600/15 to-transparent">
        <MessageSquarePlus className="w-5 h-5 text-orange-400" />
        <h2 className="text-sm font-bold text-zinc-100">Q&amp;A Workspace</h2>
        <span className="text-[11px] text-zinc-400">Stack Overflow shape</span>
        <div className="ml-auto flex items-center gap-1.5">
          <NotificationsBell onOpenQuestion={openDetail} refreshKey={notifKey} />
          <PanelToggle active={sidePanel === 'privileges'} onClick={() => setSidePanel((p) => (p === 'privileges' ? 'none' : 'privileges'))} label="Privileges" />
          <PanelToggle active={sidePanel === 'tags'} onClick={() => setSidePanel((p) => (p === 'tags' ? 'none' : 'tags'))} label="Tag watch" />
          <PanelToggle active={sidePanel === 'moderation'} onClick={() => setSidePanel((p) => (p === 'moderation' ? 'none' : 'moderation'))} label="Moderate" />
          <button onClick={() => setView('ask')} className="px-3 py-1.5 text-xs font-semibold rounded-lg bg-orange-600 hover:bg-orange-500 text-white">
            Ask question
          </button>
        </div>
      </header>

      {sidePanel !== 'none' && (
        <div className="border-b border-zinc-800 bg-zinc-900/30 px-4 py-3">
          {sidePanel === 'privileges' && <PrivilegePanel refreshKey={notifKey} />}
          {sidePanel === 'tags' && <TagWatchPanel onChanged={() => setNotifKey((k) => k + 1)} />}
          {sidePanel === 'moderation' && <ModerationQueue onResolved={() => setNotifKey((k) => k + 1)} />}
        </div>
      )}

      {dash && (
        <div className="grid grid-cols-3 sm:grid-cols-6 gap-2 px-4 py-3 border-b border-zinc-800">
          {(([['Questions', dash.questions], ['Answered', dash.answered], ['Unanswered', dash.unanswered],
             ['Answers', dash.totalAnswers], ['Views', dash.totalViews], ['Reputation', dash.reputation]]) as const).map(([l, v]) => (
            <div key={l} className="text-center">
              <p className="text-lg font-bold text-zinc-100">{v}</p>
              <p className="text-[10px] text-zinc-400 uppercase tracking-wide">{l}</p>
            </div>
          ))}
        </div>
      )}

      <div className="flex flex-wrap items-center gap-2 px-4 py-2 border-b border-zinc-800">
        <div className="relative flex-1 min-w-[160px]">
          <Search className="w-3.5 h-3.5 text-zinc-400 absolute left-2 top-1/2 -translate-y-1/2" />
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search questions"
            className="w-full bg-zinc-900 border border-zinc-800 rounded-lg pl-7 pr-2 py-1.5 text-xs text-zinc-200 focus:outline-none focus:ring-2 focus:ring-orange-500"
          />
        </div>
        <select value={sort} onChange={(e) => setSort(e.target.value)} className="bg-zinc-900 border border-zinc-800 rounded-lg px-2 py-1.5 text-xs text-zinc-200">
          {SORTS.map((s) => <option key={s.id} value={s.id}>{s.label}</option>)}
        </select>
        <div className="flex gap-1">
          {FILTERS.map((f) => (
            <button
              key={f.id}
              onClick={() => setFilter(f.id)}
              className={cn('px-2 py-1 text-[11px] rounded', filter === f.id ? 'bg-orange-600 text-white' : 'text-zinc-400 hover:text-zinc-200')}
            >
              {f.label}
            </button>
          ))}
        </div>
      </div>

      <div className="divide-y divide-zinc-800">
        {loading ? (
          <div className="flex items-center justify-center py-10 text-zinc-400"><Loader2 className="w-4 h-4 animate-spin" /></div>
        ) : questions.length === 0 ? (
          <p className="text-xs text-zinc-400 italic text-center py-10">No questions yet. Ask the first one.</p>
        ) : (
          questions.map((q) => (
            <div key={q.id} className="w-full px-4 py-3 hover:bg-zinc-900/60 flex gap-3">
              <button onClick={() => openDetail(q.id)} className="flex flex-col items-center gap-1 text-center w-14 shrink-0">
                <span className="text-sm font-bold text-zinc-200">{q.votes}</span>
                <span className="text-[9px] text-zinc-400">votes</span>
                <span className={cn('text-xs font-semibold px-1.5 rounded',
                  q.hasAccepted ? 'bg-emerald-900/50 text-emerald-300' : q.answerCount > 0 ? 'border border-zinc-700 text-zinc-300' : 'text-zinc-600')}>
                  {q.answerCount}
                </span>
                <span className="text-[9px] text-zinc-400">answers</span>
              </button>
              <button onClick={() => openDetail(q.id)} className="min-w-0 flex-1 text-left">
                <p className="text-sm font-semibold text-orange-300 truncate">{q.title}</p>
                <p className="text-xs text-zinc-400 truncate">{q.excerpt}</p>
                <div className="flex flex-wrap items-center gap-1 mt-1">
                  {q.tags.map((t) => (
                    <span key={t} className="text-[10px] px-1.5 py-0.5 rounded bg-orange-900/40 text-orange-300 inline-flex items-center gap-0.5">
                      <Tag className="w-2.5 h-2.5" />{t}
                    </span>
                  ))}
                  {q.bounty > 0 && <span className="text-[10px] px-1.5 py-0.5 rounded bg-amber-900/40 text-amber-300">+{q.bounty}</span>}
                </div>
              </button>
              <SubscribeButton questionId={q.id} onChanged={() => setNotifKey((k) => k + 1)} />
            </div>
          ))
        )}
      </div>
    </div>
  );
}

function PanelToggle({ active, onClick, label }: { active: boolean; onClick: () => void; label: string }) {
  return (
    <button
      onClick={onClick}
      className={cn(
        'px-2 py-1.5 text-[11px] rounded-lg border',
        active
          ? 'bg-orange-600/20 border-orange-600/50 text-orange-300'
          : 'border-zinc-800 text-zinc-400 hover:text-zinc-200'
      )}
    >
      {label}
    </button>
  );
}

function SubscribeButton({ questionId, onChanged }: { questionId: string; onChanged?: () => void }) {
  const [subscribed, setSubscribed] = useState(false);
  const [busy, setBusy] = useState(false);
  async function toggle() {
    setBusy(true);
    const r = await lensRun('answers', 'question-subscribe', { questionId });
    setBusy(false);
    if (r.data?.ok) {
      setSubscribed(Boolean(r.data.result?.subscribed));
      onChanged?.();
    }
  }
  return (
    <button
      onClick={toggle}
      disabled={busy}
      title={subscribed ? 'Following — click to unfollow' : 'Follow for answer notifications'}
      aria-label={subscribed ? 'Unfollow question' : 'Follow question'}
      className={cn('shrink-0 self-start p-1 rounded', subscribed ? 'text-orange-400' : 'text-zinc-600 hover:text-orange-300')}
    >
      <Bookmark className={cn('w-4 h-4', subscribed && 'fill-current')} />
    </button>
  );
}

function VoteRail({ votes, onUp, onDown }: { votes: number; onUp: () => void; onDown: () => void }) {
  return (
    <div className="flex flex-col items-center">
      <button onClick={onUp} aria-label="Upvote" className="text-zinc-400 hover:text-orange-400"><ChevronUp className="w-5 h-5" /></button>
      <span className="text-sm font-bold text-zinc-200">{votes}</span>
      <button onClick={onDown} aria-label="Downvote" className="text-zinc-400 hover:text-blue-400"><ChevronDown className="w-5 h-5" /></button>
    </div>
  );
}

function CommentThread({ comments, onAdd }: { comments: Comment[]; onAdd: (body: string) => void }) {
  const [draft, setDraft] = useState('');
  const [open, setOpen] = useState(false);
  return (
    <div className="mt-2">
      {comments.map((c) => (
        <p key={c.id} className="text-[11px] text-zinc-400 border-t border-zinc-900 py-1">{c.body}</p>
      ))}
      {open ? (
        <div className="flex items-center gap-1 mt-1">
          <input
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            onKeyDown={(e) => { if (e.key === 'Enter' && draft.trim()) { onAdd(draft.trim()); setDraft(''); setOpen(false); } }}
            placeholder="Add a comment"
            autoFocus
            className="flex-1 bg-zinc-900 border border-zinc-800 rounded px-2 py-1 text-[11px] text-zinc-200"
          />
          <button
            onClick={() => { if (draft.trim()) { onAdd(draft.trim()); setDraft(''); setOpen(false); } }}
            className="text-[10px] px-2 py-1 rounded bg-orange-600 text-white"
          >
            add
          </button>
        </div>
      ) : (
        <button onClick={() => setOpen(true)} className="text-[10px] text-zinc-400 hover:text-zinc-400 mt-1">Add a comment</button>
      )}
    </div>
  );
}
