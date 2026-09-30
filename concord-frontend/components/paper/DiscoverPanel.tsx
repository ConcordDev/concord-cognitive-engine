'use client';

/**
 * DiscoverPanel — Zotero "Add Item" analogue: arXiv, Open Library, CrossRef.
 * One inner source union; each child owns its own search macros.
 */

import { useState, type ComponentType } from 'react';
import { BookOpen, BookText, FileSearch } from 'lucide-react';
import { ArxivSearch } from '@/components/paper/ArxivSearch';
import { OpenLibraryPanel } from '@/components/paper/OpenLibraryPanel';
import { CrossRefPanel } from '@/components/research/CrossRefPanel';
import { ds } from '@/lib/design-system';
import { cn } from '@/lib/utils';

type DiscoverSource = 'arxiv' | 'openlibrary' | 'crossref';

const SOURCES: { id: DiscoverSource; label: string; hint: string; icon: typeof FileSearch }[] = [
  { id: 'arxiv', label: 'arXiv', hint: 'preprints', icon: FileSearch },
  { id: 'openlibrary', label: 'Open Library', hint: 'books', icon: BookOpen },
  { id: 'crossref', label: 'CrossRef', hint: 'DOI metadata', icon: BookText },
];

const SOURCE_PANELS: Record<DiscoverSource, ComponentType> = {
  arxiv: ArxivSearch,
  openlibrary: function OpenLibrarySource() { return <OpenLibraryPanel domain="paper" />; },
  crossref: function CrossRefSource() { return <CrossRefPanel domain="paper" />; },
};

export function DiscoverPanel() {
  const [source, setSource] = useState<DiscoverSource>('arxiv');
  const Panel = SOURCE_PANELS[source];

  return (
    <div className="space-y-4">
      <div>
        <h2 className={ds.heading2}>Discover</h2>
        <p className={ds.textMuted}>
          Search live catalogs — arXiv export, Open Library, CrossRef. No keys. Results are real.
        </p>
      </div>
      <nav className="flex items-center gap-1 border-b border-lattice-border overflow-x-auto" aria-label="Catalog source">
        {SOURCES.map((s) => {
          const Icon = s.icon;
          const on = source === s.id;
          return (
            <button
              key={s.id}
              type="button"
              onClick={() => setSource(s.id)}
              className={cn(
                'flex items-center gap-2 px-3 py-2 text-sm font-medium border-b-2 whitespace-nowrap transition-colors',
                on
                  ? 'border-[var(--lens-accent)] text-white'
                  : 'border-transparent text-gray-400 hover:text-white',
              )}
              aria-pressed={on}
            >
              <Icon className="w-4 h-4" />
              {s.label}
              <span className="text-[10px] uppercase tracking-wider text-gray-500">{s.hint}</span>
            </button>
          );
        })}
      </nav>
      <Panel />
    </div>
  );
}
