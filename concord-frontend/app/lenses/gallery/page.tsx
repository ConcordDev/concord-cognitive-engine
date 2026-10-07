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
import { useAuth } from '@/hooks/useAuth';
import { titleCaseDisplayName } from '@/components/chat/claudeCleanGreeting';
import { lensRun } from '@/lib/api/client';

interface Work {
  id: string;
  title: string;
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
    out.push({ id, title: title.trim() });
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
  const { user } = useAuth();
  const who = titleCaseDisplayName(user?.username);
  const [phase, setPhase] = useState<Phase>('loading');
  const [works, setWorks] = useState<Work[]>([]);
  const [loadError, setLoadError] = useState('');
  const [actionError, setActionError] = useState('');
  const [composing, setComposing] = useState(false);
  const [title, setTitle] = useState('');
  const [busy, setBusy] = useState(false);

  const pull = useCallback(async () => {
    const list = await lensRun<{ collections?: CollectionMeta[] }>('gallery', 'collection-list', {});
    if (!list.data?.ok) throw new Error(list.data?.error || 'Could not load the wall.');
    const first = (list.data.result?.collections || []).find((col) => typeof col?.id === 'string' && col.id);
    return first?.id ? readCollection(first.id) : [];
  }, []);

  useEffect(() => {
    let cancelled = false;
    pull().then((rows) => {
      if (cancelled) return;
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
    pull().then((rows) => {
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
        { title: trimmed },
      );
      const artId = saved.data?.result?.artwork?.id;
      const collectionId = saved.data?.result?.collectionId;
      if (!saved.data?.ok || !artId || !collectionId) {
        throw new Error(saved.data?.error || 'Could not hang that work.');
      }
      const rows = await readCollection(collectionId);
      if (!rows.some((row) => row.id === artId)) {
        throw new Error('Hung, but the wall did not read it back.');
      }
      setWorks(rows);
      setTitle('');
      setComposing(false);
    } catch (err) {
      setActionError(err instanceof Error ? err.message : 'Could not hang that work.');
    } finally {
      setBusy(false);
    }
  }, [busy, composing, phase, title]);

  useLensCommand(
    [{ id: 'gallery-hang', keys: 'h', description: 'Hang a work', category: 'actions', action: () => { void hang(); } }],
    { lensId: 'gallery' },
  );

  return (
    <LensShell lensId="gallery" asMain={false}>
      <div data-lens-theme="gallery" className="relative min-h-full bg-black px-8 pb-28 pt-6">
        <p className="text-[14px] text-zinc-500">Gallery</p>
        <h1 className="mb-5 mt-1 font-vault text-[2.25rem] leading-tight text-zinc-100 sm:text-5xl">
          The wall{who ? `, ${who}` : ''}
        </h1>

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
            <ul data-testid="gallery-works" className="space-y-6">
              {works.map((work) => (
                <li key={work.id}>
                  <h2 className="font-vault text-[1.5rem] text-zinc-100">{work.title}</h2>
                </li>
              ))}
            </ul>
          )}
          {phase === 'ready' && composing && (
            <label className="mt-6 block text-[14px] text-zinc-400">
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
