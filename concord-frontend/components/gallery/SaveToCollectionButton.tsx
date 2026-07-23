'use client';

/**
 * SaveToCollectionButton — the missing link in the gallery's "favorites"
 * loop. `SavedCollections` lets a user create named collections and says
 * "save pieces from the museum browser above", but before this component
 * existed no surface in the lens ever called the `gallery.artwork-save`
 * macro — collections could be created and deleted, but never populated.
 * This is the single reusable affordance for "save this artwork into one
 * of my collections", wired into every artwork-result surface in the
 * lens (CMA browser, search workbench, visual search, artist pages,
 * recommendations).
 */

import { useCallback, useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { FolderHeart, FolderCheck, Loader2, Plus, X, AlertTriangle } from 'lucide-react';
import { lensRun } from '@/lib/api/client';

export interface SaveableArtwork {
  refId?: string;
  title: string;
  artist?: string;
  date?: string | null;
  image?: string | null;
  museum?: string | null;
}

interface CollectionMeta { id: string; name: string; artworkCount: number }

export function SaveToCollectionButton({
  artwork,
  compact = true,
  className = '',
}: {
  artwork: SaveableArtwork;
  compact?: boolean;
  className?: string;
}) {
  const [open, setOpen] = useState(false);
  const [collections, setCollections] = useState<CollectionMeta[] | null>(null);
  const [loading, setLoading] = useState(false);
  const [saved, setSaved] = useState(false);
  const [newName, setNewName] = useState('');
  const [busyId, setBusyId] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const dialogRef = useRef<HTMLDivElement>(null);

  // Real modal a11y: Escape closes it, and focus moves into the dialog
  // on open so keyboard/screen-reader users land somewhere sensible
  // instead of on whatever was focused behind it.
  useEffect(() => {
    if (!open) return;
    dialogRef.current?.focus();
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setOpen(false);
    };
    document.addEventListener('keydown', onKeyDown);
    return () => document.removeEventListener('keydown', onKeyDown);
  }, [open]);

  const openPicker = useCallback(async (e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setOpen(true);
    setErr(null);
    setLoading(true);
    const r = await lensRun<{ collections: CollectionMeta[] }>('gallery', 'collection-list', {});
    setCollections((r.data?.ok && r.data.result?.collections) || []);
    setLoading(false);
  }, []);

  const saveTo = useCallback(async (collectionId: string) => {
    if (!artwork.title?.trim()) { setErr('This artwork has no title to save.'); return; }
    setBusyId(collectionId);
    setErr(null);
    const r = await lensRun('gallery', 'artwork-save', {
      collectionId,
      title: artwork.title,
      artist: artwork.artist || undefined,
      date: artwork.date || undefined,
      image: artwork.image || undefined,
      museum: artwork.museum || undefined,
      refId: artwork.refId || undefined,
    });
    if (r.data?.ok) {
      setSaved(true);
      setOpen(false);
    } else if (String(r.data?.error || '').includes('already in this collection')) {
      // Honest success path: the artwork is genuinely already saved there.
      setSaved(true);
      setOpen(false);
    } else {
      setErr(r.data?.error || 'Could not save artwork.');
    }
    setBusyId(null);
  }, [artwork]);

  const createAndSave = useCallback(async () => {
    if (!newName.trim()) return;
    setBusyId('__new__');
    setErr(null);
    const r = await lensRun<{ collection: CollectionMeta }>('gallery', 'collection-create', { name: newName.trim() });
    if (r.data?.ok && r.data.result?.collection) {
      const col = r.data.result.collection;
      setCollections((prev) => [...(prev || []), col]);
      setNewName('');
      await saveTo(col.id);
    } else {
      setErr(r.data?.error || 'Could not create collection.');
      setBusyId(null);
    }
  }, [newName, saveTo]);

  return (
    <>
      <button
        type="button"
        onClick={saved ? (e) => { e.preventDefault(); e.stopPropagation(); } : openPicker}
        title={saved ? 'Saved to a collection' : 'Save to collection'}
        aria-label={saved ? 'Saved to a collection' : 'Save to collection'}
        className={
          compact
            ? `inline-flex items-center justify-center rounded-md p-1.5 transition-colors ${
                saved ? 'text-rose-400 bg-rose-500/10' : 'text-zinc-400 hover:text-rose-300 hover:bg-rose-500/10'
              } ${className}`
            : `inline-flex items-center gap-1.5 rounded-md border px-2.5 py-1.5 text-xs font-medium transition-colors ${
                saved
                  ? 'border-rose-500/30 bg-rose-500/10 text-rose-300'
                  : 'border-rose-500/20 bg-rose-500/5 text-rose-300/90 hover:bg-rose-500/15 hover:border-rose-500/40'
              } ${className}`
        }
      >
        {saved ? <FolderCheck className="h-3.5 w-3.5" /> : <FolderHeart className="h-3.5 w-3.5" />}
        {!compact && <span>{saved ? 'Saved' : 'Save to collection'}</span>}
      </button>

      {open && typeof document !== 'undefined' && createPortal(
        <div
          className="fixed inset-0 z-[200] flex items-center justify-center bg-black/60 p-4"
          onClick={(e) => { if (e.target === e.currentTarget) setOpen(false); }}
          onKeyDown={(e) => { if (e.key === 'Escape') setOpen(false); }}
          role="presentation"
        >
          <div
            ref={dialogRef}
            tabIndex={-1}
            className="w-full max-w-sm rounded-xl border border-rose-500/30 bg-zinc-950 p-4 shadow-xl outline-none"
            role="dialog"
            aria-modal="true"
            aria-label="Save to collection"
          >
            <div className="mb-3 flex items-center justify-between">
              <h4 className="flex items-center gap-1.5 text-sm font-bold text-zinc-100">
                <FolderHeart className="h-4 w-4 text-rose-400" /> Save to collection
              </h4>
              <button type="button" onClick={() => setOpen(false)} className="text-zinc-500 hover:text-zinc-300" aria-label="Close">
                <X className="h-4 w-4" />
              </button>
            </div>
            <p className="mb-2 truncate text-[11px] text-zinc-400">
              {artwork.title}{artwork.artist ? ` — ${artwork.artist}` : ''}
            </p>

            {err && (
              <div className="mb-2 flex items-start gap-1.5 rounded border border-red-500/30 bg-red-500/10 px-2 py-1.5 text-[11px] text-red-300">
                <AlertTriangle className="mt-0.5 h-3 w-3 shrink-0" /><span>{err}</span>
              </div>
            )}

            {loading ? (
              <div className="flex justify-center py-4"><Loader2 className="h-4 w-4 animate-spin text-zinc-400" /></div>
            ) : (
              <ul className="mb-3 max-h-48 space-y-1 overflow-y-auto">
                {(collections || []).map((c) => (
                  <li key={c.id}>
                    <button
                      type="button" disabled={busyId !== null} onClick={() => saveTo(c.id)}
                      className="flex w-full items-center justify-between rounded-lg border border-zinc-800 bg-zinc-900/50 px-3 py-2 text-left hover:border-rose-400/50 disabled:opacity-50"
                    >
                      <span className="text-xs text-zinc-100">{c.name}</span>
                      <span className="flex items-center gap-1 text-[10px] text-zinc-500">
                        {busyId === c.id ? <Loader2 className="h-3 w-3 animate-spin" /> : c.artworkCount}
                      </span>
                    </button>
                  </li>
                ))}
                {(collections || []).length === 0 && (
                  <li className="py-2 text-[11px] italic text-zinc-500">No collections yet — create one below.</li>
                )}
              </ul>
            )}

            <div className="flex items-center gap-1.5">
              <input
                type="text" value={newName} onChange={(e) => setNewName(e.target.value)}
                onKeyDown={(e) => { if (e.key === 'Enter') createAndSave(); }}
                placeholder="New collection name…"
                className="flex-1 rounded border border-zinc-800 bg-zinc-900 px-2 py-1.5 text-xs text-zinc-200"
              />
              <button
                type="button" onClick={createAndSave} disabled={!newName.trim() || busyId !== null}
                className="inline-flex items-center gap-1 rounded bg-rose-600 px-2.5 py-1.5 text-xs font-semibold text-white hover:bg-rose-500 disabled:opacity-40"
              >
                {busyId === '__new__' ? <Loader2 className="h-3 w-3 animate-spin" /> : <Plus className="h-3 w-3" />}
              </button>
            </div>
          </div>
        </div>,
        document.body,
      )}
    </>
  );
}
