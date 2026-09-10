'use client';

/**
 * Reference library for the math CAS — arXiv math, math.SE, STSVK theorems.
 * Each child is a real feed; this panel only routes between them.
 */

import { useState } from 'react';
import { BookOpen, MessageSquare, Orbit } from 'lucide-react';
import { ArxivPanel } from '@/components/research/ArxivPanel';
import { MathStackFeed } from '@/components/math/MathStackFeed';
import STSVKExplorer from '@/components/visualizations/STSVKExplorer';
import { ds } from '@/lib/design-system';
import { cn } from '@/lib/utils';

const SOURCES = [
  { id: 'arxiv', label: 'arXiv', icon: BookOpen },
  { id: 'stack', label: 'Math.SE', icon: MessageSquare },
  { id: 'stsvk', label: 'STSVK', icon: Orbit },
] as const;

type Source = (typeof SOURCES)[number]['id'];

export function MathLibraryPanel() {
  const [source, setSource] = useState<Source>('arxiv');

  return (
    <div className="space-y-3">
      <nav className="flex gap-1" role="tablist" aria-label="Reference source">
        {SOURCES.map((s) => {
          const Icon = s.icon;
          const on = source === s.id;
          return (
            <button
              key={s.id}
              type="button"
              role="tab"
              aria-selected={on}
              onClick={() => setSource(s.id)}
              className={cn(
                'flex items-center gap-1.5 px-3 py-1.5 rounded-md text-xs font-medium border',
                on
                  ? 'border-[color:var(--lens-accent)] text-white bg-white/5'
                  : 'border-lattice-border text-gray-400 hover:text-white',
              )}
            >
              <Icon className="h-3.5 w-3.5" />
              {s.label}
            </button>
          );
        })}
      </nav>

      {source === 'arxiv' && (
        <section className={ds.panel}>
          <ArxivPanel domain="math" title="arXiv · Mathematics" />
        </section>
      )}
      {source === 'stack' && (
        <section className={ds.panel}>
          <MathStackFeed />
        </section>
      )}
      {source === 'stsvk' && (
        <section className={ds.panel}>
          <STSVKExplorer />
        </section>
      )}
    </div>
  );
}
