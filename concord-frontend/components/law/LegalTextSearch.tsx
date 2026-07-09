'use client';

/**
 * LegalTextSearch — real relevance-ranked keyword search over legal text
 * the user pastes in (a statute, regulation, policy, or contract excerpt),
 * wired to the real `law.statuteLookup` macro.
 *
 * Honest scope: Concord ships no licensed statute/regulation database, so
 * this does NOT search a live corpus — it searches exactly the text you
 * paste, split into sections on blank lines, and ranks them by the same
 * deterministic relevance scoring (title-match weight, phrase bonus,
 * keyword density) the macro applies to any statute corpus. Real
 * computation over real (user-supplied) text — never fabricated results.
 */

import { useState } from 'react';
import { ScrollText, Loader2, Search, Hash } from 'lucide-react';
import { useMacroDispatchFeedback } from '@/hooks/useMacroDispatchFeedback';
import { EmptyState } from '@/components/ui';
import { ds } from '@/lib/design-system';
import { cn } from '@/lib/utils';

interface StatuteMatch {
  code: string;
  jurisdiction: string | null;
  section: string;
  title: string;
  snippet: string;
  relevanceScore: number;
  keywordHits: number;
  exactPhraseMatch: boolean;
}
interface StatuteLookupResult {
  query: string;
  totalMatches: number;
  matches: StatuteMatch[];
  message?: string;
}

function splitIntoProvisions(text: string): { section: string; text: string }[] {
  const blocks = text.split(/\n\s*\n+/).map((b) => b.trim()).filter(Boolean);
  const source = blocks.length > 1 ? blocks : [text.trim()];
  return source.map((b, i) => ({ section: `¶${i + 1}`, text: b }));
}

export function LegalTextSearch() {
  const [docTitle, setDocTitle] = useState('');
  const [text, setText] = useState('');
  const [query, setQuery] = useState('');
  const { status, error, result, dispatch } = useMacroDispatchFeedback<StatuteLookupResult>();
  const busy = status === 'dispatched' || status === 'running';

  async function search() {
    if (!text.trim() || !query.trim()) return;
    const provisions = splitIntoProvisions(text);
    await dispatch('law', 'statuteLookup', {
      query,
      statutes: [
        {
          code: docTitle.trim() || 'Pasted document',
          jurisdiction: null,
          title: docTitle.trim() || 'Pasted document',
          provisions,
        },
      ],
    });
  }

  return (
    <div className={cn(ds.panel, 'space-y-3')}>
      <div className="flex items-center gap-2">
        <ScrollText className="w-4 h-4 text-blue-300" />
        <h2 className="font-semibold text-white">Legal Text Search</h2>
        <span className="text-[10px] text-gray-400">searches text you paste — no licensed statute database</span>
      </div>
      <p className="text-[11px] text-gray-400">
        Paste a statute, regulation, or policy excerpt. It&apos;s split into sections on blank lines and ranked
        by keyword relevance — the same deterministic scoring a real statute corpus would use, run over exactly
        what you pasted.
      </p>

      <div className="grid grid-cols-1 md:grid-cols-3 gap-2">
        <input
          value={docTitle}
          onChange={(e) => setDocTitle(e.target.value)}
          placeholder="Document title (optional)"
          className={cn(ds.input, 'md:col-span-1 text-sm py-1.5')}
        />
        <input
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          onKeyDown={(e) => { if (e.key === 'Enter') void search(); }}
          placeholder="Search keywords…"
          className={cn(ds.input, 'md:col-span-2 text-sm py-1.5')}
        />
      </div>
      <textarea
        value={text}
        onChange={(e) => setText(e.target.value)}
        placeholder="Paste the full text of a statute, regulation, or policy here…"
        rows={6}
        className={cn(ds.textarea, 'text-xs font-mono py-1.5')}
      />
      <button
        onClick={search}
        disabled={busy || !text.trim() || !query.trim()}
        className="px-3 py-1.5 text-xs rounded bg-blue-500/20 text-blue-300 hover:bg-blue-500/30 disabled:opacity-50 inline-flex items-center gap-1.5"
      >
        {busy ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Search className="w-3.5 h-3.5" />}
        {busy ? 'Ranking sections…' : 'Search pasted text'}
      </button>

      {status === 'error' && <p className="text-xs text-rose-400" role="alert">{error}</p>}

      {status === 'done' && result && (
        result.matches.length === 0 ? (
          <EmptyState
            compact
            icon={<Hash className="h-5 w-5" aria-hidden="true" />}
            title={`No sections matched "${result.query}".`}
            description={result.message || 'Try a broader keyword, or paste more of the document.'}
            ariaLabel="Legal text search empty"
          />
        ) : (
          <div className="space-y-1.5">
            <p className="text-[11px] text-gray-400">{result.totalMatches} matching section{result.totalMatches === 1 ? '' : 's'} for &quot;{result.query}&quot;</p>
            {result.matches.map((m) => (
              <div key={`${m.code}-${m.section}`} className="bg-black/40 border border-white/10 rounded-lg p-2.5">
                <div className="flex items-center gap-2 mb-1">
                  <span className="text-xs font-semibold text-blue-300">{m.section}</span>
                  {m.exactPhraseMatch && <span className="text-[9px] px-1.5 py-0.5 rounded bg-emerald-400/15 text-emerald-300">exact phrase</span>}
                  <span className="ml-auto text-[9px] text-gray-500 font-mono">score {m.relevanceScore} · {m.keywordHits} hit{m.keywordHits === 1 ? '' : 's'}</span>
                </div>
                <p className="text-[11px] text-gray-300">{m.snippet}</p>
              </div>
            ))}
          </div>
        )
      )}
    </div>
  );
}
