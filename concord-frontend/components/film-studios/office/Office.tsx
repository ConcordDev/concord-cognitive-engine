'use client';

/**
 * The Production Office — Film Studios.
 *
 * One production at a time, run the way a film office runs it: productions
 * are slates; scenes are strips on a stripboard in the industry's colours
 * (white INT. day, yellow EXT. day, blue INT. night, green EXT. night, pink
 * dawn/dusk); the work happens in rooms along the corridor (script,
 * breakdown, shots, the board with call sheets, budget & crew, the cutting
 * room with real footage and a monitor that plays the cut, the screening
 * room with notes pinned to timecodes and watch parties, and release). The
 * Cinema is the public side: released films, free or sold in CC.
 *
 * Production and scene editing keep their read-back contract: a title or a
 * slugline is only shown after project-list / scene-list return that id
 * with the same value. A blank title or location is never sent; delete is
 * an arm-then-confirm on the row.
 */

import { useCallback, useEffect, useState } from 'react';
import { LensShell } from '@/components/lens/LensShell';
import { DTUExportButton } from '@/components/lens/DTUExportButton';
import { useLensCommand } from '@/hooks/useLensCommand';
import { useLensNav } from '@/hooks/useLensNav';
import { lensRun } from '@/lib/api/client';
import { sceneLocationError } from '@/lib/form-guards';
import { FsScriptPanel } from '@/components/film-studios/FsScriptPanel';
import { FsScreenplayPanel } from '@/components/film-studios/FsScreenplayPanel';
import { FsShotsPanel } from '@/components/film-studios/FsShotsPanel';
import { FsSchedulePanel } from '@/components/film-studios/FsSchedulePanel';
import { FsProductionPanel } from '@/components/film-studios/FsProductionPanel';
import { FsBudgetTeamPanel } from '@/components/film-studios/FsBudgetTeamPanel';
import { CuttingRoom } from './CuttingRoom';
import { ScreeningRoom } from './ScreeningRoom';
import { ReleaseDesk } from './ReleaseDesk';
import { Cinema } from './Cinema';
import { stripColour } from './fo';
import { officeFontVars } from './officeFonts';
import './office.css';

type Room = 'script' | 'screenplay' | 'shots' | 'schedule' | 'budget' | 'edit' | 'screening' | 'release';
const ROOMS: { id: Room; label: string }[] = [
  { id: 'script', label: 'Script' },
  { id: 'screenplay', label: 'Breakdown' },
  { id: 'shots', label: 'Shots' },
  { id: 'schedule', label: 'The board' },
  { id: 'budget', label: 'Budget & crew' },
  { id: 'edit', label: 'Cutting room' },
  { id: 'screening', label: 'Screening room' },
  { id: 'release', label: 'Release' },
];

const STRIP_KEY: [string, string][] = [
  ['INT. day', 'var(--fo-strip-int-day)'], ['EXT. day', 'var(--fo-strip-ext-day)'],
  ['INT. night', 'var(--fo-strip-int-night)'], ['EXT. night', 'var(--fo-strip-ext-night)'], ['Dawn / dusk', 'var(--fo-strip-dawn)'],
];

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

export default function Office() {
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
  const [deskTab, setDeskTab] = useState<Room>('script');
  const [mode, setMode] = useState<'office' | 'cinema'>('office');
  const [cinemaFilm, setCinemaFilm] = useState<string | null>(null);
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
    const locationError = sceneLocationError(trimmed);
    if (locationError) {
      setActionError(locationError);
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

  const editRow = (testid: string, value: string, set: (v: string) => void, onEnter?: () => void) => (
    <input
      data-testid={testid}
      value={value}
      onChange={(event) => set(event.target.value)}
      onKeyDown={(event) => { if (onEnter && event.key === 'Enter') { event.preventDefault(); onEnter(); } }}
      className="fo-input mt-1"
      autoFocus
    />
  );
  const pickRow = (testid: string, label: string, value: string, set: (v: string) => void, options: readonly string[]) => (
    <label className="inline-flex min-h-11 items-center gap-2 text-[13px] text-[var(--fo-muted)]">
      {label}
      <select data-testid={testid} value={value} onChange={(event) => set(event.target.value)} className="fo-input !w-auto !min-h-[34px] !py-1 text-[13px]">
        {options.map((opt) => <option key={opt} value={opt}>{opt}</option>)}
      </select>
    </label>
  );

  return (
    <LensShell lensId="film-studios" asMain={false}>
      <div data-lens-theme="film-studios" className={`fo ${officeFontVars} relative min-h-full px-4 pb-28 pt-5 sm:px-8`}>
        <header className="mb-5">
          <div className="fo-clap max-w-[220px]" aria-hidden />
          <div className="flex flex-wrap items-end justify-between gap-4 border-t-[3px] border-[var(--fo-paper)] pt-3">
            <div>
              <h1 className="fo-slate text-[2.4rem] leading-none text-[var(--fo-paper)] sm:text-[3rem]">Film Studios</h1>
              <p className="fo-type mt-1 text-[13px] text-[#b9b3a6]">{mode === 'office' ? `The Production Office${openProductionRow ? ` · PROD. “${openProductionRow.title}”` : ''}` : 'The Cinema · films released on Concord'}</p>
            </div>
            <div className="flex items-center gap-3">
              <div className="flex rounded-md border border-[#4a4b50] p-0.5" role="group" aria-label="Office or cinema">
                <button type="button" aria-pressed={mode === 'office'} onClick={() => setMode('office')} className={`fo-slate rounded px-3 py-1.5 text-[14px] ${mode === 'office' ? 'bg-[var(--fo-paper)] text-[var(--fo-ink)]' : 'text-[#bdb8ac] hover:text-[var(--fo-paper)]'}`}>Office</button>
                <button type="button" aria-pressed={mode === 'cinema'} onClick={() => setMode('cinema')} className={`fo-slate rounded px-3 py-1.5 text-[14px] ${mode === 'cinema' ? 'bg-[var(--fo-paper)] text-[var(--fo-ink)]' : 'text-[#bdb8ac] hover:text-[var(--fo-paper)]'}`} data-testid="fo-mode-cinema">Cinema</button>
              </div>
              {mode === 'office' && openProductionRow && (
                <DTUExportButton domain="film-studios" data={{ production: openProductionRow, scenes }} title={`${openProductionRow.title} — script`} tags={['film-studios', 'production']} compact />
              )}
            </div>
          </div>
        </header>

        {mode === 'cinema' ? (
          <Cinema initialId={cinemaFilm} onConsumedInitial={() => setCinemaFilm(null)} />
        ) : (
          <>
            <section aria-label="Production" className="grid gap-4 lg:grid-cols-[300px_minmax(0,1fr)]">
              {phase === 'loading' && (
                <div className="fo-sheet col-span-full p-5">
                  <p data-testid="film-loading" role="status" aria-busy="true" className="text-[14px]">Opening the production.</p>
                  <div className="fo-skeleton mt-3 h-24" />
                </div>
              )}
              {phase === 'error' && (
                <div data-testid="film-error" role="alert" className="fo-sheet col-span-full p-5">
                  <p className="text-[14px]">{loadError || 'Could not load the production.'}</p>
                  <button type="button" onClick={load} className="fo-btn mt-3">Retry</button>
                </div>
              )}
              {phase === 'ready' && (
                <>
                  <div className="fo-sheet p-4">
                    <div className="flex items-center justify-between gap-2">
                      <h2 className="fo-label">Productions</h2>
                      <button type="button" onClick={() => { void openNew(); }} disabled={phase !== 'ready' || busy} className="fo-btn fo-btn-tape !min-h-[34px] !px-3 text-[13px]">
                        + New production
                      </button>
                    </div>
                    {productions.length === 0 && !composing ? (
                      <p data-testid="film-empty" className="mt-2 text-[14px]">No production open.</p>
                    ) : null}
                    {productions.length > 0 && (
                      <ul data-testid="film-productions" className="mt-2 space-y-1.5">
                        {productions.map((item) => (
                          <li key={item.id}>
                            <button
                              type="button"
                              aria-pressed={openId === item.id}
                              onClick={() => { void openProduction(item.id); }}
                              disabled={busy}
                              className={`fo-slate block w-full rounded border-l-4 px-3 py-2 text-left text-[18px] leading-tight transition-colors ${openId === item.id ? 'border-[var(--fo-tape)] bg-[var(--fo-ink)] text-[var(--fo-paper)]' : 'border-transparent hover:bg-[var(--fo-paper-2)]'}`}
                            >
                              {item.title}
                            </button>
                          </li>
                        ))}
                      </ul>
                    )}
                    {composing && (
                      <label className="mt-4 block text-[13px] text-[var(--fo-muted)]">
                        Title
                        {editRow('film-title', title, setTitle, () => { void openNew(); })}
                      </label>
                    )}
                    {openId && openProductionRow && (
                      <div className="mt-4 border-t border-[var(--fo-rule)] pt-3">
                        {renamingProduction ? (
                          <div className="space-y-2">
                            <label className="block text-[13px] text-[var(--fo-muted)]">
                              Rename
                              {editRow('film-rename-production', renameTitle, setRenameTitle, () => { void saveRenameProduction(); })}
                            </label>
                            <div className="flex gap-2">
                              <button type="button" onClick={() => { void saveRenameProduction(); }} disabled={busy} className="fo-btn">Save</button>
                              <button type="button" onClick={() => setRenamingProduction(false)} className="fo-btn fo-btn-quiet">Cancel</button>
                            </div>
                          </div>
                        ) : (
                          <div className="flex gap-2">
                            <button type="button" onClick={startRenameProduction} className="fo-btn fo-btn-quiet">Rename</button>
                            <button type="button" onClick={() => { void deleteProduction(); }} disabled={busy} className={`fo-btn ${confirmDeleteProduction ? '!border-[var(--fo-bad)] !text-[var(--fo-bad)]' : 'fo-btn-quiet'}`}>
                              {confirmDeleteProduction ? 'Delete this production?' : 'Delete'}
                            </button>
                          </div>
                        )}
                      </div>
                    )}
                  </div>

                  <div className="fo-sheet p-4">
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <h2 className="fo-label">Stripboard</h2>
                      <ul className="flex flex-wrap gap-1.5" aria-label="Strip colours">
                        {STRIP_KEY.map(([label, colour]) => (
                          <li key={label} className="flex items-center gap-1 text-[11px] text-[var(--fo-muted)]"><span className="inline-block h-3 w-5 rounded-sm border border-black/20" style={{ background: colour }} />{label}</li>
                        ))}
                      </ul>
                    </div>
                    {!selected && !composingScene ? (
                      <p data-testid="film-unselected" className="mt-2 text-[14px] text-[var(--fo-muted)]">Nothing selected.</p>
                    ) : null}
                    {selected ? (
                      <div className="fo-rise mt-3 rounded border border-[var(--fo-rule-2)] p-3" style={{ background: stripColour(selected.intExt, selected.timeOfDay) }}>
                        <h2 className="fo-type text-[18px] font-bold uppercase text-[#141414]">{selected.slugline}</h2>
                        <dl className="mt-2 grid grid-cols-[auto,1fr] gap-x-3 gap-y-0.5 text-[13px] text-[#3d3a35]">
                          <dt>Location</dt><dd data-testid="film-scene-location" className="text-[#141414]">{selected.location}</dd>
                          <dt>INT./EXT.</dt><dd data-testid="film-scene-intext" className="text-[#141414]">{selected.intExt || '—'}</dd>
                          <dt>Time of day</dt><dd data-testid="film-scene-timeofday" className="text-[#141414]">{selected.timeOfDay || '—'}</dd>
                        </dl>
                        <div className="mt-3">
                          {renamingScene ? (
                            <div className="space-y-2">
                              <label className="block text-[13px] text-[#3d3a35]">
                                Location
                                {editRow('film-edit-location', sceneEditLocation, setSceneEditLocation)}
                              </label>
                              <div className="flex flex-wrap gap-3">
                                {pickRow('film-edit-intext', 'INT./EXT.', sceneEditIntExt, setSceneEditIntExt, INT_EXT_OPTIONS)}
                                {pickRow('film-edit-timeofday', 'When', sceneEditTimeOfDay, setSceneEditTimeOfDay, TIME_OF_DAY_OPTIONS)}
                              </div>
                              <div className="flex gap-2">
                                <button type="button" onClick={() => { void saveEditScene(); }} disabled={busy} className="fo-btn">Save</button>
                                <button type="button" onClick={() => setRenamingScene(false)} className="fo-btn fo-btn-quiet">Cancel</button>
                              </div>
                            </div>
                          ) : (
                            <div className="flex gap-2">
                              <button type="button" onClick={startEditScene} className="fo-btn">Edit</button>
                              <button type="button" onClick={() => { void deleteScene(selected.id); }} disabled={busy} className={`fo-btn ${confirmDeleteSceneId === selected.id ? '!border-[var(--fo-bad)] !text-[var(--fo-bad)]' : ''}`}>
                                {confirmDeleteSceneId === selected.id ? 'Delete this scene?' : 'Delete'}
                              </button>
                            </div>
                          )}
                        </div>
                      </div>
                    ) : null}
                    {openId && scenes.length > 0 && (
                      <ul data-testid="film-scenes" className="mt-3 space-y-1">
                        {scenes.map((scene, i) => (
                          <li key={scene.id}>
                            <button
                              type="button"
                              aria-pressed={selectedId === scene.id}
                              aria-label={scene.slugline}
                              onClick={() => { void chooseScene(scene.id); }}
                              disabled={busy}
                              className="fo-strip w-full"
                              style={{ ['--strip' as string]: stripColour(scene.intExt, scene.timeOfDay) }}
                            >
                              <span className="fo-strip-no">{scene.number || i + 1}</span>
                              <span className="fo-type truncate font-bold uppercase">{scene.slugline}</span>
                              <span className="text-[11px] font-semibold opacity-70">{scene.intExt || ''}{scene.timeOfDay ? ` · ${scene.timeOfDay}` : ''}</span>
                            </button>
                          </li>
                        ))}
                      </ul>
                    )}
                    {openId && composingScene && (
                      <div className="mt-3 space-y-2 rounded border border-dashed border-[var(--fo-rule-2)] p-3">
                        <label className="block text-[13px] text-[var(--fo-muted)]">
                          Location
                          {editRow('film-location', location, setLocation, () => { void addScene(); })}
                        </label>
                        <div className="flex flex-wrap gap-3">
                          {pickRow('film-intext', 'INT./EXT.', intExt, setIntExt, INT_EXT_OPTIONS)}
                          {pickRow('film-timeofday', 'When', timeOfDay, setTimeOfDay, TIME_OF_DAY_OPTIONS)}
                        </div>
                      </div>
                    )}
                    {openId && (
                      <button type="button" onClick={() => { void addScene(); }} disabled={busy} className="fo-btn mt-4">
                        Add scene
                      </button>
                    )}
                  </div>
                </>
              )}
            </section>

            {phase === 'ready' && openProductionRow && (
              <section aria-label="Production desk" className="mt-6">
                <div role="tablist" aria-label="Rooms" className="flex gap-0.5 overflow-x-auto border-b-[3px] border-[var(--fo-paper)]">
                  {ROOMS.map((t) => (
                    <button key={t.id} type="button" role="tab" aria-selected={deskTab === t.id} data-testid={`film-desk-tab-${t.id}`} onClick={() => setDeskTab(t.id)} className="fo-door">
                      {t.label}
                    </button>
                  ))}
                </div>
                <div className={deskTab === 'edit' || deskTab === 'screening' || deskTab === 'release' ? 'pt-4' : 'fo-sheet rounded-t-none p-4'}>
                  {deskTab === 'script' && <FsScriptPanel projectId={openProductionRow.id} onChange={() => { void pull(); }} />}
                  {deskTab === 'screenplay' && <FsScreenplayPanel projectId={openProductionRow.id} />}
                  {deskTab === 'shots' && <FsShotsPanel projectId={openProductionRow.id} />}
                  {deskTab === 'schedule' && (
                    <div className="space-y-6">
                      <FsSchedulePanel projectId={openProductionRow.id} onChange={() => { void pull(); }} />
                      <div className="border-t border-[var(--fo-rule)] pt-4"><FsProductionPanel projectId={openProductionRow.id} /></div>
                    </div>
                  )}
                  {deskTab === 'budget' && <FsBudgetTeamPanel projectId={openProductionRow.id} onChange={() => { void pull(); }} />}
                  {deskTab === 'edit' && <CuttingRoom projectId={openProductionRow.id} onChange={() => { void pull(); }} />}
                  {deskTab === 'screening' && <ScreeningRoom projectId={openProductionRow.id} />}
                  {deskTab === 'release' && <ReleaseDesk projectId={openProductionRow.id} onOpenCinema={(id) => { setCinemaFilm(id); setMode('cinema'); }} />}
                </div>
              </section>
            )}

            {actionError ? (
              <p role="alert" className="fo-error mt-4 max-w-xl">{actionError}</p>
            ) : null}


          </>
        )}
      </div>
    </LensShell>
  );
}
