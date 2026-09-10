'use client';

/**
 * AnnotationsPanel — durable literary annotation library.
 * Extracted from literary/page.tsx consolidation.
 */

import { Library } from 'lucide-react';
import { useLensData } from '@/lib/hooks/use-lens-data';
import { type AnnotationData } from '@/components/literary/literary-shared';

export function AnnotationsPanel() {
  const annotations = useLensData<AnnotationData>('literary', 'annotation', { limit: 100, noSeed: true });
  const savedAnnotations = annotations.items;

  if (annotations.isLoading) {
    return <p className="text-sm text-zinc-500">Loading annotations…</p>;
  }

  if (savedAnnotations.length === 0) {
    return (
      <div className="rounded-lg border border-zinc-800 bg-zinc-900/50 p-6 text-center">
        <Library className="w-8 h-8 text-zinc-600 mx-auto mb-2" />
        <p className="text-sm text-zinc-400">No annotations yet.</p>
        <p className="text-xs text-zinc-500 mt-1">Search a passage and save a note — it mints a DTU citing the source.</p>
      </div>
    );
  }

  return (
    <section aria-label="Saved annotations" className="rounded-lg border border-zinc-800 bg-zinc-900/50 p-4 space-y-2">
      <h3 className="flex items-center gap-2 text-sm font-semibold text-zinc-300">
        <Library className="w-4 h-4 text-sky-300" aria-hidden="true" /> Your annotations
        <span className="text-[11px] text-zinc-500 font-normal">— {savedAnnotations.length} saved, each citing a source passage</span>
      </h3>
      <ul className="space-y-1.5">
        {savedAnnotations.slice(0, 50).map((a) => (
          <li key={a.id} className="text-xs text-zinc-300 border-b border-zinc-800/60 pb-1.5 last:border-0">
            <span className="text-zinc-200 font-medium">{a.data?.title || a.title}</span>
            {a.data?.author && <span className="text-zinc-500"> · {a.data.author}</span>}
            <p className="text-zinc-400 line-clamp-2 mt-0.5">{a.data?.note}</p>
          </li>
        ))}
      </ul>
    </section>
  );
}
