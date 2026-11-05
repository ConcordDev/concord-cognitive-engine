'use client';

/**
 * Film Studios — one production.
 *
 * The left pane is project-list. + New production calls project-create,
 * then shows the title only after project-list contains that id and the
 * same title. Opening a production calls scene-list. Add scene calls
 * scene-add with structured fields (INT./EXT. + location + DAY/NIGHT),
 * then shows the slugline only after scene-list contains that id and the
 * same location. Choosing the scene reads scene-list again and shows its
 * real fields, not only its slugline (the slugline is DERIVED from those
 * fields server-side -- it is never the thing being edited).
 *
 * Rename calls project-update / scene-update. Delete is a two-step arm
 * + confirm on the row (matching the crafting lens's pattern) and calls
 * project-delete / scene-delete. A blank title is not sent. A blank
 * location is not sent. Titles and scenes are stored in
 * film_studio_productions and film_studio_scenes, so a server restart
 * still lists them -- and still renames/deletes them. The desk tabs are
 * other macros. They are not on this screen.
 */

import { useCallback, useEffect, useState } from 'react';
import { LensShell } from '@/components/lens/LensShell';
import { DTUExportButton } from '@/components/lens/DTUExportButton';
import { useLensCommand } from '@/hooks/useLensCommand';
import { useLensNav } from '@/hooks/useLensNav';
import { lensRun } from '@/lib/api/client';

const INT_EXT_OPTIONS = ['INT', 'EXT', 'INT/EXT'] as const;
const TIME_OF_DAY_OPTIONS = ['DAY', 'NIGHT', 'DUSK', 'DAWN', 'MORNING', 'EVENING', 'CONTINUOUS'] as const;

interface ProductionRow {
  id: string;
  title: string;
  format?: string | null;
}

interface SceneRow {
  id: string;
  location: string;
  intExt: string | null;
  timeOfDay: string | null;
  number: string;
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
    const format = (row as { format?: string | null }).format;
    if (typeof id !== 'string' || !id) continue;
    if (typeof title !== 'string' || !title.trim()) continue;
    out.push({ id, title: title.trim(), format: typeof format === 'string' ? format : null });
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
    const intExt = (row as { intExt?: string | null }).intExt;
    const timeOfDay = (row as { timeOfDay?: string | null }).timeOfDay;
    const number = (row as { number?: string }).number;
    if (typeof id !== 'string' || !id) continue;
    if (typeof location !== 'string' || !location.trim()) continue;
    if (typeof slugline !== 'string' || !slugline.trim()) continue;
    out.push({
      id,
      location: location.trim(),
      slugline: slugline.trim(),
      intExt: typeof intExt === 'string' ? intExt : null,
      timeOfDay: typeof timeOfDay === 'string' ? timeOfDay : null,
      number: typeof number === 'string' ? number : '',
    });
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
  const [intExt, setIntExt] = useState<string>('INT');
  const [timeOfDay, setTimeOfDay] = useState<string>('DAY');
  const [busy, setBusy] = useState(false);

  // Rename (production + scene)
  const [renamingProduction, setRenamingProduction] = useState(false);
  const [renameTitle, setRenameTitle] = useState('');
  const [renamingScene, setRenamingScene] = useState(false);
  const [sceneEditLocation, setSceneEditLocation] = useState('');
  const [sceneEditIntExt, setSceneEditIntExt] = useState<string>('INT');
  const [sceneEditTimeOfDay, setSceneEditTimeOfDay] = useState<string>('DAY');

  // Two-step delete, matching the crafting lens's arm-then-confirm row pattern.
  const [confirmDeleteProduction, setConfirmDeleteProduction] = useState(false);
  const [confirmDeleteSceneId, setConfirmDeleteSceneId] = useState<string | null>(null);

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

  const closeAllEditors = useCallback(() => {
    setComposingScene(false);
    setLocation('');
    setIntExt('INT');
    setTimeOfDay('DAY');
    setRenamingProduction(false);
    setRenamingScene(false);
    setConfirmDeleteProduction(false);
    setConfirmDeleteSceneId(null);
  }, []);

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
      closeAllEditors();
    } catch (err) {
      setActionError(err instanceof Error ? err.message : 'Could not open that production.');
    } finally {
      setBusy(false);
    }
  }, [busy, phase, closeAllEditors]);

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
      closeAllEditors();
    } catch (err) {
      setActionError(err instanceof Error ? err.message : 'Could not open that production.');
    } finally {
      setBusy(false);
    }
  }, [busy, composing, phase, title, closeAllEditors]);

  const startRenameProduction = useCallback(() => {
    const current = productions.find((p) => p.id === openId);
    setRenameTitle(current?.title || '');
    setRenamingProduction(true);
    setActionError('');
  }, [productions, openId]);

  const saveRenameProduction = useCallback(async () => {
    if (busy || !openId) return;
    const trimmed = renameTitle.trim();
    if (!trimmed) {
      setActionError('A title is required.');
      return;
    }
    setBusy(true);
    setActionError('');
    try {
      const updated = await lensRun<{ project?: { id?: string; title?: string } }>(
        'film-studios',
        'project-update',
        { id: openId, title: trimmed },
      );
      if (!updated.data?.ok) throw new Error(updated.data?.error || 'Could not rename that production.');
      const rows = await readProductions();
      const row = rows.find((item) => item.id === openId);
      if (!row || row.title !== trimmed) throw new Error('Renamed, but the production did not read it back.');
      setProductions(rows);
      setRenamingProduction(false);
    } catch (err) {
      setActionError(err instanceof Error ? err.message : 'Could not rename that production.');
    } finally {
      setBusy(false);
    }
  }, [busy, openId, renameTitle]);

  const deleteProduction = useCallback(async () => {
    if (busy || !openId) return;
    if (!confirmDeleteProduction) {
      setConfirmDeleteProduction(true);
      setActionError('');
      return;
    }
    setBusy(true);
    setActionError('');
    try {
      const deleted = await lensRun<{ deleted?: string }>('film-studios', 'project-delete', { id: openId });
      if (!deleted.data?.ok) throw new Error(deleted.data?.error || 'Could not delete that production.');
      const rows = await readProductions();
      setProductions(rows);
      setOpenId(null);
      setScenes([]);
      setSelectedId(null);
      closeAllEditors();
    } catch (err) {
      setActionError(err instanceof Error ? err.message : 'Could not delete that production.');
    } finally {
      setBusy(false);
    }
  }, [busy, openId, confirmDeleteProduction, closeAllEditors]);

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
        { projectId: openId, location: trimmed, intExt, timeOfDay },
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
      setIntExt('INT');
      setTimeOfDay('DAY');
      setComposingScene(false);
    } catch (err) {
      setActionError(err instanceof Error ? err.message : 'Could not add that scene.');
    } finally {
      setBusy(false);
    }
  }, [busy, composingScene, location, intExt, timeOfDay, openId, phase]);

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
      setRenamingScene(false);
      setConfirmDeleteSceneId(null);
    } catch (err) {
      setActionError(err instanceof Error ? err.message : 'Could not read that scene.');
    } finally {
      setBusy(false);
    }
  }, [busy, openId, phase]);

  const startEditScene = useCallback(() => {
    const current = scenes.find((s) => s.id === selectedId);
    if (!current) return;
    setSceneEditLocation(current.location);
    setSceneEditIntExt(current.intExt || 'INT');
    setSceneEditTimeOfDay(current.timeOfDay || 'DAY');
    setRenamingScene(true);
    setActionError('');
  }, [scenes, selectedId]);

  const saveEditScene = useCallback(async () => {
    if (busy || !openId || !selectedId) return;
    const trimmed = sceneEditLocation.trim();
    if (!trimmed) {
      setActionError('A location is required.');
      return;
    }
    setBusy(true);
    setActionError('');
    try {
      const updated = await lensRun<{ scene?: { id?: string } }>('film-studios', 'scene-update', {
        id: selectedId, location: trimmed, intExt: sceneEditIntExt, timeOfDay: sceneEditTimeOfDay,
      });
      if (!updated.data?.ok) throw new Error(updated.data?.error || 'Could not update that scene.');
      const rows = await readScenes(openId);
      const row = rows.find((item) => item.id === selectedId);
      if (!row || row.location !== trimmed) throw new Error('Updated, but the scene did not read it back.');
      setScenes(rows);
      setRenamingScene(false);
    } catch (err) {
      setActionError(err instanceof Error ? err.message : 'Could not update that scene.');
    } finally {
      setBusy(false);
    }
  }, [busy, openId, selectedId, sceneEditLocation, sceneEditIntExt, sceneEditTimeOfDay]);

  const deleteScene = useCallback(async (id: string) => {
    if (busy || !openId) return;
    if (confirmDeleteSceneId !== id) {
      setConfirmDeleteSceneId(id);
      setActionError('');
      return;
    }
    setBusy(true);
    setActionError('');
    try {
      const deleted = await lensRun<{ deleted?: string }>('film-studios', 'scene-delete', { id });
      if (!deleted.data?.ok) throw new Error(deleted.data?.error || 'Could not delete that scene.');
      const rows = await readScenes(openId);
      setScenes(rows);
      if (selectedId === id) {
        setSelectedId(null);
        setRenamingScene(false);
      }
      setConfirmDeleteSceneId(null);
    } catch (err) {
      setActionError(err instanceof Error ? err.message : 'Could not delete that scene.');
    } finally {
      setBusy(false);
    }
  }, [busy, openId, confirmDeleteSceneId, selectedId]);

  useLensCommand(
    [{ id: 'film-studios-new', keys: 'n', description: '+ New production', category: 'actions', action: () => { void openNew(); } }],
    { lensId: 'film-studios' },
  );

  const selected = scenes.find((scene) => scene.id === selectedId) || null;
  const openProductionRow = productions.find((p) => p.id === openId) || null;

  return (
    <LensShell lensId="film-studios" asMain={false}>
      <div data-lens-theme="film-studios" className="relative min-h-full bg-black px-8 pb-28 pt-6">
        <div className="mb-5 mt-1 flex items-baseline justify-between gap-4">
          <h1 className="font-vault text-[2.25rem] leading-tight text-zinc-100 sm:text-5xl">Film Studios</h1>
          {openProductionRow && (
            <DTUExportButton
              domain="film-studios"
              data={{ production: openProductionRow, scenes }}
              title={`${openProductionRow.title} — script`}
              tags={['film-studios', 'production']}
              compact
            />
          )}
        </div>

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
                      <li key={item.id} className="flex items-baseline justify-between gap-3">
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

                {openId && openProductionRow && (
                  <div className="mt-6 border-t border-white/10 pt-4">
                    {renamingProduction ? (
                      <div className="space-y-2">
                        <label className="block text-[14px] text-zinc-400">
                          Rename
                          <input
                            data-testid="film-rename-production"
                            value={renameTitle}
                            onChange={(event) => setRenameTitle(event.target.value)}
                            onKeyDown={(event) => {
                              if (event.key === 'Enter') { event.preventDefault(); void saveRenameProduction(); }
                            }}
                            className="mt-1 w-full border-b border-white/15 bg-transparent pb-2 text-[1rem] text-zinc-100 outline-none"
                            autoFocus
                          />
                        </label>
                        <div className="flex gap-4">
                          <button
                            type="button"
                            onClick={() => { void saveRenameProduction(); }}
                            disabled={busy}
                            className="text-[13px] text-teal-300 disabled:opacity-60"
                          >
                            Save
                          </button>
                          <button
                            type="button"
                            onClick={() => setRenamingProduction(false)}
                            className="text-[13px] text-zinc-400"
                          >
                            Cancel
                          </button>
                        </div>
                      </div>
                    ) : (
                      <div className="flex gap-4">
                        <button type="button" onClick={startRenameProduction} className="text-[13px] text-zinc-300 underline">
                          Rename
                        </button>
                        <button
                          type="button"
                          onClick={() => { void deleteProduction(); }}
                          disabled={busy}
                          className="text-[13px] text-zinc-300 underline disabled:opacity-60"
                        >
                          {confirmDeleteProduction ? 'Delete this production?' : 'Delete'}
                        </button>
                      </div>
                    )}
                  </div>
                )}
              </div>
              <div className="min-h-[22rem] px-6 py-5">
                {!selected && !composingScene ? (
                  <p data-testid="film-unselected" className="text-[14px] text-zinc-500">Nothing selected.</p>
                ) : null}
                {selected ? (
                  <div>
                    <h2 className="font-vault text-[1.5rem] leading-8 text-zinc-100">{selected.slugline}</h2>
                    <dl className="mt-2 grid grid-cols-[auto,1fr] gap-x-3 gap-y-1 text-[13px] text-zinc-400">
                      <dt>Location</dt><dd data-testid="film-scene-location" className="text-zinc-300">{selected.location}</dd>
                      <dt>INT./EXT.</dt><dd data-testid="film-scene-intext" className="text-zinc-300">{selected.intExt || '—'}</dd>
                      <dt>Time of day</dt><dd data-testid="film-scene-timeofday" className="text-zinc-300">{selected.timeOfDay || '—'}</dd>
                    </dl>
                    <div className="mt-4">
                      {renamingScene ? (
                        <div className="space-y-2">
                          <label className="block text-[13px] text-zinc-400">
                            Location
                            <input
                              data-testid="film-edit-location"
                              value={sceneEditLocation}
                              onChange={(event) => setSceneEditLocation(event.target.value)}
                              className="mt-1 w-full border-b border-white/15 bg-transparent pb-2 text-[1rem] text-zinc-100 outline-none"
                              autoFocus
                            />
                          </label>
                          <div className="flex gap-3">
                            <label className="text-[13px] text-zinc-400">
                              INT./EXT.
                              <select
                                data-testid="film-edit-intext"
                                value={sceneEditIntExt}
                                onChange={(event) => setSceneEditIntExt(event.target.value)}
                                className="ml-2 border border-white/15 bg-zinc-900 px-2 py-1 text-[13px] text-zinc-100"
                              >
                                {INT_EXT_OPTIONS.map((opt) => <option key={opt} value={opt}>{opt}</option>)}
                              </select>
                            </label>
                            <label className="text-[13px] text-zinc-400">
                              When
                              <select
                                data-testid="film-edit-timeofday"
                                value={sceneEditTimeOfDay}
                                onChange={(event) => setSceneEditTimeOfDay(event.target.value)}
                                className="ml-2 border border-white/15 bg-zinc-900 px-2 py-1 text-[13px] text-zinc-100"
                              >
                                {TIME_OF_DAY_OPTIONS.map((opt) => <option key={opt} value={opt}>{opt}</option>)}
                              </select>
                            </label>
                          </div>
                          <div className="flex gap-4">
                            <button
                              type="button"
                              onClick={() => { void saveEditScene(); }}
                              disabled={busy}
                              className="text-[13px] text-teal-300 disabled:opacity-60"
                            >
                              Save
                            </button>
                            <button type="button" onClick={() => setRenamingScene(false)} className="text-[13px] text-zinc-400">
                              Cancel
                            </button>
                          </div>
                        </div>
                      ) : (
                        <div className="flex gap-4">
                          <button type="button" onClick={startEditScene} className="text-[13px] text-zinc-300 underline">
                            Edit
                          </button>
                          <button
                            type="button"
                            onClick={() => { void deleteScene(selected.id); }}
                            disabled={busy}
                            className="text-[13px] text-zinc-300 underline disabled:opacity-60"
                          >
                            {confirmDeleteSceneId === selected.id ? 'Delete this scene?' : 'Delete'}
                          </button>
                        </div>
                      )}
                    </div>
                  </div>
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
                  <div className="mt-4 space-y-2">
                    <label className="block text-[14px] text-zinc-400">
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
                    <div className="flex gap-3">
                      <label className="text-[13px] text-zinc-400">
                        INT./EXT.
                        <select
                          data-testid="film-intext"
                          value={intExt}
                          onChange={(event) => setIntExt(event.target.value)}
                          className="ml-2 border border-white/15 bg-zinc-900 px-2 py-1 text-[13px] text-zinc-100"
                        >
                          {INT_EXT_OPTIONS.map((opt) => <option key={opt} value={opt}>{opt}</option>)}
                        </select>
                      </label>
                      <label className="text-[13px] text-zinc-400">
                        When
                        <select
                          data-testid="film-timeofday"
                          value={timeOfDay}
                          onChange={(event) => setTimeOfDay(event.target.value)}
                          className="ml-2 border border-white/15 bg-zinc-900 px-2 py-1 text-[13px] text-zinc-100"
                        >
                          {TIME_OF_DAY_OPTIONS.map((opt) => <option key={opt} value={opt}>{opt}</option>)}
                        </select>
                      </label>
                    </div>
                  </div>
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
