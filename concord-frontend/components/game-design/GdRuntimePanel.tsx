'use client';

/**
 * GdRuntimePanel — playable in-browser runtime. Compiles a designed
 * level into a runtime scene (collision grid, spawn, actors) via the
 * runtime-compile macro, then steps a deterministic platformer
 * simulation on a <canvas>. Real session outcomes are reported back
 * through playtest-record, and playtest-report aggregates measured
 * runs into a balance verdict — closing the design -> playtest ->
 * rebalance loop with data, not guesses.
 *
 * Also surfaces the collision/physics config editor for the level
 * (which tiles / IntGrid values are solid or hazardous, and gravity).
 */

import { useCallback, useEffect, useRef, useState } from 'react';
import { Loader2, Play, Square, ShieldAlert, Gamepad2, BarChart3, RotateCcw } from 'lucide-react';
import { lensRun } from '@/lib/api/client';
import { cn } from '@/lib/utils';

interface LevelMeta { id: string; name: string; cols: number; rows: number }
interface Tile { id: string; name: string; color: string }
interface Actor {
  id: string; name: string; x: number; y: number; w: number; h: number;
  kind: string; health: number; damage: number; color: string;
}
interface Scene {
  levelId: string; levelName: string; gameTitle: string;
  cols: number; rows: number; tileSize: number; gravity: number;
  tilemap: { name: string; opacity: number; data: (string | number | null)[] }[];
  collision: { solid: boolean[]; hazard: boolean[]; solidCount: number; hazardCount: number };
  spawn: { x: number; y: number };
  actors: Actor[];
  mechanics: string[];
}
interface Collision {
  gravity: number; solidInts: number[]; hazardInts: number[];
  solidTiles: string[]; hazardTiles: string[];
}
interface PlaytestReport {
  message?: string; runs: number; completed?: number; died?: number; quit?: number;
  completionRate?: number; avgDurationMs?: number; medianDurationMs?: number;
  avgDeaths?: number; avgDamageDealt?: number; avgDamageTaken?: number;
  avgCollected?: number; avgFurthestX?: number;
  difficultyVerdict?: string; rebalanceHint?: string;
}

const TILE_COLORS: Record<string, string> = {
  grass: '#4ade80', dirt: '#a16207', stone: '#71717a', sand: '#fde047', water: '#38bdf8',
  snow: '#e2e8f0', wall: '#44403c', floor: '#d6d3d1', door: '#92400e', bridge: '#b45309',
  lava: '#f97316', spike: '#ef4444', pit: '#1c1917', spawn: '#22c55e', exit: '#a855f7',
  chest: '#eab308', checkpoint: '#06b6d4',
};
const CANVAS_W = 480;
const CANVAS_H = 320;

export function GdRuntimePanel({ gameId, onChange }: { gameId: string; onChange: () => void }) {
  const [levels, setLevels] = useState<LevelMeta[]>([]);
  const [tiles, setTiles] = useState<Tile[]>([]);
  const [levelId, setLevelId] = useState('');
  const [scene, setScene] = useState<Scene | null>(null);
  const [collision, setCollision] = useState<Collision | null>(null);
  const [report, setReport] = useState<PlaytestReport | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [running, setRunning] = useState(false);
  const [status, setStatus] = useState<string>('');

  const canvasRef = useRef<HTMLCanvasElement>(null);
  const rafRef = useRef<number | null>(null);
  // Mutable simulation state — kept off React to run at 60fps.
  const simRef = useRef({
    x: 0, y: 0, vx: 0, vy: 0, grounded: false,
    deaths: 0, damageTaken: 0, collected: 0, furthestX: 0, startMs: 0,
  });
  const keysRef = useRef<Record<string, boolean>>({});

  const refresh = useCallback(async () => {
    setLoading(true);
    const [lv, tl] = await Promise.all([
      lensRun('game-design', 'level-list', { gameId }),
      lensRun('game-design', 'tile-list', { gameId }),
    ]);
    const list: LevelMeta[] = lv.data?.result?.levels || [];
    setLevels(list);
    setTiles(tl.data?.result?.all || []);
    setLevelId((prev) => (list.some((l) => l.id === prev) ? prev : list[0]?.id || ''));
    setLoading(false);
    onChange();
  }, [gameId, onChange]);

  useEffect(() => { void refresh(); }, [refresh]);

  const loadCollision = useCallback(async (id: string) => {
    if (!id) { setCollision(null); return; }
    const r = await lensRun('game-design', 'level-collision-get', { levelId: id });
    setCollision((r.data?.result?.collision as Collision) || null);
  }, []);

  const loadReport = useCallback(async (id: string) => {
    if (!id) { setReport(null); return; }
    const r = await lensRun('game-design', 'playtest-report', { gameId, levelId: id });
    setReport((r.data?.result as PlaytestReport) || null);
  }, [gameId]);

  useEffect(() => { void loadCollision(levelId); void loadReport(levelId); }, [levelId, loadCollision, loadReport]);

  const tileColor = useCallback((id: string | number | null): string | null => {
    if (id == null || id === 0) return null;
    const k = String(id);
    if (TILE_COLORS[k]) return TILE_COLORS[k];
    const t = tiles.find((x) => x.id === k);
    return t?.color || null;
  }, [tiles]);

  const compile = useCallback(async () => {
    if (!levelId) return;
    const r = await lensRun('game-design', 'runtime-compile', { levelId });
    if (r.data?.ok === false) { setError(r.data?.error || 'Compile failed'); return; }
    setError(null);
    setScene((r.data?.result?.scene as Scene) || null);
  }, [levelId]);

  // Draw one frame of the scene + the player.
  const draw = useCallback(() => {
    const cv = canvasRef.current;
    const sc = scene;
    if (!cv || !sc) return;
    const ctx = cv.getContext('2d');
    if (!ctx) return;
    const ts = sc.tileSize;
    const worldW = sc.cols * ts;
    const worldH = sc.rows * ts;
    const sim = simRef.current;
    // Camera follows the player.
    const camX = Math.max(0, Math.min(worldW - CANVAS_W, sim.x - CANVAS_W / 2));
    const camY = Math.max(0, Math.min(worldH - CANVAS_H, sim.y - CANVAS_H / 2));
    ctx.fillStyle = '#09090b';
    ctx.fillRect(0, 0, CANVAS_W, CANVAS_H);
    // Tilemap layers.
    for (const layer of sc.tilemap) {
      ctx.globalAlpha = layer.opacity ?? 1;
      for (let i = 0; i < layer.data.length; i++) {
        const col = tileColor(layer.data[i]);
        if (!col) continue;
        const cx = (i % sc.cols) * ts - camX;
        const cy = Math.floor(i / sc.cols) * ts - camY;
        if (cx < -ts || cx > CANVAS_W || cy < -ts || cy > CANVAS_H) continue;
        ctx.fillStyle = col;
        ctx.fillRect(cx, cy, ts, ts);
      }
    }
    ctx.globalAlpha = 1;
    // Hazard overlay.
    for (let i = 0; i < sc.collision.hazard.length; i++) {
      if (!sc.collision.hazard[i]) continue;
      const cx = (i % sc.cols) * ts - camX;
      const cy = Math.floor(i / sc.cols) * ts - camY;
      ctx.strokeStyle = '#ef4444';
      ctx.strokeRect(cx + 1, cy + 1, ts - 2, ts - 2);
    }
    // Actors.
    for (const a of sc.actors) {
      ctx.fillStyle = a.color || '#a3e635';
      ctx.fillRect(a.x - camX, a.y - camY, a.w, a.h);
    }
    // Player.
    ctx.fillStyle = '#84cc16';
    ctx.fillRect(sim.x - camX, sim.y - camY, ts * 0.8, ts * 0.9);
  }, [scene, tileColor]);

  // Finish a run and report the outcome.
  const finishRun = useCallback(async (outcome: 'completed' | 'died' | 'quit') => {
    const sc = scene;
    if (!sc) return;
    setRunning(false);
    if (rafRef.current) { cancelAnimationFrame(rafRef.current); rafRef.current = null; }
    const sim = simRef.current;
    const durationMs = sim.startMs ? Date.now() - sim.startMs : 0;
    setStatus(outcome === 'completed' ? 'Reached the exit!' : outcome === 'died' ? 'You died.' : 'Run ended.');
    await lensRun('game-design', 'playtest-record', {
      gameId, levelId: sc.levelId, outcome, durationMs,
      deaths: sim.deaths, damageTaken: sim.damageTaken,
      damageDealt: 0, collected: sim.collected,
      furthestX: Math.round(sim.furthestX),
    });
    await loadReport(sc.levelId);
  }, [scene, gameId, loadReport]);

  // The physics + game step.
  const stepSim = useCallback(() => {
    const sc = scene;
    if (!sc) return;
    const sim = simRef.current;
    const ts = sc.tileSize;
    const keys = keysRef.current;
    const SPEED = ts * 0.18;
    const JUMP = -(Math.sqrt(2 * (sc.gravity / 3600) * ts * 3.2));
    const GRAV = sc.gravity / 3600;

    if (keys['ArrowLeft'] || keys['a']) sim.vx = -SPEED;
    else if (keys['ArrowRight'] || keys['d']) sim.vx = SPEED;
    else sim.vx = 0;
    if ((keys['ArrowUp'] || keys[' '] || keys['w']) && sim.grounded) { sim.vy = JUMP; sim.grounded = false; }
    sim.vy += GRAV;
    if (sim.vy > ts * 0.5) sim.vy = ts * 0.5;

    const pw = ts * 0.8;
    const ph = ts * 0.9;
    const solidAt = (px: number, py: number): boolean => {
      if (px < 0 || py < 0) return true;
      const c = Math.floor(px / ts);
      const r = Math.floor(py / ts);
      if (c >= sc.cols || r >= sc.rows) return true;
      return !!sc.collision.solid[r * sc.cols + c];
    };
    const hazardAt = (px: number, py: number): boolean => {
      const c = Math.floor(px / ts);
      const r = Math.floor(py / ts);
      if (c < 0 || r < 0 || c >= sc.cols || r >= sc.rows) return false;
      return !!sc.collision.hazard[r * sc.cols + c];
    };

    // Horizontal move with collision.
    let nx = sim.x + sim.vx;
    if (sim.vx !== 0) {
      const edge = sim.vx > 0 ? nx + pw : nx;
      if (solidAt(edge, sim.y + 2) || solidAt(edge, sim.y + ph - 2)) {
        nx = sim.x;
        sim.vx = 0;
      }
    }
    sim.x = nx;

    // Vertical move with collision.
    let ny = sim.y + sim.vy;
    sim.grounded = false;
    if (sim.vy > 0) {
      const foot = ny + ph;
      if (solidAt(sim.x + 2, foot) || solidAt(sim.x + pw - 2, foot)) {
        ny = Math.floor(foot / ts) * ts - ph;
        sim.vy = 0;
        sim.grounded = true;
      }
    } else if (sim.vy < 0) {
      if (solidAt(sim.x + 2, ny) || solidAt(sim.x + pw - 2, ny)) {
        ny = Math.ceil(ny / ts) * ts;
        sim.vy = 0;
      }
    }
    sim.y = ny;
    sim.furthestX = Math.max(sim.furthestX, sim.x);

    // Hazard contact -> death.
    if (hazardAt(sim.x + pw / 2, sim.y + ph / 2)) {
      sim.deaths += 1;
      sim.damageTaken += 100;
      void finishRun('died');
      return;
    }
    // Fell out of the world -> death.
    if (sim.y > sc.rows * ts + ts * 2) {
      sim.deaths += 1;
      void finishRun('died');
      return;
    }
    // Reached an exit tile -> completed.
    const pc = Math.floor((sim.x + pw / 2) / ts);
    const pr = Math.floor((sim.y + ph / 2) / ts);
    if (pc >= 0 && pr >= 0 && pc < sc.cols && pr < sc.rows) {
      for (const layer of sc.tilemap) {
        if (String(layer.data[pr * sc.cols + pc]) === 'exit') {
          void finishRun('completed');
          return;
        }
        if (String(layer.data[pr * sc.cols + pc]) === 'chest') {
          // Mutate the tile so a chest is only collected once.
          layer.data[pr * sc.cols + pc] = null;
          sim.collected += 1;
        }
      }
    }
    draw();
    rafRef.current = requestAnimationFrame(stepSim);
  }, [scene, draw, finishRun]);

  const startRun = useCallback(() => {
    const sc = scene;
    if (!sc) return;
    simRef.current = {
      x: sc.spawn.x, y: sc.spawn.y, vx: 0, vy: 0, grounded: false,
      deaths: 0, damageTaken: 0, collected: 0, furthestX: sc.spawn.x, startMs: Date.now(),
    };
    setStatus('Playing — arrows / WASD to move, up to jump.');
    setRunning(true);
    rafRef.current = requestAnimationFrame(stepSim);
  }, [scene, stepSim]);

  // Keyboard capture while a run is active.
  useEffect(() => {
    if (!running) return;
    const dn = (e: KeyboardEvent) => {
      if (['ArrowLeft', 'ArrowRight', 'ArrowUp', ' '].includes(e.key)) e.preventDefault();
      keysRef.current[e.key] = true;
    };
    const up = (e: KeyboardEvent) => { keysRef.current[e.key] = false; };
    window.addEventListener('keydown', dn);
    window.addEventListener('keyup', up);
    return () => { window.removeEventListener('keydown', dn); window.removeEventListener('keyup', up); };
  }, [running]);

  useEffect(() => () => { if (rafRef.current) cancelAnimationFrame(rafRef.current); }, []);
  useEffect(() => { draw(); }, [scene, draw]);

  const saveCollision = async (patch: Partial<Collision>) => {
    if (!levelId || !collision) return;
    const next = { ...collision, ...patch };
    setCollision(next);
    await lensRun('game-design', 'level-collision-set', { levelId, ...next });
  };

  const toggleInList = (list: (string | number)[], v: string | number) =>
    (list.includes(v) ? list.filter((x) => x !== v) : [...list, v]);

  const clearPlaytests = async () => {
    if (!levelId) return;
    await lensRun('game-design', 'playtest-clear', { gameId, levelId });
    await loadReport(levelId);
  };

  if (loading) {
    return <div className="flex items-center justify-center py-10 text-zinc-400"><Loader2 className="w-5 h-5 animate-spin" /></div>;
  }

  if (levels.length === 0) {
    return <p className="text-[11px] text-zinc-400 italic py-6 text-center">Create a level in the Levels tab to play it.</p>;
  }

  return (
    <div className="space-y-4">
      {error && <div className="text-xs text-rose-400 bg-rose-950/40 border border-rose-900/50 rounded-lg px-3 py-2">{error}</div>}

      <div className="flex items-center gap-2">
        <select value={levelId} onChange={(e) => { setLevelId(e.target.value); setScene(null); setStatus(''); }}
          className="bg-zinc-950 border border-zinc-700 rounded-lg px-2 py-1.5 text-xs text-zinc-100">
          {levels.map((l) => <option key={l.id} value={l.id}>{l.name}</option>)}
        </select>
        <button type="button" onClick={compile}
          className="flex items-center gap-1 px-3 py-1.5 text-xs bg-zinc-800 hover:bg-zinc-700 text-zinc-200 rounded-lg">
          <RotateCcw className="w-3.5 h-3.5" /> Compile
        </button>
        {scene && !running && (
          <button type="button" onClick={startRun}
            className="flex items-center gap-1 px-3 py-1.5 text-xs font-medium bg-lime-600 hover:bg-lime-500 text-white rounded-lg">
            <Play className="w-3.5 h-3.5" /> Play
          </button>
        )}
        {running && (
          <button type="button" onClick={() => finishRun('quit')}
            className="flex items-center gap-1 px-3 py-1.5 text-xs bg-rose-700 hover:bg-rose-600 text-white rounded-lg">
            <Square className="w-3.5 h-3.5" /> Stop
          </button>
        )}
      </div>

      {/* Runtime canvas */}
      <section className="bg-zinc-900/70 border border-zinc-800 rounded-xl p-3 space-y-2">
        <div className="flex items-center gap-2 text-[11px] text-zinc-400">
          <Gamepad2 className="w-3.5 h-3.5 text-lime-400" />
          {scene ? (
            <span>
              {scene.gameTitle} · {scene.levelName} · {scene.collision.solidCount} solid · {scene.collision.hazardCount} hazard · {scene.actors.length} actors
            </span>
          ) : (
            <span>Compile a level to build a runnable scene.</span>
          )}
        </div>
        <canvas ref={canvasRef} width={CANVAS_W} height={CANVAS_H}
          className="w-full max-w-[480px] mx-auto rounded-lg border border-zinc-800 bg-zinc-950" />
        {status && <p className="text-[11px] text-lime-400 text-center">{status}</p>}
        {scene && scene.mechanics.length > 0 && (
          <div className="flex flex-wrap justify-center gap-1">
            {scene.mechanics.map((m) => <span key={m} className="text-[9px] px-1.5 rounded bg-zinc-800 text-zinc-400">{m}</span>)}
          </div>
        )}
      </section>

      {/* Collision / physics config */}
      {collision && (
        <section className="bg-zinc-900/70 border border-zinc-800 rounded-xl p-3 space-y-2">
          <div className="flex items-center gap-2 text-[11px] font-semibold text-zinc-200">
            <ShieldAlert className="w-3.5 h-3.5 text-amber-400" /> Collision &amp; physics
          </div>
          <label className="flex items-center gap-2 text-[11px] text-zinc-400">
            gravity
            <input type="number" min={0} max={4000} value={collision.gravity}
              onChange={(e) => saveCollision({ gravity: Number(e.target.value) || 0 })}
              className="w-20 bg-zinc-950 border border-zinc-700 rounded px-1.5 py-0.5 text-[11px] text-zinc-100" />
          </label>
          <div className="space-y-1">
            <p className="text-[10px] text-zinc-400 uppercase">Solid tiles</p>
            <div className="flex flex-wrap gap-1">
              {tiles.map((t) => (
                <button key={t.id} type="button"
                  onClick={() => saveCollision({ solidTiles: toggleInList(collision.solidTiles, t.id) as string[] })}
                  className={cn('flex items-center gap-1 text-[10px] px-1.5 py-0.5 rounded border',
                    collision.solidTiles.includes(t.id) ? 'border-lime-500 bg-lime-950/40 text-lime-300' : 'border-zinc-700 text-zinc-400')}>
                  <span className="w-2.5 h-2.5 rounded-sm" style={{ background: t.color }} /> {t.name}
                </button>
              ))}
            </div>
          </div>
          <div className="space-y-1">
            <p className="text-[10px] text-zinc-400 uppercase">Hazard tiles</p>
            <div className="flex flex-wrap gap-1">
              {tiles.map((t) => (
                <button key={t.id} type="button"
                  onClick={() => saveCollision({ hazardTiles: toggleInList(collision.hazardTiles, t.id) as string[] })}
                  className={cn('flex items-center gap-1 text-[10px] px-1.5 py-0.5 rounded border',
                    collision.hazardTiles.includes(t.id) ? 'border-rose-500 bg-rose-950/40 text-rose-300' : 'border-zinc-700 text-zinc-400')}>
                  <span className="w-2.5 h-2.5 rounded-sm" style={{ background: t.color }} /> {t.name}
                </button>
              ))}
            </div>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1">
              <p className="text-[10px] text-zinc-400 uppercase">Solid IntGrid values</p>
              <div className="flex flex-wrap gap-1">
                {Array.from({ length: 9 }, (_, i) => i + 1).map((v) => (
                  <button key={v} type="button"
                    onClick={() => saveCollision({ solidInts: toggleInList(collision.solidInts, v) as number[] })}
                    className={cn('text-[10px] w-6 h-6 rounded border',
                      collision.solidInts.includes(v) ? 'border-lime-500 bg-lime-950/40 text-lime-300' : 'border-zinc-700 text-zinc-400')}>
                    {v}
                  </button>
                ))}
              </div>
            </div>
            <div className="space-y-1">
              <p className="text-[10px] text-zinc-400 uppercase">Hazard IntGrid values</p>
              <div className="flex flex-wrap gap-1">
                {Array.from({ length: 9 }, (_, i) => i + 1).map((v) => (
                  <button key={v} type="button"
                    onClick={() => saveCollision({ hazardInts: toggleInList(collision.hazardInts, v) as number[] })}
                    className={cn('text-[10px] w-6 h-6 rounded border',
                      collision.hazardInts.includes(v) ? 'border-rose-500 bg-rose-950/40 text-rose-300' : 'border-zinc-700 text-zinc-400')}>
                    {v}
                  </button>
                ))}
              </div>
            </div>
          </div>
        </section>
      )}

      {/* Playtest report — closes the balance loop with measured runs */}
      <section className="bg-zinc-900/70 border border-zinc-800 rounded-xl p-3 space-y-2">
        <div className="flex items-center gap-2">
          <BarChart3 className="w-3.5 h-3.5 text-sky-400" />
          <span className="text-[11px] font-semibold text-zinc-200">Playtest analytics</span>
          <div className="flex-1" />
          {report && (report.runs || 0) > 0 && (
            <button type="button" onClick={clearPlaytests}
              className="text-[10px] text-zinc-400 hover:text-rose-400">clear runs</button>
          )}
        </div>
        {!report || report.message ? (
          <p className="text-[11px] text-zinc-400 italic">{report?.message || 'No playtest runs recorded yet. Play a level to gather data.'}</p>
        ) : (
          <>
            <div className="grid grid-cols-3 sm:grid-cols-6 gap-2">
              <Metric label="Runs" value={report.runs} />
              <Metric label="Completed" value={report.completed ?? 0} />
              <Metric label="Died" value={report.died ?? 0} />
              <Metric label="Completion" value={`${report.completionRate ?? 0}%`} />
              <Metric label="Avg deaths" value={report.avgDeaths ?? 0} />
              <Metric label="Median ms" value={report.medianDurationMs ?? 0} />
            </div>
            {report.difficultyVerdict && (
              <p className={cn('text-[11px]',
                report.difficultyVerdict.includes('well-tuned') ? 'text-emerald-400' : 'text-amber-400')}>
                {report.difficultyVerdict}
              </p>
            )}
            {report.rebalanceHint && (
              <p className="text-[11px] text-zinc-400">Rebalance: <span className="text-zinc-200">{report.rebalanceHint}</span></p>
            )}
          </>
        )}
      </section>
    </div>
  );
}

function Metric({ label, value }: { label: string; value: string | number }) {
  return (
    <div className="text-center bg-zinc-950/60 border border-zinc-800 rounded-lg py-1.5">
      <p className="text-sm font-bold text-zinc-100">{value}</p>
      <p className="text-[9px] text-zinc-400 uppercase tracking-wide">{label}</p>
    </div>
  );
}
