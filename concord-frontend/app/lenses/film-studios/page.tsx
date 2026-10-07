'use client';

/**
 * Film Studios — one production.
 *
 * The left pane is project-list. + New production calls project-create,
 * then shows the title only after project-list contains that id and the
 * same title. Opening a production calls scene-list. Add scene calls
 * scene-add, then shows the slugline only after scene-list contains that
 * id and the same location. Choosing the scene reads scene-list again.
 * A blank title is not sent. A blank location is not sent. Titles and
 * scenes are stored in film_studio_productions and film_studio_scenes,
 * so a server restart still lists them. The desk tabs are other macros.
 * They are not on this screen.
 */

import { useCallback, useEffect, useState } from 'react';
import { LensShell } from '@/components/lens/LensShell';
import { useLensCommand } from '@/hooks/useLensCommand';
import { useLensNav } from '@/hooks/useLensNav';
import { useAuth } from '@/hooks/useAuth';
import { titleCaseDisplayName } from '@/components/chat/claudeCleanGreeting';
import { lensRun } from '@/lib/api/client';

interface ProductionRow {
  id: string;
  title: string;
}

interface SceneRow {
  id: string;
  location: string;
  slugline: string;
}

type Phase = 'loading' | 'ready' | 'error';

function productionsFrom(rows: unknown): ProductionRow[] {
  if (!Array.isArray(rows)) return [];
  const out: ProductionRow[] = [];
  for (const row of rows) {
    if (!row || typeof row !== 'object') continue;
    const id = (row as { id?: string }).id;
    const title = (row as { title?: string }).title;
    if (typeof id !== 'string' || !id) continue;
    if (typeof title !== 'string' || !title.trim()) continue;
    out.push({ id, title: title.trim() });
  }
  return out;
}

function scenesFrom(rows: unknown): SceneRow[] {
  if (!Array.isArray(rows)) return [];
  const out: SceneRow[] = [];
  for (const row of rows) {
    if (!row || typeof row !== 'object') continue;
    const id = (row as { id?: string }).id;
    const location = (row as { location?: string }).location;
    const slugline = (row as { slugline?: string }).slugline;
    if (typeof id !== 'string' || !id) continue;
    if (typeof location !== 'string' || !location.trim()) continue;
    if (typeof slugline !== 'string' || !slugline.trim()) continue;
    out.push({ id, location: location.trim(), slugline: slugline.trim() });
  }
  return out;
}

async function readProductions(): Promise<ProductionRow[]> {
  const list = await lensRun<{ projects?: unknown }>('film-studios', 'project-list', {});
  if (!list.data?.ok) throw new Error(list.data?.error || 'Could not read the production.');
  return productionsFrom(list.data.result?.projects);
}

async function readScenes(projectId: string): Promise<SceneRow[]> {
  const list = await lensRun<{ scenes?: unknown }>('film-studios', 'scene-list', { projectId });
  if (!list.data?.ok) throw new Error(list.data?.error || 'Could not read the scene.');
  return scenesFrom(list.data.result?.scenes);
}

export default function FilmStudiosPage() {
  useLensNav('film-studios');
  const { user } = useAuth();
  const who = titleCaseDisplayName(user?.username);
  const [phase, setPhase] = useState<Phase>('loading');
  const [productions, setProductions] = useState<ProductionRow[]>([]);
  const [openId, setOpenId] = useState<string | null>(null);
  const [scenes, setScenes] = useState<SceneRow[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [loadError, setLoadError] = useState('');
  const [actionError, setActionError] = useState('');
  const [composing, setComposing] = useState(false);
  const [composingScene, setComposingScene] = useState(false);
  const [title, setTitle] = useState('');
  const [location, setLocation] = useState('');
  const [busy, setBusy] = useState(false);

  const pull = useCallback(async () => readProductions(), []);

  useEffect(() => {
    let cancelled = false;
    pull().then((rows) => {
      if (cancelled) return;
      setProductions(rows);
      setPhase('ready');
    }).catch((err) => {
      if (cancelled) return;
      setPhase('error');
      setLoadError(err instanceof Error ? err.message : 'Could not load the production.');
    });
    return () => { cancelled = true; };
  }, [pull]);

  const load = useCallback(() => {
    setPhase('loading');
    setLoadError('');
    setActionError('');
    setOpenId(null);
    setScenes([]);
    setSelectedId(null);
    pull().then((rows) => {
      setProductions(rows);
      setPhase('ready');
    }).catch((err) => {
      setPhase('error');
      setLoadError(err instanceof Error ? err.message : 'Could not load the production.');
    });
  }, [pull]);

  const openProduction = useCallback(async (id: string) => {
    if (busy || phase !== 'ready') return;
    setBusy(true);
    setActionError('');
    try {
      const rows = await readProductions();
      const row = rows.find((item) => item.id === id);
      if (!row) throw new Error('That production is not on the board.');
      const nextScenes = await readScenes(id);
      setProductions(rows);
      setOpenId(row.id);
      setScenes(nextScenes);
      setSelectedId(null);
      setComposingScene(false);
      setLocation('');
    } catch (err) {
      setActionError(err instanceof Error ? err.message : 'Could not open that production.');
    } finally {
      setBusy(false);
    }
  }, [busy, phase]);

  const openNew = useCallback(async () => {
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
      const created = await lensRun<{ project?: { id?: string; title?: string } }>(
        'film-studios',
        'project-create',
        { title: trimmed },
      );
      const id = created.data?.result?.project?.id;
      if (!created.data?.ok || !id) {
        throw new Error(created.data?.error || 'Could not open that production.');
      }
      const rows = await readProductions();
      const row = rows.find((item) => item.id === id);
      if (!row || row.title !== trimmed) {
        throw new Error('Opened, but the production did not read it back.');
      }
      const nextScenes = await readScenes(id);
      setProductions(rows);
      setOpenId(id);
      setScenes(nextScenes);
      setSelectedId(null);
      setTitle('');
      setComposing(false);
      setComposingScene(false);
      setLocation('');
    } catch (err) {
      setActionError(err instanceof Error ? err.message : 'Could not open that production.');
    } finally {
      setBusy(false);
    }
  }, [busy, composing, phase, title]);

  const addScene = useCallback(async () => {
    if (busy || phase !== 'ready' || !openId) return;
    if (!composingScene) {
      setComposingScene(true);
      setActionError('');
      return;
    }
    const trimmed = location.trim();
    if (!trimmed) {
      setActionError('A location is required.');
      return;
    }
    setBusy(true);
    setActionError('');
    try {
      const created = await lensRun<{ scene?: { id?: string; location?: string } }>(
        'film-studios',
        'scene-add',
        { projectId: openId, location: trimmed },
      );
      const id = created.data?.result?.scene?.id;
      if (!created.data?.ok || !id) {
        throw new Error(created.data?.error || 'Could not add that scene.');
      }
      const rows = await readScenes(openId);
      const row = rows.find((item) => item.id === id);
      if (!row || row.location !== trimmed) {
        throw new Error('Added, but the scene did not read it back.');
      }
      setScenes(rows);
      setSelectedId(row.id);
      setLocation('');
      setComposingScene(false);
    } catch (err) {
      setActionError(err instanceof Error ? err.message : 'Could not add that scene.');
    } finally {
      setBusy(false);
    }
  }, [busy, composingScene, location, openId, phase]);

  const chooseScene = useCallback(async (id: string) => {
    if (busy || phase !== 'ready' || !openId) return;
    setBusy(true);
    setActionError('');
    try {
      const rows = await readScenes(openId);
      const row = rows.find((item) => item.id === id);
      if (!row) throw new Error('That scene is not on the board.');
      setScenes(rows);
      setSelectedId(row.id);
    } catch (err) {
      setActionError(err instanceof Error ? err.message : 'Could not read that scene.');
    } finally {
      setBusy(false);
    }
  }, [busy, openId, phase]);

  useLensCommand(
    [{ id: 'film-studios-new', keys: 'n', description: '+ New production', category: 'actions', action: () => { void openNew(); } }],
    { lensId: 'film-studios' },
  );

  const selected = scenes.find((scene) => scene.id === selectedId) || null;

  return (
    <LensShell lensId="film-studios" asMain={false}>
      <div data-lens-theme="film-studios" className="relative min-h-full bg-black px-8 pb-28 pt-6">
        <p className="text-[14px] text-zinc-500">Film Studios</p>
        <h1 className="mb-5 mt-1 font-vault text-[2.25rem] leading-tight text-zinc-100 sm:text-5xl">
          The production{who ? `, ${who}` : ''}
        </h1>

        <section
          aria-label="Production"
          className="grid min-h-[22rem] overflow-hidden rounded-2xl border border-white/10 bg-zinc-950 sm:grid-cols-2"
        >
          {phase === 'loading' && (
            <p data-testid="film-loading" role="status" aria-busy="true" className="col-span-full px-6 py-5 text-[14px] text-zinc-500">
              Opening the production.
            </p>
          )}
          {phase === 'error' && (
            <div data-testid="film-error" role="alert" className="col-span-full px-6 py-5">
              <p className="text-[14px] text-zinc-300">{loadError || 'Could not load the production.'}</p>
              <button type="button" onClick={load} className="mt-4 text-[14px] text-zinc-100 underline">
                Retry
              </button>
            </div>
          )}
          {phase === 'ready' && (
            <>
              <div className="min-h-[22rem] border-b border-white/10 px-6 py-5 sm:border-b-0 sm:border-r">
                {productions.length === 0 && !composing ? (
                  <p data-testid="film-empty" className="text-[14px] text-zinc-500">No production open.</p>
                ) : null}
                {productions.length > 0 && (
                  <ul data-testid="film-productions" className="space-y-2">
                    {productions.map((item) => (
                      <li key={item.id}>
                        <button
                          type="button"
                          aria-pressed={openId === item.id}
                          onClick={() => { void openProduction(item.id); }}
                          disabled={busy}
                          className={openId === item.id
                            ? 'text-left font-vault text-[1.5rem] leading-8 text-zinc-100'
                            : 'text-left font-vault text-[1.5rem] leading-8 text-zinc-400'}
                        >
                          {item.title}
                        </button>
                      </li>
                    ))}
                  </ul>
                )}
                {composing && (
                  <label className="mt-4 block text-[14px] text-zinc-400">
                    Title
                    <input
                      data-testid="film-title"
                      value={title}
                      onChange={(event) => setTitle(event.target.value)}
                      onKeyDown={(event) => {
                        if (event.key === 'Enter') { event.preventDefault(); void openNew(); }
                      }}
                      className="mt-1 w-full border-b border-white/15 bg-transparent pb-2 font-vault text-[1.25rem] text-zinc-100 outline-none"
                      autoFocus
                    />
                  </label>
                )}
              </div>
              <div className="min-h-[22rem] px-6 py-5">
                {!selected && !composingScene ? (
                  <p data-testid="film-unselected" className="text-[14px] text-zinc-500">Nothing selected.</p>
                ) : null}
                {selected ? (
                  <h2 className="font-vault text-[1.5rem] leading-8 text-zinc-100">{selected.slugline}</h2>
                ) : null}
                {openId && scenes.length > 0 && (
                  <ul data-testid="film-scenes" className="mt-4 space-y-2">
                    {scenes.map((scene) => (
                      <li key={scene.id}>
                        <button
                          type="button"
                          aria-pressed={selectedId === scene.id}
                          onClick={() => { void chooseScene(scene.id); }}
                          disabled={busy}
                          className={selectedId === scene.id
                            ? 'text-left text-[14px] text-zinc-100'
                            : 'text-left text-[14px] text-zinc-400'}
                        >
                          {scene.slugline}
                        </button>
                      </li>
                    ))}
                  </ul>
                )}
                {openId && composingScene && (
                  <label className="mt-4 block text-[14px] text-zinc-400">
                    Location
                    <input
                      data-testid="film-location"
                      value={location}
                      onChange={(event) => setLocation(event.target.value)}
                      onKeyDown={(event) => {
                        if (event.key === 'Enter') { event.preventDefault(); void addScene(); }
                      }}
                      className="mt-1 w-full border-b border-white/15 bg-transparent pb-2 text-[1rem] text-zinc-100 outline-none"
                      autoFocus
                    />
                  </label>
                )}
                {openId && (
                  <button
                    type="button"
                    onClick={() => { void addScene(); }}
                    disabled={busy}
                    className="mt-6 text-[14px] text-teal-300 disabled:opacity-60"
                  >
                    Add scene
                  </button>
                )}
              </div>
            </>
          )}
        </section>

        {actionError ? (
          <p role="alert" className="mt-4 text-[14px] text-zinc-300">{actionError}</p>
        ) : null}

        <button
          type="button"
          onClick={() => { void openNew(); }}
          disabled={phase !== 'ready' || busy}
          className="fixed bottom-8 right-8 z-30 rounded-full bg-teal-400 px-6 py-3.5 text-[15px] font-medium text-black shadow-[0_8px_32px_rgba(45,212,191,0.25)] transition-colors hover:bg-teal-300 disabled:opacity-60"
        >
          + New production
        </button>
      </div>
    </LensShell>
  );
}
