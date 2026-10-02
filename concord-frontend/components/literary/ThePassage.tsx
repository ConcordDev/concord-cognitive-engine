'use client';

/** Literary north star — open a text only after a real search line. */

import { useState } from 'react';
import { useMutation } from '@tanstack/react-query';
import { LensShell } from '@/components/lens/LensShell';
import { NorthGreeting, QuietMore, northCtaClass } from '@/components/code/CodeFamilyChrome';
import { NorthError, northPage } from '@/components/lens/NorthStarChrome';
import { lensRun } from '@/lib/api/client';
import { useAuth } from '@/hooks/useAuth';
import { useLensNav } from '@/hooks/useLensNav';
import { titleCaseDisplayName } from '@/components/chat/claudeCleanGreeting';

type Hit = { chunkId?: string; title?: string; author?: string; snippet?: string };

export function ThePassage({ onOpenDesk }: { onOpenDesk: () => void }) {
  useLensNav('literary');
  const { user } = useAuth();
  const who = titleCaseDisplayName(user?.username);
  const [line, setLine] = useState('');
  const [note, setNote] = useState('');
  const search = useMutation({
    mutationFn: async (query: string) => {
      const res = await lensRun<{ results?: Hit[]; count?: number }>('literary', 'search', { query, limit: 5, keyword: true });
      if (!res.data.ok || !res.data.result || !Array.isArray(res.data.result.results)) {
        throw new Error(res.data.error || 'The corpus did not answer.');
      }
      return res.data.result.results;
    },
  });
  const hits = search.data ?? [];
  const lead = hits[0];
  const actError = search.error instanceof Error ? search.error.message : '';

  function openText() {
    const query = line.trim();
    setNote('');
    if (!query) {
      setNote('Paste a line before opening a text.');
      return;
    }
    search.mutate(query);
  }

  return (
    <LensShell lensId="literary" asMain={false} disableAgentFab>
      <div data-lens-theme="literary" className={northPage}>
        <div className="flex items-start justify-between gap-4">
          <NorthGreeting kicker="Literary" title={who ? `The passage, ${who}` : 'The passage'} />
          <QuietMore items={[{ id: 'corpus', label: 'Corpus' }]} onPick={onOpenDesk} />
        </div>

        <label className="mt-6 block max-w-xl text-[13px] text-zinc-500">
          Line
          <input
            value={line}
            onChange={(e) => setLine(e.target.value)}
            className="mt-1 w-full rounded-xl border border-white/10 bg-transparent px-3 py-2 text-[15px] text-zinc-100 outline-none"
          />
        </label>

        {(actError || note) && <NorthError message={actError || note} />}

        {!lead && (
          <div className="mt-4 min-h-[360px] rounded-2xl border border-white/10 px-4 py-4" data-testid="literary-empty">
            <p className="text-[14px] text-zinc-400">
              {search.data && hits.length === 0 ? 'No text matched that line.' : 'No text open.'}
            </p>
          </div>
        )}

        {lead && (
          <article className="mt-4 min-h-[360px] rounded-2xl border border-white/10 px-4 py-4" data-testid="literary-open">
            <h2 className="text-[18px] text-zinc-100">{lead.title || 'Untitled'}</h2>
            {lead.author && <p className="mt-1 text-[13px] text-zinc-500">{lead.author}</p>}
            {lead.snippet && <p className="mt-3 text-[15px] text-zinc-200">{lead.snippet}</p>}
          </article>
        )}

        <button type="button" className={northCtaClass} onClick={openText} disabled={search.isPending}>
          Open a text
        </button>
      </div>
    </LensShell>
  );
}
