'use client';

import { useState, useCallback } from 'react';
import { lensRun } from '@/lib/api/client';
import { Route, Play, Eraser, Flag, Crosshair, Loader2 } from 'lucide-react';

interface Cell { x: number; y: number }
interface GridPlanResult {
  found: boolean; path: Cell[]; length: number; cost: number | null;
  grid: { width: number; height: number }; start: Cell; goal: Cell;
  obstacleCount: number; expansions: number; algorithm: string;
}

type Tool = 'obstacle' | 'start' | 'goal';
const GRID_W = 22;
const GRID_H = 16;
const CELL = 22;

/**
 * PathPlanner — A* path planning on a 2D occupancy grid. Wires
 * robotics.gridPlan. Paint obstacles, set start/goal, see planned path.
 */
export function PathPlanner() {
  const [obstacles, setObstacles] = useState<Set<string>>(new Set());
  const [start, setStart] = useState<Cell>({ x: 1, y: 1 });
  const [goal, setGoal] = useState<Cell>({ x: GRID_W - 2, y: GRID_H - 2 });
  const [tool, setTool] = useState<Tool>('obstacle');
  const [result, setResult] = useState<GridPlanResult | null>(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const key = (x: number, y: number) => `${x},${y}`;
  const pathSet = new Set((result?.path || []).map(p => key(p.x, p.y)));

  const onCell = (x: number, y: number) => {
    if (tool === 'start') { setStart({ x, y }); return; }
    if (tool === 'goal') { setGoal({ x, y }); return; }
    setObstacles(prev => {
      const next = new Set(prev);
      const k = key(x, y);
      if (next.has(k)) next.delete(k); else next.add(k);
      return next;
    });
    setResult(null);
  };

  const plan = useCallback(async () => {
    setBusy(true); setErr(null);
    const obs = [...obstacles].map(k => { const [x, y] = k.split(',').map(Number); return { x, y }; });
    const r = await lensRun('robotics', 'gridPlan', {
      width: GRID_W, height: GRID_H,
      startX: start.x, startY: start.y, goalX: goal.x, goalY: goal.y,
      obstacles: obs,
    });
    if (r.data?.ok && r.data.result) setResult(r.data.result as GridPlanResult);
    else setErr(r.data?.error || 'Path planning failed');
    setBusy(false);
  }, [obstacles, start, goal]);

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between flex-wrap gap-2">
        <h3 className="font-semibold text-sm flex items-center gap-2">
          <Route className="w-4 h-4 text-neon-cyan" /> Path Planner — A* Grid
        </h3>
        <div className="flex gap-1.5">
          {([
            { id: 'obstacle' as Tool, label: 'Obstacle', icon: Eraser },
            { id: 'start' as Tool, label: 'Start', icon: Crosshair },
            { id: 'goal' as Tool, label: 'Goal', icon: Flag },
          ]).map(t => {
            const Icon = t.icon;
            return (
              <button key={t.id} onClick={() => setTool(t.id)}
                className={`px-2.5 py-1 rounded text-xs font-medium flex items-center gap-1 ${tool === t.id ? 'bg-neon-cyan/20 text-neon-cyan' : 'bg-white/5 text-gray-400 hover:text-white'}`}>
                <Icon className="w-3 h-3" /> {t.label}
              </button>
            );
          })}
        </div>
      </div>

      <div className="panel p-2 bg-black/40 overflow-x-auto">
        <svg width={GRID_W * CELL} height={GRID_H * CELL} className="mx-auto block">
          {Array.from({ length: GRID_H }).map((_, y) =>
            Array.from({ length: GRID_W }).map((_, x) => {
              const k = key(x, y);
              const isObs = obstacles.has(k);
              const isStart = start.x === x && start.y === y;
              const isGoal = goal.x === x && goal.y === y;
              const isPath = pathSet.has(k) && !isStart && !isGoal;
              let fill = '#0a0a0a';
              if (isObs) fill = '#52525b';
              else if (isStart) fill = '#22c55e';
              else if (isGoal) fill = '#ef4444';
              else if (isPath) fill = '#22d3ee';
              return (
                <rect key={k} x={x * CELL} y={y * CELL} width={CELL - 1} height={CELL - 1}
                  fill={fill} stroke="#27272a" strokeWidth={0.5}
                  className="cursor-pointer hover:opacity-80"
                  onClick={() => onCell(x, y)} />
              );
            })
          )}
        </svg>
        <p className="text-[11px] text-gray-400 text-center pt-1">
          Click cells to paint with the selected tool, then plan a path.
        </p>
      </div>

      <div className="flex items-center gap-2">
        <button onClick={plan} disabled={busy}
          className="px-3 py-1.5 bg-neon-cyan/20 text-neon-cyan rounded text-sm hover:bg-neon-cyan/30 disabled:opacity-50 flex items-center gap-1.5">
          {busy ? <Loader2 className="w-4 h-4 animate-spin" /> : <Play className="w-4 h-4" />} Plan Path
        </button>
        <button onClick={() => { setObstacles(new Set()); setResult(null); }}
          className="px-3 py-1.5 bg-white/5 text-gray-300 rounded text-sm hover:bg-white/10">
          Clear obstacles
        </button>
      </div>

      {err && <p className="text-xs text-red-400">{err}</p>}

      {result && (
        <div className="panel p-3 grid grid-cols-2 md:grid-cols-5 gap-3 text-center text-xs">
          <div>
            <p className={`text-lg font-bold ${result.found ? 'text-green-400' : 'text-red-400'}`}>{result.found ? 'FOUND' : 'BLOCKED'}</p>
            <p className="text-gray-400">Result</p>
          </div>
          <div><p className="text-lg font-bold font-mono">{result.length}</p><p className="text-gray-400">Path cells</p></div>
          <div><p className="text-lg font-bold font-mono">{result.cost ?? '—'}</p><p className="text-gray-400">Cost</p></div>
          <div><p className="text-lg font-bold font-mono">{result.expansions}</p><p className="text-gray-400">Expansions</p></div>
          <div><p className="text-lg font-bold font-mono">{result.obstacleCount}</p><p className="text-gray-400">Obstacles</p></div>
        </div>
      )}
    </div>
  );
}
