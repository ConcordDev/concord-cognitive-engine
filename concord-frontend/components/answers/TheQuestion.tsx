'use client';

/** Answers north star — one thread from question-list / question-ask. */

import { useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { LensShell } from '@/components/lens/LensShell';
import { NorthGreeting, QuietMore, northCtaClass } from '@/components/code/CodeFamilyChrome';
import { NorthError, northPage, useMacro } from '@/components/lens/NorthStarChrome';
import { lensRun } from '@/lib/api/client';
import { useAuth } from '@/hooks/useAuth';
import { useLensNav } from '@/hooks/useLensNav';
import { titleCaseDisplayName } from '@/components/chat/claudeCleanGreeting';

type QuestionSummary = { id: string; title?: string; answerCount?: number };
type Question = { id: string; title?: string; body?: string; answers?: { id: string }[] };

const TITLE_MIN = 8;
const BODY_MIN = 15;

export function TheQuestion({ onOpenDesk }: { onOpenDesk: () => void }) {
  useLensNav('answers');
  const { user } = useAuth();
  const who = titleCaseDisplayName(user?.username);
  const client = useQueryClient();
  const [composing, setComposing] = useState(false);
  const [title, setTitle] = useState('');
  const [body, setBody] = useState('');
  const [open, setOpen] = useState<Question | null>(null);
  const [openError, setOpenError] = useState('');

  const listQ = useMacro<{ questions?: QuestionSummary[] }>(
    ['answers-northstar', 'questions'],
    'answers',
    'question-list',
    {},
    (result) => {
      if (!Array.isArray(result.questions)) throw new Error('The thread did not answer.');
      return result;
    },
  );
  const ask = useMutation({
    mutationFn: async (input: { title: string; body: string }) => {
      const res = await lensRun<{ question?: Question }>('answers', 'question-ask', input);
      if (!res.data.ok || !res.data.result?.question?.id) {
        throw new Error(res.data.error || 'The question was not asked.');
      }
      return res.data.result.question;
    },
    onSuccess: (question) => {
      setOpen(question);
      setTitle('');
      setBody('');
      setComposing(false);
      void client.invalidateQueries({ queryKey: ['answers-northstar', 'questions'] });
    },
  });

  const questions = listQ.data?.questions ?? [];
  const loadError = listQ.error instanceof Error ? listQ.error.message : '';
  const actError = ask.error instanceof Error ? ask.error.message : '';

  function onAsk() {
    if (!composing) {
      setComposing(true);
      return;
    }
    const nextTitle = title.trim();
    const nextBody = body.trim();
    if (nextTitle.length < TITLE_MIN || nextBody.length < BODY_MIN) return;
    ask.mutate({ title: nextTitle, body: nextBody });
  }

  async function openExisting(id: string) {
    setOpenError('');
    const res = await lensRun<{ question?: Question }>('answers', 'question-detail', { id });
    if (!res.data.ok || !res.data.result?.question) {
      setOpenError(res.data.error || 'That question did not open.');
      return;
    }
    setOpen(res.data.result.question);
  }

  return (
    <LensShell lensId="answers" asMain={false} disableAgentFab>
      <div data-lens-theme="answers" className={northPage}>
        <div className="flex items-start justify-between gap-4">
          <NorthGreeting kicker="The Answers" title={who ? `The question, ${who}` : 'The question'} />
          <QuietMore items={[{ id: 'desk', label: 'Oracle' }]} onPick={onOpenDesk} />
        </div>
        {(loadError || actError || openError) && <NorthError message={loadError || actError || openError} />}
        {listQ.data && !open && (
          <div className="mt-6 min-h-[420px] rounded-2xl border border-white/10 px-4 py-4" data-testid="answers-thread">
            {questions.length === 0 && <p className="text-[14px] text-zinc-400">The thread is empty.</p>}
            {questions.length > 0 && (
              <ul className="divide-y divide-white/10">
                {questions.map((q) => (
                  <li key={q.id}>
                    <button
                      type="button"
                      onClick={() => { void openExisting(q.id); }}
                      className="w-full py-3 text-left text-[15px] text-zinc-100 hover:text-white"
                    >
                      {q.title || 'Untitled'}
                      {typeof q.answerCount === 'number' && (
                        <span className="ml-2 text-[13px] text-zinc-500">{q.answerCount} answers</span>
                      )}
                    </button>
                  </li>
                ))}
              </ul>
            )}
            {composing && (
              <div className="mt-4 space-y-3">
                <label className="block text-[13px] text-zinc-500">
                  Question
                  <input
                    value={title}
                    onChange={(e) => setTitle(e.target.value)}
                    className="mt-1 w-full rounded-xl border border-white/10 bg-transparent px-3 py-2 text-[15px] text-zinc-100 outline-none"
                  />
                </label>
                <label className="block text-[13px] text-zinc-500">
                  Detail
                  <textarea
                    value={body}
                    onChange={(e) => setBody(e.target.value)}
                    rows={4}
                    className="mt-1 w-full rounded-xl border border-white/10 bg-transparent px-3 py-2 text-[15px] text-zinc-100 outline-none"
                  />
                </label>
              </div>
            )}
          </div>
        )}
        {open && (
          <article className="mt-6 min-h-[420px] rounded-2xl border border-white/10 px-4 py-4" data-testid="answers-open">
            <h2 className="text-[18px] text-zinc-100">{open.title || 'Untitled'}</h2>
            {open.body?.trim() && <p className="mt-3 text-[15px] text-zinc-200">{open.body}</p>}
          </article>
        )}
        <button type="button" className={northCtaClass} onClick={onAsk} disabled={listQ.isLoading || ask.isPending}>Ask</button>
      </div>
    </LensShell>
  );
}
