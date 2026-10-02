'use client';

/** Linguistics north star — one utterance, analyzed only after text is given. */

import { useState } from 'react';
import { useMutation } from '@tanstack/react-query';
import { LensShell } from '@/components/lens/LensShell';
import { NorthGreeting, QuietMore, northCtaClass } from '@/components/code/CodeFamilyChrome';
import { NorthError, northPage } from '@/components/lens/NorthStarChrome';
import { lensRun } from '@/lib/api/client';
import { useAuth } from '@/hooks/useAuth';
import { useLensNav } from '@/hooks/useLensNav';
import { titleCaseDisplayName } from '@/components/chat/claudeCleanGreeting';

type Analysis = { content?: string; wordCount?: number; readingLevel?: string };

export function TheUtterance({ onOpenDesk }: { onOpenDesk: () => void }) {
  useLensNav('linguistics');
  const { user } = useAuth();
  const who = titleCaseDisplayName(user?.username);
  const [composing, setComposing] = useState(false);
  const [text, setText] = useState('');
  const [analysis, setAnalysis] = useState<Analysis | null>(null);
  const open = useMutation({
    mutationFn: async (utterance: string) => {
      const res = await lensRun<Analysis>('linguistics', 'analyze', { text: utterance });
      if (!res.data.ok || !res.data.result || typeof res.data.result.content !== 'string') {
        throw new Error(res.data.error || 'The utterance did not open.');
      }
      return res.data.result;
    },
    onSuccess: (result) => setAnalysis(result),
  });
  const actError = open.error instanceof Error ? open.error.message : '';
  const lines = (analysis?.content ?? '').split('\n').map((line) => line.trim()).filter(Boolean);

  function onOpen() {
    if (!composing) {
      setComposing(true);
      return;
    }
    const utterance = text.trim();
    if (!utterance) return;
    open.mutate(utterance);
  }

  return (
    <LensShell lensId="linguistics" asMain={false} disableAgentFab>
      <div data-lens-theme="linguistics" className={northPage}>
        <div className="flex items-start justify-between gap-4">
          <NorthGreeting kicker="Linguistics" title={who ? `The utterance, ${who}` : 'The utterance'} />
          <QuietMore items={[{ id: 'desk', label: 'Lab' }]} onPick={onOpenDesk} />
        </div>
        {actError && <NorthError message={actError} />}
        {!analysis && (
          <div className="mt-6 min-h-[420px] rounded-2xl border border-white/10 px-4 py-4" data-testid="linguistics-utterance">
            <p className="text-[14px] text-zinc-400">No utterance open.</p>
            {composing && (
              <label className="mt-4 block text-[13px] text-zinc-500">
                Utterance
                <textarea
                  value={text}
                  onChange={(e) => setText(e.target.value)}
                  rows={5}
                  className="mt-1 w-full rounded-xl border border-white/10 bg-transparent px-3 py-2 text-[15px] text-zinc-100 outline-none"
                />
              </label>
            )}
          </div>
        )}
        {analysis && (
          <article className="mt-6 min-h-[420px] rounded-2xl border border-white/10 px-4 py-4" data-testid="linguistics-open">
            {typeof analysis.wordCount === 'number' && typeof analysis.readingLevel === 'string' && (
              <p className="text-[13px] text-zinc-500">{analysis.wordCount} words · {analysis.readingLevel}</p>
            )}
            {lines.map((line, i) => (
              <p key={`${i}-${line.slice(0, 24)}`} className="mt-2 text-[15px] text-zinc-200">{line}</p>
            ))}
          </article>
        )}
        <button type="button" className={northCtaClass} onClick={onOpen} disabled={open.isPending}>Open a text</button>
      </div>
    </LensShell>
  );
}
