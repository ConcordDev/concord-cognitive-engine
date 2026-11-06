'use client';

/**
 * Gallery — the wall.
 *
 * One list: the signed-in user's first collection, which
 * gallery.collection-list creates as Favorites when they have none.
 * One action: Hang a work calls gallery.artwork-save, then shows the
 * title only after gallery.collection-detail contains that artwork id.
 *
 * Museum search, exhibits, virtual rooms, and sigils are other macros.
 * They are not on this screen. The server's default artist "Unknown"
 * is not rendered.
 */

import { useCallback, useEffect, useState } from 'react';
import { LensShell } from '@/components/lens/LensShell';
import { useLensCommand } from '@/hooks/useLensCommand';
import { useLensNav } from '@/hooks/useLensNav';
import { lensRun } from '@/lib/api/client';

interface Work {
  id: string;
  title: string;
  image?: string;
  artist?: string;
  dtuId?: string;
}

type Phase = 'loading' | 'ready' | 'error';

interface CollectionMeta {
  id?: string;
  artworkCount?: number;
}

interface ArtworkRow {
  id?: string;
  title?: string;
  artist?: string;
  image?: string;
  dtuId?: string;
}

function worksFrom(rows: unknown): Work[] {
  if (!Array.isArray(rows)) return [];
  const out: Work[] = [];
  for (const row of rows) {
    if (!row || typeof row !== 'object') continue;
    const id = (row as ArtworkRow).id;
    const title = (row as ArtworkRow).title;
    if (typeof id !== 'string' || !id) continue;
    if (typeof title !== 'string' || !title.trim()) continue;
    const image = (row as ArtworkRow).image;
    const artist = (row as ArtworkRow).artist;
    const dtuId = (row as ArtworkRow).dtuId;
    out.push({
      id,
      title: title.trim(),
      image: typeof image === 'string' && image.trim() ? image.trim() : undefined,
      artist: typeof artist === 'string' && artist.trim() && artist !== 'Unknown' ? artist.trim() : undefined,
      dtuId: typeof dtuId === 'string' && dtuId ? dtuId : undefined,
    });
  }
  return out;
}

async function readCollection(id: string): Promise<Work[]> {
  const detail = await lensRun<{ collection?: { artworks?: unknown } }>('gallery', 'collection-detail', { id });
  if (!detail.data?.ok) {
    throw new Error(detail.data?.error || 'Could not read the wall.');
  }
  return worksFrom(detail.data.result?.collection?.artworks);
}

export default function GalleryPage() {
  useLensNav('gallery');
  const [phase, setPhase] = useState<Phase>('loading');
  const [works, setWorks] = useState<Work[]>([]);
  const [collectionId, setCollectionId] = useState<string | null>(null);
  const [loadError, setLoadError] = useState('');
  const [actionError, setActionError] = useState('');
  const [composing, setComposing] = useState(false);
  const [title, setTitle] = useState('');
  const [imageUrl, setImageUrl] = useState('');
  const [busy, setBusy] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editTitle, setEditTitle] = useState('');
  const [confirmTakeDownId, setConfirmTakeDownId] = useState<string | null>(null);

  const pull = useCallback(async () => {
    const list = await lensRun<{ collections?: CollectionMeta[] }>('gallery', 'collection-list', {});
    if (!list.data?.ok) throw new Error(list.data?.error || 'Could not load the wall.');
    const first = (list.data.result?.collections || []).find((col) => typeof col?.id === 'string' && col.id);
    if (!first?.id) return { collectionId: null, rows: [] as Work[] };
    return { collectionId: first.id, rows: await readCollection(first.id) };
  }, []);

  useEffect(() => {
    let cancelled = false;
    pull().then(({ collectionId: colId, rows }) => {
      if (cancelled) return;
      setCollectionId(colId);
      setWorks(rows);
      setPhase('ready');
    }).catch((err) => {
      if (cancelled) return;
      setPhase('error');
      setLoadError(err instanceof Error ? err.message : 'Could not load the wall.');
    });
    return () => { cancelled = true; };
  }, [pull]);

  const load = useCallback(() => {
    setPhase('loading');
    setLoadError('');
    setActionError('');
    pull().then(({ collectionId: colId, rows }) => {
      setCollectionId(colId);
      setWorks(rows);
      setPhase('ready');
    }).catch((err) => {
      setPhase('error');
      setLoadError(err instanceof Error ? err.message : 'Could not load the wall.');
    });
  }, [pull]);

  const hang = useCallback(async () => {
    if (busy || phase !== 'ready') return;
    if (!composing) {
      setComposing(true);
      setActionError('');
      return;
    }
    const trimmed = title.trim();
    if (!trimmed) {
      setActionError('A title is required.');
      return;
    }
    setBusy(true);
    setActionError('');
    try {
      const saved = await lensRun<{ artwork?: { id?: string }; collectionId?: string }>(
        'gallery',
        'artwork-save',
        { title: trimmed, image: imageUrl.trim() || undefined },
      );
      const artId = saved.data?.result?.artwork?.id;
      const savedCollectionId = saved.data?.result?.collectionId;
      if (!saved.data?.ok || !artId || !savedCollectionId) {
        throw new Error(saved.data?.error || 'Could not hang that work.');
      }
      const rows = await readCollection(savedCollectionId);
      if (!rows.some((row) => row.id === artId)) {
        throw new Error('Hung, but the wall did not read it back.');
      }
      setCollectionId(savedCollectionId);
      setWorks(rows);
      setTitle('');
      setImageUrl('');
      setComposing(false);
    } catch (err) {
      setActionError(err instanceof Error ? err.message : 'Could not hang that work.');
    } finally {
      setBusy(false);
    }
  }, [busy, composing, imageUrl, phase, title]);

  const startEdit = useCallback((work: Work) => {
    setActionError('');
    setConfirmTakeDownId(null);
    setEditingId(work.id);
    setEditTitle(work.title);
  }, []);

  const cancelEdit = useCallback(() => {
    setEditingId(null);
    setEditTitle('');
  }, []);

  const saveEdit = useCallback(async () => {
    if (!editingId || !collectionId || busy) return;
    const trimmed = editTitle.trim();
    if (!trimmed) {
      setActionError('A title is required.');
      return;
    }
    setBusy(true);
    setActionError('');
    try {
      const updated = await lensRun<{ artwork?: { id?: string } }>('gallery', 'artwork-update', {
        collectionId, artworkId: editingId, title: trimmed,
      });
      if (!updated.data?.ok) {
        throw new Error(updated.data?.error || 'Could not rename that work.');
      }
      const rows = await readCollection(collectionId);
      setWorks(rows);
      setEditingId(null);
      setEditTitle('');
    } catch (err) {
      setActionError(err instanceof Error ? err.message : 'Could not rename that work.');
    } finally {
      setBusy(false);
    }
  }, [busy, collectionId, editTitle, editingId]);

  const takeDown = useCallback(async (workId: string) => {
    if (!collectionId || busy) return;
    setBusy(true);
    setActionError('');
    try {
      const removed = await lensRun('gallery', 'artwork-remove', { collectionId, artworkId: workId });
      if (!removed.data?.ok) {
        throw new Error(removed.data?.error || 'Could not take that work down.');
      }
      const rows = await readCollection(collectionId);
      setWorks(rows);
      setConfirmTakeDownId(null);
      if (editingId === workId) { setEditingId(null); setEditTitle(''); }
    } catch (err) {
      setActionError(err instanceof Error ? err.message : 'Could not take that work down.');
    } finally {
      setBusy(false);
    }
  }, [busy, collectionId, editingId]);

  useLensCommand(
    [{ id: 'gallery-hang', keys: 'h', description: 'Hang a work', category: 'actions', action: () => { void hang(); } }],
    { lensId: 'gallery' },
  );

  return (
    <LensShell lensId="gallery" asMain={false}>
      <div data-lens-theme="gallery" className="relative min-h-full bg-black px-8 pb-28 pt-6">
        <h1 className="mb-5 mt-1 font-vault text-[2.25rem] leading-tight text-zinc-100 sm:text-5xl">Gallery</h1>

        {/* Substrate tier declaration (F1): the wall is a real, persistent,
            per-account store (works survive reload and round trips to other
            lenses) — not a static demo or simulated content. This lens was
            the shell census's only no-banner instance; this is a lens-local
            disclosure, the same disposition as every bannered sibling. */}
        <div data-testid="gallery-tier" className="mb-5 flex items-center gap-2 rounded-2xl border border-teal-700/30 bg-teal-950/20 px-4 py-2.5 text-sm text-teal-100">
          <span className="rounded-full border border-teal-600/50 bg-teal-500/10 px-2 py-0.5 text-xs font-semibold uppercase tracking-wide text-teal-300">
            Live
          </span>
          <p>Real account state: works you hang here are persisted and survive reload, not demo data.</p>
        </div>

        <section
          aria-label="Wall"
          className="flex min-h-[22rem] flex-col justify-center rounded-2xl border border-white/10 bg-zinc-950 px-6 py-16"
        >
          {phase === 'loading' && (
            <p data-testid="gallery-loading" role="status" aria-busy="true" className="text-[14px] text-zinc-500">
              Opening the wall.
            </p>
          )}
          {phase === 'error' && (
            <div data-testid="gallery-error" role="alert" className="text-center">
              <p className="text-[14px] text-zinc-300">{loadError || 'Could not load the wall.'}</p>
              <button type="button" onClick={() => { void load(); }} className="mt-4 text-[14px] text-zinc-100 underline">
                Retry
              </button>
            </div>
          )}
          {phase === 'ready' && works.length === 0 && !composing && (
            <div data-testid="gallery-empty">
              <p className="text-[14px] text-zinc-500">The wall is empty.</p>
              <div className="mt-6 h-px w-2/3 bg-white/10" aria-hidden="true" />
              <div className="mt-3 h-px w-1/2 bg-white/10" aria-hidden="true" />
            </div>
          )}
          {phase === 'ready' && works.length > 0 && (
            <ul data-testid="gallery-works" className="space-y-8">
              {works.map((work) => (
                <li key={work.id} className="group">
                  {editingId === work.id ? (
                    <div className="flex flex-wrap items-center gap-3">
                      <input
                        data-testid={`gallery-edit-title-${work.id}`}
                        value={editTitle}
                        onChange={(event) => setEditTitle(event.target.value)}
                        onKeyDown={(event) => {
                          if (event.key === 'Enter') { event.preventDefault(); void saveEdit(); }
                          if (event.key === 'Escape') { event.preventDefault(); cancelEdit(); }
                        }}
                        className="border-b border-white/15 bg-transparent pb-1 text-[1.25rem] text-zinc-100 outline-none"
                        autoFocus
                      />
                      <button type="button" onClick={() => { void saveEdit(); }} disabled={busy} className="text-[12px] text-teal-300 underline disabled:opacity-50">
                        Save
                      </button>
                      <button type="button" onClick={cancelEdit} className="text-[12px] text-zinc-500 underline">
                        Cancel
                      </button>
                    </div>
                  ) : (
                    <>
                      {work.image ? (
                        // eslint-disable-next-line @next/next/no-img-element -- arbitrary user/museum-supplied URLs, not a local asset.
                        <img
                          src={work.image}
                          alt={work.title}
                          className="mb-3 max-h-80 w-auto max-w-full rounded-lg border border-white/10 object-contain"
                        />
                      ) : null}
                      <div className="flex flex-wrap items-baseline gap-3">
                        <h2 className="font-vault text-[1.5rem] text-zinc-100">{work.title}</h2>
                        {work.artist ? <span className="text-[13px] text-zinc-500">{work.artist}</span> : null}
                      </div>
                      <div className="mt-2 flex gap-3 opacity-0 transition-opacity group-hover:opacity-100 focus-within:opacity-100">
                        <button type="button" onClick={() => startEdit(work)} className="text-[12px] text-zinc-400 underline">
                          Rename
                        </button>
                        {confirmTakeDownId === work.id ? (
                          <>
                            <button type="button" onClick={() => { void takeDown(work.id); }} disabled={busy} className="text-[12px] font-medium text-rose-400 underline disabled:opacity-50">
                              Confirm take down
                            </button>
                            <button type="button" onClick={() => setConfirmTakeDownId(null)} className="text-[12px] text-zinc-500 underline">
                              Cancel
                            </button>
                          </>
                        ) : (
                          <button type="button" onClick={() => setConfirmTakeDownId(work.id)} disabled={busy} className="text-[12px] text-zinc-500 underline disabled:opacity-50">
                            Take down
                          </button>
                        )}
                      </div>
                    </>
                  )}
                </li>
              ))}
            </ul>
          )}
          {phase === 'ready' && composing && (
            <div className="mt-6 space-y-4">
              <label className="block text-[14px] text-zinc-400">
                Title
                <input
                  data-testid="gallery-title"
                  value={title}
                  onChange={(event) => setTitle(event.target.value)}
                  onKeyDown={(event) => {
                    if (event.key === 'Enter') { event.preventDefault(); void hang(); }
                  }}
                  className="mt-2 w-full border-b border-white/15 bg-transparent pb-2 text-[16px] text-zinc-100 outline-none"
                  autoFocus
                />
              </label>
              <label className="block text-[14px] text-zinc-400">
                Image URL (optional)
                <input
                  data-testid="gallery-image-url"
                  value={imageUrl}
                  onChange={(event) => setImageUrl(event.target.value)}
                  onKeyDown={(event) => {
                    if (event.key === 'Enter') { event.preventDefault(); void hang(); }
                  }}
                  placeholder="https://..."
                  className="mt-2 w-full border-b border-white/15 bg-transparent pb-2 text-[14px] text-zinc-100 outline-none"
                />
              </label>
            </div>
          )}
          {actionError ? (
            <p role="alert" className="mt-4 text-[14px] text-zinc-300">{actionError}</p>
          ) : null}
        </section>

        <button
          type="button"
          onClick={() => { void hang(); }}
          disabled={phase !== 'ready' || busy}
          className="fixed bottom-8 right-8 z-30 rounded-full bg-teal-400 px-6 py-3.5 text-[15px] font-medium text-black shadow-[0_8px_32px_rgba(45,212,191,0.25)] transition-colors hover:bg-teal-300 disabled:opacity-60"
        >
          Hang a work
        </button>
      </div>
    </LensShell>
  );
}
