'use client';

/**
 * GameDesignSection — Tiled + LDtk + Nuclino shape game-design
 * workbench. Owns the game roster + active game; panels hydrate via
 * lensRun().
 */

import { useCallback, useEffect, useState } from 'react';
import { Gamepad2, Plus, FileText, Cog, Swords, Grid3x3, Loader2, Repeat, GitBranch, Image as ImageIcon, Film, Zap, Play, Users, BarChart3, Pencil, Download, X, Check } from 'lucide-react';
import { lensRun } from '@/lib/api/client';
import { cn } from '@/lib/utils';
import { GdGddPanel } from './GdGddPanel';
import { GdMechanicsPanel } from './GdMechanicsPanel';
import { GdEntitiesPanel } from './GdEntitiesPanel';
import { GdLevelPanel } from './GdLevelPanel';
import { GdLoopsPanel } from './GdLoopsPanel';
import { GdNarrativePanel } from './GdNarrativePanel';
import { GdAssetsPanel } from './GdAssetsPanel';
import { GdAnimationPanel } from './GdAnimationPanel';
import { GdBehaviorPanel } from './GdBehaviorPanel';
import { GdRuntimePanel } from './GdRuntimePanel';
import { GdCollabPanel } from './GdCollabPanel';
import { GdAnalysisPanel } from './GdAnalysisPanel';

interface Game { id: string; title: string; genre: string; platform: string; pitch?: string | null }
interface Dash {
  title: string; gddSections: number; mechanics: number; loops: number;
  entities: number; levels: number; narrativeNodes: number;
}
type TabId = 'gdd' | 'mechanics' | 'loops' | 'entities' | 'levels' | 'narrative'
  | 'assets' | 'animation' | 'behavior' | 'runtime' | 'collab' | 'analysis';
const TABS: { id: TabId; label: string; icon: typeof FileText }[] = [
  { id: 'gdd', label: 'Design Doc', icon: FileText },
  { id: 'mechanics', label: 'Mechanics', icon: Cog },
  { id: 'loops', label: 'Loops', icon: Repeat },
  { id: 'entities', label: 'Entities', icon: Swords },
  { id: 'levels', label: 'Levels', icon: Grid3x3 },
  { id: 'narrative', label: 'Narrative', icon: GitBranch },
  { id: 'assets', label: 'Assets', icon: ImageIcon },
  { id: 'animation', label: 'Animation', icon: Film },
  { id: 'behavior', label: 'Behavior', icon: Zap },
  { id: 'runtime', label: 'Play & Test', icon: Play },
  { id: 'collab', label: 'Collab', icon: Users },
  { id: 'analysis', label: 'Analysis', icon: BarChart3 },
];
const GENRES = ['platformer', 'rpg', 'puzzle', 'strategy', 'simulation', 'adventure', 'action', 'sandbox', 'other'];

export function GameDesignSection() {
  const [games, setGames] = useState<Game[]>([]);
  const [activeGame, setActiveGame] = useState<string>('');
  const [dash, setDash] = useState<Dash | null>(null);
  const [tab, setTab] = useState<TabId>('gdd');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [form, setForm] = useState({ title: '', genre: 'platformer' });
  const [editing, setEditing] = useState(false);
  const [editForm, setEditForm] = useState({ title: '', genre: 'platformer', platform: '', pitch: '' });
  const [exportJson, setExportJson] = useState<string | null>(null);
  const [exporting, setExporting] = useState(false);

  const refreshGames = useCallback(async () => {
    setLoading(true);
    try {
      const r = await lensRun('game-design', 'game-list', {});
      if (r.data?.ok === false) throw new Error(r.data?.error || 'Failed to load games.');
      const list: Game[] = r.data?.result?.games || [];
      setGames(list);
      setActiveGame((prev) => (list.some((g) => g.id === prev) ? prev : list[0]?.id || ''));
      setError(null);
    } catch (e) {
      // Previously a thrown game-list left the section stuck on the spinner
      // forever (no catch → setLoading(false) never ran). Surface it instead.
      setError(e instanceof Error ? e.message : 'Failed to load games.');
    } finally {
      setLoading(false);
    }
  }, []);

  const refreshDash = useCallback(async () => {
    if (!activeGame) { setDash(null); return; }
    const r = await lensRun('game-design', 'game-dashboard', { gameId: activeGame });
    setDash((r.data?.result as Dash | null) || null);
  }, [activeGame]);

  useEffect(() => { void refreshGames(); }, [refreshGames]);
  useEffect(() => { void refreshDash(); }, [refreshDash]);

  const addGame = async () => {
    if (!form.title.trim()) { setError('Game title is required.'); return; }
    const r = await lensRun('game-design', 'game-create', { title: form.title.trim(), genre: form.genre.trim() || 'platformer' });
    if (r.data?.ok === false) { setError(r.data?.error || 'Failed'); return; }
    setForm({ title: '', genre: 'platformer' });
    setError(null);
    await refreshGames();
  };

  const delGame = async (id: string) => {
    await lensRun('game-design', 'game-delete', { id });
    await refreshGames();
  };

  const activeGameObj = games.find((g) => g.id === activeGame) || null;

  const startEdit = () => {
    if (!activeGameObj) return;
    setEditForm({
      title: activeGameObj.title, genre: activeGameObj.genre || 'platformer',
      platform: activeGameObj.platform || '', pitch: activeGameObj.pitch || '',
    });
    setEditing(true);
  };

  const saveEdit = async () => {
    if (!activeGame || !editForm.title.trim()) return;
    const r = await lensRun('game-design', 'game-update', {
      id: activeGame, title: editForm.title.trim(), genre: editForm.genre,
      platform: editForm.platform.trim(), pitch: editForm.pitch.trim(),
    });
    if (r.data?.ok === false) { setError(r.data?.error || 'Failed to save'); return; }
    setEditing(false);
    setError(null);
    await refreshGames();
  };

  const exportProject = async () => {
    if (!activeGame) return;
    setExporting(true);
    const r = await lensRun('game-design', 'game-export', { gameId: activeGame });
    setExporting(false);
    if (r.data?.ok === false) { setError(r.data?.error || 'Export failed'); return; }
    setExportJson((r.data?.result as { json?: string } | null)?.json || null);
  };

  return (
    <div className="rounded-2xl border border-zinc-800 bg-zinc-950/60 overflow-hidden">
      <header className="flex items-center gap-2 px-4 py-3 border-b border-zinc-800 bg-gradient-to-r from-lime-600/15 to-transparent">
        <Gamepad2 className="w-5 h-5 text-lime-400" />
        <h2 className="text-sm font-bold text-zinc-100">Game Design</h2>
        <span className="text-[11px] text-zinc-400">Tiled + LDtk + Nuclino shape · GDD + level editor</span>
      </header>

      {error && (
        <div role="alert" className="mx-4 mt-3 flex items-center justify-between gap-3 text-xs text-rose-400 bg-rose-950/40 border border-rose-900/50 rounded-lg px-3 py-2">
          <span>{error}</span>
          <button
            type="button"
            onClick={() => { setError(null); void refreshGames(); }}
            className="shrink-0 px-2 py-1 rounded-md bg-rose-900/40 border border-rose-800/60 text-rose-200 hover:bg-rose-900/60"
          >
            Retry
          </button>
        </div>
      )}

      {loading ? (
        <div role="status" aria-live="polite" className="flex items-center justify-center gap-2 py-6 text-zinc-400">
          <Loader2 className="w-4 h-4 animate-spin" />
          <span>Loading game projects…</span>
        </div>
      ) : (
        <>
          <div className="px-4 py-3 border-b border-zinc-800 space-y-2">
            <div className="flex flex-wrap items-center gap-1.5">
              {games.map((g) => (
                <span key={g.id} className={cn('flex items-center gap-1.5 text-[11px] pl-2.5 pr-1.5 py-1 rounded-lg',
                  activeGame === g.id ? 'bg-lime-600 text-white' : 'bg-zinc-800 text-zinc-300')}>
                  <button type="button" onClick={() => setActiveGame(g.id)}>{g.title}</button>
                  <button type="button" onClick={() => delGame(g.id)} className="text-zinc-300/70 hover:text-rose-200">×</button>
                </span>
              ))}
            </div>
            <div className="flex items-center gap-2">
              <input id="gd-new-game-title" placeholder="New game title" value={form.title} onChange={(e) => setForm({ ...form, title: e.target.value })}
                className="flex-1 bg-zinc-950 border border-zinc-700 rounded-lg px-2 py-1.5 text-xs text-zinc-100" />
              <input placeholder="Genre" value={form.genre} onChange={(e) => setForm({ ...form, genre: e.target.value })}
                className="w-32 bg-zinc-950 border border-zinc-700 rounded-lg px-2 py-1.5 text-xs text-zinc-100" />
              <button type="button" onClick={addGame}
                className="flex items-center gap-1 px-3 py-1.5 text-xs font-medium bg-lime-600 hover:bg-lime-500 text-white rounded-lg">
                <Plus className="w-3.5 h-3.5" /> Game
              </button>
            </div>
          </div>

          {!activeGame ? (
            <p className="text-[11px] text-zinc-400 italic px-4 py-8 text-center">Create a game project to start designing.</p>
          ) : (
            <>
              {dash && (
                <div className="grid grid-cols-3 sm:grid-cols-6 gap-2 px-4 py-3 border-b border-zinc-800">
                  <Stat label="GDD sections" value={dash.gddSections} />
                  <Stat label="Mechanics" value={dash.mechanics} />
                  <Stat label="Loops" value={dash.loops ?? 0} />
                  <Stat label="Entities" value={dash.entities} />
                  <Stat label="Levels" value={dash.levels} />
                  <Stat label="Story nodes" value={dash.narrativeNodes ?? 0} />
                </div>
              )}

              <div className="flex items-center gap-2 px-4 py-2 border-b border-zinc-800">
                {!editing ? (
                  <>
                    <span className="flex-1 text-xs text-zinc-300 truncate">
                      {activeGameObj?.title} <span className="text-zinc-500">· {activeGameObj?.genre}{activeGameObj?.platform ? ` · ${activeGameObj.platform}` : ''}</span>
                    </span>
                    <button type="button" onClick={startEdit}
                      className="flex items-center gap-1 px-2 py-1 text-[11px] bg-zinc-800 hover:bg-zinc-700 text-zinc-200 rounded-lg">
                      <Pencil className="w-3 h-3" /> Edit
                    </button>
                    <button type="button" onClick={exportProject} disabled={exporting}
                      className="flex items-center gap-1 px-2 py-1 text-[11px] bg-zinc-800 hover:bg-zinc-700 disabled:opacity-50 text-zinc-200 rounded-lg">
                      {exporting ? <Loader2 className="w-3 h-3 animate-spin" /> : <Download className="w-3 h-3" />} Export
                    </button>
                  </>
                ) : (
                  <div className="flex flex-1 flex-wrap items-center gap-1.5">
                    <input value={editForm.title} onChange={(e) => setEditForm({ ...editForm, title: e.target.value })}
                      placeholder="Title" className="flex-1 min-w-[120px] bg-zinc-950 border border-zinc-700 rounded-lg px-2 py-1 text-[11px] text-zinc-100" />
                    <select value={editForm.genre} onChange={(e) => setEditForm({ ...editForm, genre: e.target.value })}
                      className="bg-zinc-950 border border-zinc-700 rounded-lg px-2 py-1 text-[11px] text-zinc-100 capitalize">
                      {GENRES.map((g) => <option key={g} value={g}>{g}</option>)}
                    </select>
                    <input value={editForm.platform} onChange={(e) => setEditForm({ ...editForm, platform: e.target.value })}
                      placeholder="Platform" className="w-24 bg-zinc-950 border border-zinc-700 rounded-lg px-2 py-1 text-[11px] text-zinc-100" />
                    <input value={editForm.pitch} onChange={(e) => setEditForm({ ...editForm, pitch: e.target.value })}
                      placeholder="One-line pitch" className="flex-1 min-w-[160px] bg-zinc-950 border border-zinc-700 rounded-lg px-2 py-1 text-[11px] text-zinc-100" />
                    <button type="button" onClick={saveEdit} disabled={!editForm.title.trim()}
                      className="flex items-center gap-1 px-2 py-1 text-[11px] bg-lime-600 hover:bg-lime-500 disabled:opacity-50 text-white rounded-lg">
                      <Check className="w-3 h-3" /> Save
                    </button>
                    <button type="button" onClick={() => setEditing(false)}
                      className="flex items-center gap-1 px-2 py-1 text-[11px] bg-zinc-800 hover:bg-zinc-700 text-zinc-200 rounded-lg">
                      <X className="w-3 h-3" /> Cancel
                    </button>
                  </div>
                )}
              </div>

              {exportJson && (
                <div className="px-4 py-2 border-b border-zinc-800 space-y-1.5">
                  <div className="flex items-center justify-between">
                    <p className="text-[10px] text-zinc-400 uppercase">Whole-project export</p>
                    <button type="button" onClick={() => setExportJson(null)} className="text-zinc-500 hover:text-zinc-300"><X className="w-3.5 h-3.5" /></button>
                  </div>
                  <textarea readOnly value={exportJson} rows={6}
                    className="w-full bg-zinc-950 border border-zinc-700 rounded-lg px-2 py-1.5 text-[10px] text-zinc-300 font-mono resize-y" />
                </div>
              )}

              <nav className="flex gap-1 px-2 pt-2 border-b border-zinc-800 overflow-x-auto">
                {TABS.map((t) => {
                  const Icon = t.icon;
                  const active = tab === t.id;
                  return (
                    <button key={t.id} type="button" onClick={() => setTab(t.id)}
                      className={cn('flex items-center gap-1.5 px-3 py-2 text-xs font-medium rounded-t-lg whitespace-nowrap focus:outline-none focus:ring-2 focus:ring-lime-500',
                        active ? 'bg-zinc-900 text-lime-300 border-x border-t border-zinc-800' : 'text-zinc-400 hover:text-zinc-200')}>
                      <Icon className="w-3.5 h-3.5" /> {t.label}
                    </button>
                  );
                })}
              </nav>
              <div className="p-4">
                {tab === 'gdd' && <GdGddPanel gameId={activeGame} onChange={refreshDash} />}
                {tab === 'mechanics' && <GdMechanicsPanel gameId={activeGame} onChange={refreshDash} />}
                {tab === 'loops' && <GdLoopsPanel gameId={activeGame} onChange={refreshDash} />}
                {tab === 'entities' && <GdEntitiesPanel gameId={activeGame} onChange={refreshDash} />}
                {tab === 'levels' && <GdLevelPanel gameId={activeGame} onChange={refreshDash} />}
                {tab === 'narrative' && <GdNarrativePanel gameId={activeGame} onChange={refreshDash} />}
                {tab === 'assets' && <GdAssetsPanel gameId={activeGame} onChange={refreshDash} />}
                {tab === 'animation' && <GdAnimationPanel gameId={activeGame} onChange={refreshDash} />}
                {tab === 'behavior' && <GdBehaviorPanel gameId={activeGame} onChange={refreshDash} />}
                {tab === 'runtime' && <GdRuntimePanel gameId={activeGame} onChange={refreshDash} />}
                {tab === 'collab' && <GdCollabPanel gameId={activeGame} onChange={refreshDash} />}
                {tab === 'analysis' && <GdAnalysisPanel gameId={activeGame} onChange={refreshDash} />}
              </div>
            </>
          )}
        </>
      )}
    </div>
  );
}

function Stat({ label, value }: { label: string; value: string | number }) {
  return (
    <div className="text-center">
      <p className="text-base font-bold text-zinc-100">{value}</p>
      <p className="text-[10px] text-zinc-400 uppercase tracking-wide">{label}</p>
    </div>
  );
}
