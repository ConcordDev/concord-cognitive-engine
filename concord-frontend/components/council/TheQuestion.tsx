'use client';

/** Council north star — one proposal. Quorum is not claimed when the table is empty. */

import { useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { LensShell } from '@/components/lens/LensShell';
import { NorthGreeting, QuietMore, northCtaClass } from '@/components/code/CodeFamilyChrome';
import { FamilyPill, NorthError, northPage } from '@/components/lens/NorthStarChrome';
import { api } from '@/lib/api/client';
import { useAuth } from '@/hooks/useAuth';
import { useLensNav } from '@/hooks/useLensNav';
import { titleCaseDisplayName } from '@/components/chat/claudeCleanGreeting';

type ProposalData = { title?: string; status?: string; votes?: Record<string, string> };
type ProposalItem = { id: string; title?: string; data?: ProposalData };

const PILL = [
  { id: 'council', label: 'Council', href: '/lenses/council' },
  { id: 'vote', label: 'Votes', href: '/lenses/vote' },
];

const quiet = { retry: false, refetchOnWindowFocus: false } as const;

export function TheQuestion({ onOpenDesk }: { onOpenDesk: () => void }) {
  useLensNav('council');
  const { user } = useAuth();
  const who = titleCaseDisplayName(user?.username);
  const client = useQueryClient();
  const proposalsQ = useQuery({
    queryKey: ['council-northstar', 'proposals'],
    ...quiet,
    queryFn: async () => {
      const res = await api.get<{ ok?: boolean; error?: string; artifacts?: ProposalItem[] }>('/api/lens/council?type=proposal');
      if (res.data?.ok === false) throw new Error(res.data.error || 'The chamber did not answer.');
      if (!Array.isArray(res.data?.artifacts)) throw new Error('The chamber did not answer.');
      return res.data.artifacts;
    },
  });

  const proposal = proposalsQ.data?.[0] ?? null;
  const title = proposal?.data?.title || proposal?.title || null;
  const votes = proposal?.data?.votes;
  const ballot = votes && Object.keys(votes).length > 0 ? Object.keys(votes).length : null;
  const [composing, setComposing] = useState(false);
  const [question, setQuestion] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  const start = async () => {
    if (!question.trim()) {
      setError('A debate needs a question.');
      return;
    }
    setBusy(true);
    setError('');
    try {
      const res = await api.post('/api/lens/council', {
        type: 'proposal',
        title: question.trim(),
        data: {
          title: question.trim(),
          description: '',
          status: 'discussion',
          votes: {},
          quorumRequired: 1,
        },
      });
      if (res.data?.ok === false) {
        setError(res.data.error || 'The question was not saved.');
        return;
      }
      setQuestion('');
      setComposing(false);
      await client.invalidateQueries({ queryKey: ['council-northstar', 'proposals'] });
    } catch (err) {
      setError(err instanceof Error ? err.message : 'The question was not saved.');
    } finally {
      setBusy(false);
    }
  };

  const loadError = proposalsQ.error instanceof Error ? proposalsQ.error.message : '';

  return (
    <LensShell lensId="council" asMain={false} disableAgentFab>
      <div data-lens-theme="council" className={northPage}>
        <div className="flex items-start justify-between gap-4">
          <div>
            <NorthGreeting kicker="Council" title={who ? `What's the question, ${who}` : "What's the question"} />
            <FamilyPill label="Council" active="council" items={PILL} />
          </div>
          <QuietMore items={[{ id: 'desk', label: 'Chamber' }]} onPick={onOpenDesk} />
        </div>

        {(loadError || error) && <NorthError message={error || loadError} />}

        {proposalsQ.data && !proposal && <p className="mt-8 text-[15px] text-zinc-400">No proposal on the table</p>}
        {proposal && (
          <article className="mt-8 max-w-xl rounded-xl border border-white/10 px-4 py-4">
            <p className="text-[16px] text-zinc-100">{title}</p>
            {ballot != null && <p className="mt-1 text-[14px] text-zinc-500">{ballot} votes cast</p>}
          </article>
        )}

        {composing && (
          <form className="mt-4 max-w-xl space-y-2" onSubmit={(e) => { e.preventDefault(); void start(); }}>
            <input aria-label="Question" value={question} onChange={(e) => setQuestion(e.target.value)} placeholder="The question" className="w-full rounded-lg border border-white/10 bg-black px-3 py-2 text-[14px]" />
            <button type="submit" disabled={busy} className="rounded-full bg-white/10 px-4 py-2 text-[14px] disabled:opacity-50">Put it on the table</button>
          </form>
        )}

        <button type="button" className={northCtaClass} onClick={() => setComposing(true)}>Start a debate</button>
      </div>
    </LensShell>
  );
}
