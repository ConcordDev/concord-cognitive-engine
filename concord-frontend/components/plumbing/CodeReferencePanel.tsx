'use client';

/**
 * CodeReferencePanel — paraphrased, cited IPC/UPC quick-reference library.
 *
 * Backend: plumbing.codeReference (content/plumbing-code-reference.json via
 * server/lib/plumbing-code-reference.js). COPYRIGHT CONSTRAINT: the IPC/UPC
 * are copyrighted model codes, so this is never verbatim code text — every
 * entry is a paraphrased summary that either cites a real table/section
 * number (`citationConfidence: "table-cited"`) or is honestly flagged as an
 * uncited cross-code-family pattern (`citationConfidence: "general-pattern"`,
 * `citation: null`) rather than risking a fabricated citation. Mirrors
 * healthcare's ProtocolsPanel (content/healthcare-protocols.json) — the
 * disclaimer is always visible, never buried, and every card shows its
 * citation state honestly.
 */

import { useEffect, useState } from 'react';
import { BookMarked, Loader2, Info, ShieldQuestion, ExternalLink } from 'lucide-react';
import { lensRun } from '@/lib/api/client';

interface CodeRefEntry {
  id: string;
  category: string;
  title: string;
  citation: string | null;
  citationConfidence: 'table-cited' | 'general-pattern';
  summary: string;
  disclaimer: string;
}

interface CodeRefResult {
  entries: CodeRefEntry[];
  categories: string[];
  total: number;
  disclaimer: string;
}

export function CodeReferencePanel() {
  const [entries, setEntries] = useState<CodeRefEntry[]>([]);
  const [categories, setCategories] = useState<string[]>([]);
  const [libraryDisclaimer, setLibraryDisclaimer] = useState('');
  const [categoryFilter, setCategoryFilter] = useState('');
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    lensRun<CodeRefResult>('plumbing', 'codeReference', categoryFilter ? { category: categoryFilter } : {})
      .then((r) => {
        if (cancelled) return;
        if (r.data?.ok && r.data.result) {
          setEntries(r.data.result.entries || []);
          setCategories(r.data.result.categories || []);
          setLibraryDisclaimer(r.data.result.disclaimer || '');
        }
      })
      .catch(() => { /* honest empty state below */ })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [categoryFilter]);

  return (
    <div className="overflow-hidden rounded-xl border border-indigo-500/20 bg-gradient-to-br from-zinc-950 via-indigo-950/10 to-zinc-950">
      <header className="flex items-center justify-between gap-2 border-b border-indigo-500/20 bg-zinc-900/40 px-4 py-2 flex-wrap">
        <div className="flex items-center gap-2">
          <BookMarked className="h-4 w-4 text-indigo-400" />
          <span className="text-sm font-semibold text-white">Code quick reference</span>
          <span className="rounded bg-zinc-800 px-1.5 py-0.5 font-mono text-[10px] text-zinc-400">plumbing.codeReference</span>
        </div>
        <select
          value={categoryFilter}
          onChange={(e) => setCategoryFilter(e.target.value)}
          className="rounded border border-zinc-800 bg-zinc-950 px-2 py-1 text-xs text-white"
        >
          <option value="">All categories</option>
          {categories.map((c) => <option key={c} value={c}>{c}</option>)}
        </select>
      </header>

      <div className="p-4 space-y-3">
        {/* Always-visible library disclaimer — never buried. */}
        <div className="flex items-start gap-2 rounded-lg border border-amber-500/20 bg-amber-500/[0.06] px-3 py-2.5">
          <Info className="mt-0.5 h-3.5 w-3.5 shrink-0 text-amber-300" />
          <p className="text-[11px] leading-relaxed text-amber-200/90">
            {libraryDisclaimer || 'Paraphrased quick reference only — not the verbatim IPC/UPC code text, and not a substitute for your locally adopted code edition. Always verify with your Authority Having Jurisdiction (AHJ) before design or construction.'}
          </p>
        </div>

        {loading && (
          <div className="flex items-center justify-center py-8 text-zinc-400">
            <Loader2 className="mr-2 h-4 w-4 animate-spin" /> Loading code reference library…
          </div>
        )}
        {!loading && entries.length === 0 && (
          <div className="py-8 text-center text-xs text-zinc-400">No reference entries for this filter.</div>
        )}
        {!loading && entries.length > 0 && (
          <ul className="space-y-2">
            {entries.map((e) => (
              <li key={e.id} className="rounded-lg border border-white/10 bg-zinc-950/40 p-3">
                <div className="flex items-start justify-between gap-2 flex-wrap">
                  <div className="text-xs font-semibold text-gray-100">{e.title}</div>
                  {e.citation ? (
                    <span className="inline-flex items-center gap-1 rounded bg-indigo-500/10 border border-indigo-500/25 px-1.5 py-0.5 text-[10px] font-mono text-indigo-200">
                      <ExternalLink className="h-2.5 w-2.5" /> {e.citation}
                    </span>
                  ) : (
                    <span className="inline-flex items-center gap-1 rounded bg-zinc-800 px-1.5 py-0.5 text-[10px] text-zinc-400">
                      <ShieldQuestion className="h-2.5 w-2.5" /> general pattern — no exact section cited
                    </span>
                  )}
                </div>
                <p className="mt-1.5 text-xs leading-relaxed text-gray-300">{e.summary}</p>
                <p className="mt-1.5 text-[10px] italic leading-relaxed text-zinc-500">{e.disclaimer}</p>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}

export default CodeReferencePanel;
