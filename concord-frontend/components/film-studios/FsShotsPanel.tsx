'use client';

/**
 * FsShotsPanel — per-scene shot list with size / angle / movement / lens.
 */

import { useCallback, useEffect, useState } from 'react';
import { Loader2, Plus, Trash2, Camera, ChevronUp, ChevronDown, Link2 } from 'lucide-react';
import { lensRun } from '@/lib/api/client';
import { cn } from '@/lib/utils';

interface Scene { id: string; number: string; slugline: string }
interface Shot {
  id: string; number: string; size: string; angle: string; movement: string;
  lens: string | null; equipment: string | null; description: string | null;
  storyboardUrl?: string | null;
}
interface BoardFrame {
  shotId: string; number: string; position: number; size: string; angle: string;
  movement: string; description: string | null; storyboardUrl: string | null;
  frameNotes: string | null; hasFrame: boolean;
}

const SIZES = ['ECU', 'CU', 'MCU', 'MS', 'MWS', 'WS', 'EWS', 'OTS', 'POV', 'INSERT'];
const ANGLES = ['eye_level', 'high', 'low', 'dutch', 'overhead', 'ots', 'pov', 'worm'];
const MOVES = ['static', 'pan', 'tilt', 'dolly', 'track', 'handheld', 'steadicam', 'crane', 'zoom', 'drone'];

export function FsShotsPanel({ projectId }: { projectId: string }) {
  const [scenes, setScenes] = useState<Scene[]>([]);
  const [activeScene, setActiveScene] = useState<string>('');
  const [shots, setShots] = useState<Shot[]>([]);
  const [board, setBoard] = useState<BoardFrame[]>([]);
  const [loading, setLoading] = useState(true);
  const [view, setView] = useState<'list' | 'board'>('list');
  const [form, setForm] = useState({ size: 'MS', angle: 'eye_level', movement: 'static', lens: '', description: '' });

  const loadScenes = useCallback(async () => {
    const r = await lensRun('film-studios', 'scene-list', { projectId });
    const list: Scene[] = r.data?.result?.scenes || [];
    setScenes(list);
    setActiveScene((prev) => (list.some((s) => s.id === prev) ? prev : list[0]?.id || ''));
    setLoading(false);
  }, [projectId]);

  const loadShots = useCallback(async () => {
    if (!activeScene) { setShots([]); setBoard([]); return; }
    const [r, b] = await Promise.all([
      lensRun('film-studios', 'shot-list', { sceneId: activeScene }),
      lensRun('film-studios', 'shot-board-sequence', { sceneId: activeScene }),
    ]);
    setShots(r.data?.result?.shots || []);
    setBoard(b.data?.result?.frames || []);
  }, [activeScene]);

  useEffect(() => { void loadScenes(); }, [loadScenes]);
  useEffect(() => { void loadShots(); }, [loadShots]);

  const addShot = async () => {
    if (!activeScene) return;
    await lensRun('film-studios', 'shot-add', { sceneId: activeScene, ...form, description: form.description.trim() });
    setForm({ size: 'MS', angle: 'eye_level', movement: 'static', lens: '', description: '' });
    await loadShots();
  };

  const delShot = async (id: string) => {
    await lensRun('film-studios', 'shot-delete', { id });
    await loadShots();
  };

  // Drag-link: reorder storyboard frames within the scene.
  const moveBoardFrame = async (index: number, dir: -1 | 1) => {
    const target = index + dir;
    if (target < 0 || target >= board.length) return;
    const ids = board.map((f) => f.shotId);
    [ids[index], ids[target]] = [ids[target], ids[index]];
    await lensRun('film-studios', 'storyboard-reorder', { sceneId: activeScene, shotIds: ids });
    await loadShots();
  };

  // Drag-link: relink a shot to a different scene.
  const relinkShot = async (shotId: string, sceneId: string) => {
    if (!sceneId) return;
    await lensRun('film-studios', 'shot-relink-scene', { shotId, sceneId });
    await loadShots();
  };

  if (loading) {
    return <div className="flex items-center justify-center py-10 text-zinc-400"><Loader2 className="w-5 h-5 animate-spin" /></div>;
  }

  if (scenes.length === 0) {
    return <p className="text-[11px] text-zinc-400 italic py-8 text-center">Add scenes in the Script tab before building shot lists.</p>;
  }

  return (
    <div className="space-y-4">
      {/* Scene selector + view toggle */}
      <div className="flex items-center gap-2">
        <select value={activeScene} onChange={(e) => setActiveScene(e.target.value)}
          className="flex-1 bg-zinc-950 border border-zinc-700 rounded-lg px-2 py-2 text-xs text-zinc-100">
          {scenes.map((s) => <option key={s.id} value={s.id}>{s.number} · {s.slugline}</option>)}
        </select>
        <div className="flex rounded-lg border border-zinc-700 overflow-hidden">
          <button type="button" onClick={() => setView('list')}
            className={cn('px-3 py-1.5 text-xs font-medium', view === 'list' ? 'bg-fuchsia-600 text-white' : 'bg-zinc-950 text-zinc-400')}>
            Shot list
          </button>
          <button type="button" onClick={() => setView('board')}
            className={cn('px-3 py-1.5 text-xs font-medium', view === 'board' ? 'bg-fuchsia-600 text-white' : 'bg-zinc-950 text-zinc-400')}>
            Storyboard
          </button>
        </div>
      </div>

      {/* New shot */}
      <section className="bg-zinc-900/70 border border-zinc-800 rounded-xl p-3 space-y-2">
        <div className="grid grid-cols-3 gap-2">
          <select value={form.size} onChange={(e) => setForm({ ...form, size: e.target.value })}
            className="bg-zinc-950 border border-zinc-700 rounded-lg px-2 py-1.5 text-xs text-zinc-100">
            {SIZES.map((x) => <option key={x} value={x}>{x}</option>)}
          </select>
          <select value={form.angle} onChange={(e) => setForm({ ...form, angle: e.target.value })}
            className="bg-zinc-950 border border-zinc-700 rounded-lg px-2 py-1.5 text-xs text-zinc-100">
            {ANGLES.map((x) => <option key={x} value={x}>{x.replace(/_/g, ' ')}</option>)}
          </select>
          <select value={form.movement} onChange={(e) => setForm({ ...form, movement: e.target.value })}
            className="bg-zinc-950 border border-zinc-700 rounded-lg px-2 py-1.5 text-xs text-zinc-100">
            {MOVES.map((x) => <option key={x} value={x}>{x}</option>)}
          </select>
        </div>
        <div className="flex items-center gap-2">
          <input placeholder="Lens (e.g. 35mm)" value={form.lens} onChange={(e) => setForm({ ...form, lens: e.target.value })}
            className="w-32 bg-zinc-950 border border-zinc-700 rounded-lg px-2 py-1.5 text-xs text-zinc-100" />
          <input placeholder="Shot description" value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })}
            className="flex-1 bg-zinc-950 border border-zinc-700 rounded-lg px-2 py-1.5 text-xs text-zinc-100" />
          <button type="button" onClick={addShot}
            className="flex items-center gap-1 px-3 py-1.5 text-xs font-medium bg-fuchsia-600 hover:bg-fuchsia-500 text-white rounded-lg">
            <Plus className="w-3.5 h-3.5" /> Shot
          </button>
        </div>
      </section>

      {/* Shot list */}
      {view === 'list' && (
        shots.length === 0 ? (
          <p className="text-[11px] text-zinc-400 italic py-6 text-center">No shots in this scene yet.</p>
        ) : (
          <ul className="space-y-1.5">
            {shots.map((sh) => (
              <li key={sh.id} className="flex items-center gap-3 bg-zinc-900/70 border border-zinc-800 rounded-lg px-3 py-2">
                {sh.storyboardUrl ? (
                  /* eslint-disable-next-line @next/next/no-img-element */
                  <img src={sh.storyboardUrl} alt="storyboard" className="w-14 h-9 object-cover rounded shrink-0" />
                ) : (
                  <span className="flex items-center justify-center w-8 h-8 rounded bg-fuchsia-900/40 text-fuchsia-300 text-xs font-bold shrink-0">
                    {sh.number}
                  </span>
                )}
                <div className="min-w-0 flex-1">
                  <p className="text-xs text-zinc-100">
                    <span className="font-semibold">{sh.size}</span> · {sh.angle.replace(/_/g, ' ')} · {sh.movement}
                    {sh.lens && <span className="text-zinc-400"> · {sh.lens}</span>}
                  </p>
                  {sh.description && <p className="text-[11px] text-zinc-400 truncate">{sh.description}</p>}
                </div>
                {/* Drag-link: relink shot to a different scene */}
                {scenes.length > 1 && (
                  <select value="" onChange={(e) => relinkShot(sh.id, e.target.value)}
                    className="bg-zinc-950 border border-zinc-700 rounded px-1.5 py-1 text-[10px] text-zinc-400 shrink-0"
                    title="Relink shot to another scene">
                    <option value="">↪ scene</option>
                    {scenes.filter((s) => s.id !== activeScene).map((s) => (
                      <option key={s.id} value={s.id}>{s.number} · {s.slugline}</option>
                    ))}
                  </select>
                )}
                <button type="button"
                  onClick={async () => {
                    const url = window.prompt('Storyboard image URL:', sh.storyboardUrl || '');
                    if (url !== null) {
                      await lensRun('film-studios', 'shot-storyboard-set', { shotId: sh.id, imageUrl: url.trim() });
                      await loadShots();
                    }
                  }}
                  className="text-zinc-400 hover:text-fuchsia-300 shrink-0" title="Set storyboard frame">
                  <Camera className="w-3.5 h-3.5" />
                </button>
                <button aria-label="Delete" type="button" onClick={() => delShot(sh.id)} className="text-zinc-600 hover:text-rose-400 shrink-0">
                  <Trash2 className="w-3.5 h-3.5" />
                </button>
              </li>
            ))}
          </ul>
        )
      )}

      {/* Storyboard — drag-link reorder of thumbnail frames */}
      {view === 'board' && (
        board.length === 0 ? (
          <p className="text-[11px] text-zinc-400 italic py-6 text-center">No shots to board. Add shots in the list view first.</p>
        ) : (
          <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
            {board.map((f, idx) => (
              <div key={f.shotId} className="bg-zinc-900/70 border border-zinc-800 rounded-lg overflow-hidden">
                <div className="relative aspect-video bg-zinc-950 flex items-center justify-center">
                  {f.hasFrame && f.storyboardUrl ? (
                    /* eslint-disable-next-line @next/next/no-img-element */
                    <img src={f.storyboardUrl} alt={`frame ${f.position}`} className="w-full h-full object-cover" />
                  ) : (
                    <Link2 className="w-5 h-5 text-zinc-700" />
                  )}
                  <span className="absolute top-1 left-1 text-[10px] font-bold bg-black/70 text-fuchsia-300 px-1.5 py-0.5 rounded">
                    {f.position}
                  </span>
                </div>
                <div className="p-1.5">
                  <p className="text-[11px] text-zinc-100 truncate">
                    <span className="font-semibold">{f.size}</span> · {f.movement}
                  </p>
                  {f.description && <p className="text-[10px] text-zinc-400 truncate">{f.description}</p>}
                  <div className="flex items-center gap-1 mt-1">
                    <button aria-label="Collapse" type="button" onClick={() => moveBoardFrame(idx, -1)} disabled={idx === 0}
                      className="flex-1 flex items-center justify-center bg-zinc-800 hover:bg-zinc-700 disabled:opacity-30 rounded py-0.5">
                      <ChevronUp className="w-3 h-3 text-zinc-300" />
                    </button>
                    <button aria-label="Expand" type="button" onClick={() => moveBoardFrame(idx, 1)} disabled={idx === board.length - 1}
                      className="flex-1 flex items-center justify-center bg-zinc-800 hover:bg-zinc-700 disabled:opacity-30 rounded py-0.5">
                      <ChevronDown className="w-3 h-3 text-zinc-300" />
                    </button>
                  </div>
                </div>
              </div>
            ))}
          </div>
        )
      )}
    </div>
  );
}
