'use client';

/** Paper north star — open a paper the library already holds. */

import { useState } from 'react';
import { useMutation } from '@tanstack/react-query';
import { LensShell } from '@/components/lens/LensShell';
import { NorthGreeting, QuietMore, northCtaClass } from '@/components/code/CodeFamilyChrome';
import { NorthError, northPage, useMacro } from '@/components/lens/NorthStarChrome';
import { lensRun } from '@/lib/api/client';
import { useAuth } from '@/hooks/useAuth';
import { useLensNav } from '@/hooks/useLensNav';
import { titleCaseDisplayName } from '@/components/chat/claudeCleanGreeting';

type PaperRow = { id: string; title?: string; abstract?: string; authors?: string[] };

export function ThePaper({ onOpenDesk }: { onOpenDesk: () => void }) {
  useLensNav('paper');
  const { user } = useAuth();
  const who = titleCaseDisplayName(user?.username);
  const [picked, setPicked] = useState<string | null>(null);
  const [opened, setOpened] = useState<PaperRow | null>(null);
  const [emptyNote, setEmptyNote] = useState('');
  const listQ = useMacro<{ papers?: PaperRow[] }>(
    ['paper-northstar', 'list'],
    'paper',
    'paper-list',
    {},
    (result) => {
      if (!Array.isArray(result.papers)) throw new Error('Papers did not answer.');
      return result;
    },
  );
  const papers = listQ.data?.papers ?? [];
  const open = useMutation({
    mutationFn: async (id: string) => {
      const res = await lensRun<{ paper?: PaperRow }>('paper', 'paper-detail', { id });
      if (!res.data.ok || !res.data.result?.paper) {
        throw new Error(res.data.error || 'That paper did not open.');
      }
      return res.data.result.paper;
    },
    onSuccess: setOpened,
  });
  const loadError = listQ.error instanceof Error ? listQ.error.message : '';
  const actError = open.error instanceof Error ? open.error.message : '';

  function openAPaper() {
    setEmptyNote('');
    if (!listQ.data) return;
    const id = (picked && papers.some((p) => p.id === picked) ? picked : papers[0]?.id) ?? '';
    if (!id) {
      setEmptyNote('No paper to open.');
      return;
    }
    open.mutate(id);
  }

  return (
    <LensShell lensId="paper" asMain={false} disableAgentFab>
      <div data-lens-theme="paper" className={northPage}>
        <div className="flex items-start justify-between gap-4">
          <NorthGreeting kicker="Paper" title={who ? `The paper in front of you, ${who}` : 'The paper in front of you'} />
          <QuietMore items={[{ id: 'library', label: 'Library' }]} onPick={onOpenDesk} />
        </div>

        {(loadError || actError || emptyNote) && <NorthError message={loadError || actError || emptyNote} />}

        {listQ.data && !opened && papers.length === 0 && (
          <div className="mt-6 min-h-[420px] rounded-2xl border border-white/10 px-4 py-4" data-testid="paper-empty">
            <p className="text-[14px] text-zinc-400">No paper open.</p>
          </div>
        )}

        {listQ.data && !opened && papers.length > 0 && (
          <ul className="mt-6 min-h-[420px] rounded-2xl border border-white/10 p-2" data-testid="paper-list">
            {papers.map((p) => (
              <li key={p.id}>
                <button
                  type="button"
                  onClick={() => setPicked(p.id)}
                  className={`w-full rounded-lg px-3 py-2 text-left text-[15px] ${picked === p.id ? 'bg-white/10 text-zinc-100' : 'text-zinc-300 hover:bg-white/[0.04]'}`}
                >
                  {p.title || 'Untitled'}
                </button>
              </li>
            ))}
          </ul>
        )}

        {opened && (
          <article className="mt-6 min-h-[420px] rounded-2xl border border-white/10 px-4 py-4" data-testid="paper-open">
            <h2 className="text-[18px] text-zinc-100">{opened.title || 'Untitled'}</h2>
            {opened.authors && opened.authors.length > 0 && (
              <p className="mt-1 text-[13px] text-zinc-500">{opened.authors.join(', ')}</p>
            )}
            {opened.abstract && <p className="mt-3 text-[15px] text-zinc-200">{opened.abstract}</p>}
          </article>
        )}

        <button
          type="button"
          className={northCtaClass}
          disabled={listQ.isLoading || open.isPending}
          onClick={openAPaper}
        >
          Open a paper
        </button>
      </div>
    </LensShell>
  );
}
