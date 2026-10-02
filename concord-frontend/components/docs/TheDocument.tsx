'use client';

/** Docs north star — one page from page-list / page-create. */

import { useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { LensShell } from '@/components/lens/LensShell';
import { NorthGreeting, QuietMore, northCtaClass } from '@/components/code/CodeFamilyChrome';
import { NorthError, northPage, useMacro } from '@/components/lens/NorthStarChrome';
import { lensRun } from '@/lib/api/client';
import { useAuth } from '@/hooks/useAuth';
import { useLensNav } from '@/hooks/useLensNav';
import { titleCaseDisplayName } from '@/components/chat/claudeCleanGreeting';

type DocPage = { id: string; title?: string; blocks?: { id?: string; text?: string }[] };
type DocMeta = { id: string; title?: string };

export function TheDocument({ onOpenDesk }: { onOpenDesk: () => void }) {
  useLensNav('docs');
  const { user } = useAuth();
  const who = titleCaseDisplayName(user?.username);
  const client = useQueryClient();
  const [open, setOpen] = useState<DocPage | null>(null);
  const listQ = useMacro<{ pages?: DocMeta[] }>(
    ['docs-northstar', 'pages'],
    'docs',
    'page-list',
    {},
    (result) => {
      if (!Array.isArray(result.pages)) throw new Error('Documents did not answer.');
      return result;
    },
  );
  const pages = listQ.data?.pages ?? [];
  const create = useMutation({
    mutationFn: async () => {
      const res = await lensRun<{ page?: DocPage }>('docs', 'page-create', {});
      if (!res.data.ok || !res.data.result?.page?.id) {
        throw new Error(res.data.error || 'The page was not created.');
      }
      return res.data.result.page;
    },
    onSuccess: (page) => {
      setOpen(page);
      void client.invalidateQueries({ queryKey: ['docs-northstar', 'pages'] });
    },
  });
  const loadError = listQ.error instanceof Error ? listQ.error.message : '';
  const actError = create.error instanceof Error ? create.error.message : '';
  const blocks = (open?.blocks ?? []).map((b) => b.text).filter((t): t is string => !!t && t.trim().length > 0);

  async function openExisting(id: string) {
    const res = await lensRun<{ page?: DocPage }>('docs', 'page-detail', { id });
    if (!res.data.ok || !res.data.result?.page) return;
    setOpen(res.data.result.page);
  }

  return (
    <LensShell lensId="docs" asMain={false} disableAgentFab>
      <div data-lens-theme="docs" className={northPage}>
        <div className="flex items-start justify-between gap-4">
          <NorthGreeting kicker="Docs" title={who ? `The document, ${who}` : 'The document'} />
          <QuietMore items={[{ id: 'workspace', label: 'Workspace' }]} onPick={onOpenDesk} />
        </div>

        {(loadError || actError) && <NorthError message={loadError || actError} />}

        {listQ.data && !open && pages.length === 0 && (
          <div className="mt-6 min-h-[420px] rounded-2xl border border-white/10 px-4 py-4" data-testid="docs-empty">
            <p className="text-[14px] text-zinc-400">No document open.</p>
          </div>
        )}

        {listQ.data && !open && pages.length > 0 && (
          <ul className="mt-6 min-h-[420px] rounded-2xl border border-white/10 p-2" data-testid="docs-pages">
            {pages.map((p) => (
              <li key={p.id}>
                <button type="button" onClick={() => { void openExisting(p.id); }} className="w-full rounded-lg px-3 py-2 text-left text-[15px] text-zinc-200 hover:bg-white/[0.04]">
                  {p.title || 'Untitled'}
                </button>
              </li>
            ))}
          </ul>
        )}

        {open && (
          <article className="mt-6 min-h-[420px] rounded-2xl border border-white/10 px-4 py-4" data-testid="docs-open">
            <h2 className="text-[18px] text-zinc-100">{open.title || 'Untitled'}</h2>
            {blocks.length === 0 && <p className="mt-3 text-[14px] text-zinc-500">This page has no blocks yet.</p>}
            {blocks.map((text, i) => (
              <p key={`${i}-${text.slice(0, 24)}`} className="mt-3 text-[15px] text-zinc-200">{text}</p>
            ))}
          </article>
        )}

        <button type="button" className={northCtaClass} onClick={() => create.mutate()} disabled={create.isPending || listQ.isLoading}>
          + New doc
        </button>
      </div>
    </LensShell>
  );
}
