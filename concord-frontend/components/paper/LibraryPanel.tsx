'use client';

/**
 * LibraryPanel — Zotero-shaped reading library: collections, status, notes,
 * plus arXiv citation search and LLM summarizer (real macros).
 */

import { PaperLibrary } from '@/components/paper/PaperLibrary';
import { CitationSearch } from '@/components/paper/CitationSearch';
import { PaperSummarizer } from '@/components/paper/PaperSummarizer';
import { LensFeedButton } from '@/components/lens/LensFeedButton';
import { ds } from '@/lib/design-system';

export function LibraryPanel() {
  return (
    <div className="space-y-4">
      <div>
        <h2 className={ds.heading2}>Library</h2>
        <p className={ds.textMuted}>
          Zotero-shaped collections — save, tag, rate, annotate. Search and summarize from live arXiv.
        </p>
      </div>
      <LensFeedButton domain="paper" />
      <PaperLibrary />
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <CitationSearch />
        <PaperSummarizer />
      </div>
    </div>
  );
}
