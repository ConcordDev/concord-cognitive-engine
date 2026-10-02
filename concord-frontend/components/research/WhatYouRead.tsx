'use client';

/** Research north star — search, then one paper. The library count stays quiet. */

import { useState } from 'react';
import { LensShell } from '@/components/lens/LensShell';
import { NorthGreeting, QuietMore, northCtaClass } from '@/components/code/CodeFamilyChrome';
import { NorthError, northPage, useMacro } from '@/components/lens/NorthStarChrome';
import { lensRun } from '@/lib/api/client';
import { useAuth } from '@/hooks/useAuth';
import { useLensNav } from '@/hooks/useLensNav';
import { titleCaseDisplayName } from '@/components/chat/claudeCleanGreeting';
import { cn } from '@/lib/utils';

type Source = 'research' | 'library' | 'arxiv';
type Ref = { id?: string; title?: string; authors?: string; year?: number };

const SOURCES: { id: Source; label: string }[] = [
  { id: 'research', label: 'Research' },
  { id: 'library', label: 'Library' },
  { id: 'arxiv', label: 'arXiv' },
];

function firstArxivTitle(xml: string): string | null {
  const titles = [...xml.matchAll(/<title>([\s\S]*?)<\/title>/g)].map((m) =>
    m[1].replace(/\s+/g, ' ').trim(),
  );
  return titles.find((title, index) => index > 0 && title.length > 0) ?? null;
}

export function WhatYouRead({ onOpenDesk }: { onOpenDesk: () => void }) {
  useLensNav('research');
  const { user } = useAuth();
  const who = titleCaseDisplayName(user?.username);
  const statsQ = useMacro<{ references?: number }>(
    ['research-northstar', 'stats'],
    'research',
    'library-stats',
    {},
    (result) => {
      if (typeof result.references !== 'number') throw new Error('The library did not answer.');
      return result;
    },
  );
  const [source, setSource] = useState<Source>('research');
  const [query, setQuery] = useState('');
  const [paper, setPaper] = useState<string | null>(null);
  const [searched, setSearched] = useState(false);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  const search = async () => {
    const q = query.trim();
    if (!q) {
      setError('Search needs a few words.');
      return;
    }
    setBusy(true);
    setError('');
    setPaper(null);
    setSearched(false);
    try {
      if (source === 'arxiv') {
        const res = await fetch(`https://export.arxiv.org/api/query?search_query=all:${encodeURIComponent(q)}&start=0&max_results=5`);
        if (!res.ok) throw new Error(`arXiv did not answer (${res.status}).`);
        setPaper(firstArxivTitle(await res.text()));
      } else {
        const res = await lensRun<{ references?: Ref[] }>('research', 'reference-list', { query: q });
        if (!res.data.ok || !Array.isArray(res.data.result?.references)) {
          throw new Error(res.data.error || 'The library did not answer.');
        }
        setPaper(res.data.result.references[0]?.title || null);
      }
      setSearched(true);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Search did not answer.');
    } finally {
      setBusy(false);
    }
  };

  const count = statsQ.data?.references;
  const statsError = statsQ.error instanceof Error ? statsQ.error.message : '';

  return (
    <LensShell lensId="research" asMain={false} disableAgentFab>
      <div data-lens-theme="research" className={northPage}>
        <div className="flex items-start justify-between gap-4">
          <div>
            <NorthGreeting kicker="Research" title={who ? `What are you reading, ${who}` : 'What are you reading'} />
            <nav aria-label="Research" className="mt-5 inline-flex items-center gap-0.5 rounded-full border border-white/10 bg-white/[0.04] p-1">
              {SOURCES.map((item) => (
                <button
                  key={item.id}
                  type="button"
                  aria-pressed={source === item.id}
                  onClick={() => { setSource(item.id); setPaper(null); setSearched(false); }}
                  className={cn(
                    'rounded-full px-3.5 py-1 text-[13px]',
                    source === item.id ? 'bg-white/10 text-zinc-100' : 'text-zinc-500 hover:text-zinc-200',
                  )}
                >
                  {item.label}
                </button>
              ))}
            </nav>
          </div>
          <QuietMore items={[{ id: 'desk', label: 'Desk' }]} onPick={onOpenDesk} />
        </div>

        {typeof count === 'number' && (
          <p className="mt-4 text-[13px] text-zinc-500">{count} in the library</p>
        )}
        {(statsError || error) && <NorthError message={error || statsError} />}

        <form className="mt-6 max-w-xl" onSubmit={(e) => { e.preventDefault(); void search(); }}>
          <input
            aria-label="Search"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search"
            className="w-full rounded-lg border border-white/10 bg-black px-3 py-2 text-[15px]"
          />
        </form>

        {paper && (
          <article className="mt-6 max-w-xl rounded-xl border border-white/10 px-4 py-4">
            <p className="text-[16px] text-zinc-100">{paper}</p>
          </article>
        )}
        {searched && !paper && !error && <p className="mt-6 text-[14px] text-zinc-500">No paper.</p>}

        <button type="button" className={northCtaClass} onClick={() => void search()} disabled={busy}>Search</button>
      </div>
    </LensShell>
  );
}
