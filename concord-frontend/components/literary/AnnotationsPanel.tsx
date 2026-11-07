'use client';

/**
 * AnnotationsPanel — durable literary annotation library.
 * Extracted from literary/page.tsx consolidation.
 */

import { useState } from 'react';
import { Library, Trash2 } from 'lucide-react';
import { useLensData } from '@/lib/hooks/use-lens-data';
import { type AnnotationData } from '@/components/literary/literary-shared';

export function AnnotationsPanel() {
  const annotations = useLensData<AnnotationData>('literary', 'annotation', { limit: 100, noSeed: true });
  const savedAnnotations = annotations.items;
  // Two-step delete: the lens's own records need an exit path — the first
  // click arms the confirm (naming the note), the second removes it.
  const [confirmId, setConfirmId] = useState<string | null>(null);
  const [deleteError, setDeleteError] = useState<string | null>(null);

  const removeAnnotation = async (id: string) => {
    setDeleteError(null);
    try {
      await annotations.remove(id);
      setConfirmId(null);
    } catch {
      setDeleteError('Could not delete that note — try again.');
      setConfirmId(null);
    }
  };

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
      {deleteError && (
        <p className="text-xs text-rose-300" role="alert">{deleteError}</p>
      )}
      <ul className="space-y-1.5">
        {savedAnnotations.slice(0, 50).map((a) => {
          const label = a.data?.title || a.title || 'this note';
          return (
            <li key={a.id} className="text-xs text-zinc-300 border-b border-zinc-800/60 pb-1.5 last:border-0">
              <div className="flex items-start justify-between gap-2">
                <div className="min-w-0">
                  <span className="text-zinc-200 font-medium">{a.data?.title || a.title}</span>
                  {a.data?.author && <span className="text-zinc-500"> · {a.data.author}</span>}
                  <p className="text-zinc-400 line-clamp-2 mt-0.5">{a.data?.note}</p>
                </div>
                {confirmId === a.id ? (
                  <span className="flex items-center gap-2 flex-shrink-0" data-testid="annotation-delete-confirm">
                    <span className="text-zinc-400">Delete “{label}”?</span>
                    <button
                      type="button"
                      data-testid="annotation-delete-confirm-btn"
                      onClick={() => void removeAnnotation(a.id)}
                      className="px-2 py-0.5 rounded bg-rose-700 hover:bg-rose-600 text-white text-[11px] font-medium"
                    >
                      Delete
                    </button>
                    <button
                      type="button"
                      onClick={() => setConfirmId(null)}
                      className="px-2 py-0.5 rounded bg-zinc-800 hover:bg-zinc-700 text-zinc-200 text-[11px]"
                    >
                      Keep
                    </button>
                  </span>
                ) : (
                  <button
                    type="button"
                    data-testid="annotation-delete"
                    onClick={() => setConfirmId(a.id)}
                    aria-label={`Delete annotation ${label}`}
                    className="flex-shrink-0 inline-flex items-center gap-1 px-2 py-0.5 rounded bg-zinc-800/70 hover:bg-zinc-700 text-zinc-300 text-[11px]"
                  >
                    <Trash2 className="w-3 h-3" aria-hidden="true" /> Delete
                  </button>
                )}
              </div>
            </li>
          );
        })}
      </ul>
    </section>
  );
}
