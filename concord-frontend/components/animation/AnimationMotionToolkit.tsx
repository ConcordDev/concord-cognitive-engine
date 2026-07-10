'use client';

/**
 * AnimationMotionToolkit — structured input UI for the 4 stateless "motion
 * planning" macros in the animation domain (interpolateKeyframes,
 * timingAnalysis, optimizeFPS, storyboardSequence). These are genuine,
 * distinct compute utilities (a motion designer's keyframe/timing/FPS/
 * storyboard calculators) — NOT superseded by the frame-by-frame Studio
 * substrate, which operates on the app's own persisted frames instead of an
 * abstract keyframe/sequence/scene sketch.
 *
 * Pre-rebuild, these 4 macros were reachable only via buttons that always
 * ran against a fake, disconnected "project" artifact whose `data` never
 * carried `keyframes`/`sequences`/`scenes` — so every call hit the macro's
 * own honest "add data" fallback message. There was no way to actually
 * supply input. This component is real, structured multi-row input (no
 * JSON-paste, no hidden fake project) — every field here maps directly onto
 * the macro's `artifact.data` shape and is a real macro call via
 * useMacroDispatchFeedback.
 */

import { useState } from 'react';
import {
  Spline, Timer, Monitor, BookOpen, Plus, Trash2, Sparkles, AlertTriangle,
} from 'lucide-react';
import { useMacroDispatchFeedback } from '@/hooks/useMacroDispatchFeedback';
import { cn } from '@/lib/utils';

type ToolId = 'interpolate' | 'timing' | 'fps' | 'storyboard';

const TOOLS: { id: ToolId; label: string; icon: typeof Spline; macro: string; blurb: string }[] = [
  { id: 'interpolate', label: 'Keyframe Interpolation', icon: Spline, macro: 'interpolateKeyframes', blurb: 'Sample a per-frame value curve between hand-placed keyframes at a given fps.' },
  { id: 'timing', label: 'Timing Analysis', icon: Timer, macro: 'timingAnalysis', blurb: 'Check total duration, frame budget, and overlaps across a set of named sequences.' },
  { id: 'fps', label: 'FPS Optimizer', icon: Monitor, macro: 'optimizeFPS', blurb: 'Recommend a frame rate for a target device given a scene complexity estimate.' },
  { id: 'storyboard', label: 'Storyboard Sequencer', icon: BookOpen, macro: 'storyboardSequence', blurb: 'Lay out scene start/end times from per-scene duration + transition length.' },
];

const EASINGS = ['linear', 'ease-in', 'ease-out', 'ease-in-out', 'ease-in-cubic', 'ease-out-cubic', 'bounce-out'];

function fieldClass() {
  return 'bg-zinc-950 border border-zinc-700 rounded px-2 py-1 text-xs text-zinc-100 placeholder:text-zinc-600 w-full';
}

// ── Keyframe rows ──────────────────────────────────────────────────────
interface KeyframeRow { time: string; value: string }
function KeyframeTool() {
  const [rows, setRows] = useState<KeyframeRow[]>([{ time: '0', value: '0' }, { time: '1', value: '100' }]);
  const [fps, setFps] = useState('24');
  const dispatch = useMacroDispatchFeedback<{
    keyframeCount: number; fps: number; totalFrames: number; durationSeconds: number;
    sampleFrames: { frame: number; time: number; value: number }[]; message?: string;
  }>();

  const run = () => {
    const keyframes = rows
      .map((r) => ({ time: parseFloat(r.time), value: parseFloat(r.value) }))
      .filter((r) => Number.isFinite(r.time) && Number.isFinite(r.value));
    void dispatch.dispatch('animation', 'interpolateKeyframes', { keyframes, fps: parseInt(fps, 10) || 24 });
  };

  const busy = dispatch.status === 'dispatched' || dispatch.status === 'running';
  const r = dispatch.status === 'done' ? dispatch.result : null;

  return (
    <div className="space-y-3">
      <RowTable
        rows={rows}
        setRows={setRows}
        newRow={() => ({ time: '0', value: '0' })}
        columns={[
          { key: 'time', label: 'Time (s)', type: 'number' },
          { key: 'value', label: 'Value', type: 'number' },
        ]}
      />
      <div className="flex items-center gap-2">
        <label className="flex items-center gap-1.5 text-[11px] text-zinc-400">
          fps
          <input type="number" min={1} max={60} value={fps} onChange={(e) => setFps(e.target.value)} className={cn(fieldClass(), 'w-16')} />
        </label>
        <button type="button" onClick={run} disabled={busy || rows.length < 2}
          className="px-3 py-1.5 text-xs bg-cyan-600 hover:bg-cyan-500 disabled:opacity-50 text-white rounded-lg">
          {busy ? 'Interpolating…' : 'Interpolate'}
        </button>
      </div>
      {dispatch.status === 'error' && <p className="text-xs text-rose-400">{dispatch.error}</p>}
      {r?.message && <p className="text-xs text-zinc-400 italic">{r.message}</p>}
      {r && r.totalFrames !== undefined && !r.message && (
        <div className="space-y-2 bg-zinc-950/50 rounded-lg p-3">
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
            <Stat label="Keyframes" value={r.keyframeCount} color="text-cyan-400" />
            <Stat label="FPS" value={r.fps} color="text-orange-400" />
            <Stat label="Total frames" value={r.totalFrames} color="text-purple-400" />
            <Stat label="Duration" value={`${r.durationSeconds}s`} color="text-green-400" />
          </div>
          {r.sampleFrames?.length > 0 && (
            <div className="flex items-end gap-1 h-16">
              {r.sampleFrames.map((f, i) => (
                <div key={i} className="flex-1 bg-cyan-400/30 rounded-t" style={{ height: `${Math.max(10, Math.min(100, Math.abs(f.value) * 2))}%` }} title={`Frame ${f.frame}: ${f.value}`} />
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

// ── Sequence rows (timing analysis) ─────────────────────────────────────
interface SeqRow { name: string; duration: string; delay: string; fps: string; easing: string }
function TimingTool() {
  const [rows, setRows] = useState<SeqRow[]>([
    { name: 'Intro', duration: '1', delay: '0', fps: '24', easing: 'ease-out' },
    { name: 'Hold', duration: '2', delay: '0.8', fps: '24', easing: 'linear' },
  ]);
  const dispatch = useMacroDispatchFeedback<{
    sequences: { name: string; duration: number; delay: number; easing: string }[];
    totalDuration: number; totalFrames: number; overlappingPairs: number; message?: string;
  }>();

  const run = () => {
    const sequences = rows
      .filter((r) => r.name.trim())
      .map((r) => ({ name: r.name.trim(), duration: parseFloat(r.duration) || 1, delay: parseFloat(r.delay) || 0, fps: parseInt(r.fps, 10) || 24, easing: r.easing }));
    void dispatch.dispatch('animation', 'timingAnalysis', { sequences });
  };

  const busy = dispatch.status === 'dispatched' || dispatch.status === 'running';
  const r = dispatch.status === 'done' ? dispatch.result : null;

  return (
    <div className="space-y-3">
      <RowTable
        rows={rows}
        setRows={setRows}
        newRow={() => ({ name: '', duration: '1', delay: '0', fps: '24', easing: 'linear' })}
        columns={[
          { key: 'name', label: 'Sequence name', type: 'text' },
          { key: 'duration', label: 'Duration (s)', type: 'number' },
          { key: 'delay', label: 'Delay (s)', type: 'number' },
          { key: 'fps', label: 'fps', type: 'number' },
          { key: 'easing', label: 'Easing', type: 'select', options: EASINGS },
        ]}
      />
      <button type="button" onClick={run} disabled={busy || rows.filter((r) => r.name.trim()).length === 0}
        className="px-3 py-1.5 text-xs bg-cyan-600 hover:bg-cyan-500 disabled:opacity-50 text-white rounded-lg">
        {busy ? 'Analyzing…' : 'Analyze timing'}
      </button>
      {dispatch.status === 'error' && <p className="text-xs text-rose-400">{dispatch.error}</p>}
      {r?.message && <p className="text-xs text-zinc-400 italic">{r.message}</p>}
      {r && r.totalDuration !== undefined && !r.message && (
        <div className="space-y-2 bg-zinc-950/50 rounded-lg p-3">
          <div className="grid grid-cols-3 gap-2">
            <Stat label="Total duration" value={`${r.totalDuration}s`} color="text-purple-400" />
            <Stat label="Total frames" value={r.totalFrames} color="text-cyan-400" />
            <Stat label="Overlaps" value={r.overlappingPairs} color="text-orange-400" />
          </div>
          {r.sequences.map((s, i) => (
            <div key={i} className="flex items-center gap-3 p-2 bg-zinc-900 rounded text-xs">
              <span className="text-white font-medium w-24 truncate">{s.name}</span>
              <span className="text-zinc-400">{s.duration}s</span>
              <span className="text-zinc-400">delay {s.delay}s</span>
              <span className="text-purple-400 ml-auto">{s.easing}</span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

// ── FPS optimizer ────────────────────────────────────────────────────────
function FpsTool() {
  const [fps, setFps] = useState('30');
  const [complexity, setComplexity] = useState(50);
  const [device, setDevice] = useState<'mobile' | 'tablet' | 'desktop' | 'highend'>('desktop');
  const dispatch = useMacroDispatchFeedback<{
    currentFPS: number; recommendedFPS: number; frameTimeMs: number; targetDevice: string;
    withinBudget: boolean; tips: string[];
  }>();

  const run = () => {
    void dispatch.dispatch('animation', 'optimizeFPS', { fps: parseInt(fps, 10) || 30, complexity, targetDevice: device });
  };
  const busy = dispatch.status === 'dispatched' || dispatch.status === 'running';
  const r = dispatch.status === 'done' ? dispatch.result : null;

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-end gap-3 bg-zinc-950/50 rounded-lg p-3">
        <label className="flex flex-col gap-1 text-[11px] text-zinc-400">
          Current fps
          <input type="number" min={1} max={240} value={fps} onChange={(e) => setFps(e.target.value)} className={cn(fieldClass(), 'w-20')} />
        </label>
        <label className="flex flex-col gap-1 text-[11px] text-zinc-400 flex-1 min-w-[160px]">
          Scene complexity {complexity}
          <input type="range" min={0} max={100} value={complexity} onChange={(e) => setComplexity(Number(e.target.value))} className="accent-cyan-500" />
        </label>
        <label className="flex flex-col gap-1 text-[11px] text-zinc-400">
          Target device
          <select value={device} onChange={(e) => setDevice(e.target.value as typeof device)} className={fieldClass()}>
            <option value="mobile">Mobile</option>
            <option value="tablet">Tablet</option>
            <option value="desktop">Desktop</option>
            <option value="highend">High-end</option>
          </select>
        </label>
        <button type="button" onClick={run} disabled={busy}
          className="px-3 py-1.5 text-xs bg-cyan-600 hover:bg-cyan-500 disabled:opacity-50 text-white rounded-lg">
          {busy ? 'Checking…' : 'Recommend FPS'}
        </button>
      </div>
      {dispatch.status === 'error' && <p className="text-xs text-rose-400">{dispatch.error}</p>}
      {r && (
        <div className="space-y-2 bg-zinc-950/50 rounded-lg p-3">
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
            <Stat label="Current" value={r.currentFPS} color="text-zinc-400" />
            <Stat label="Recommended" value={r.recommendedFPS} color="text-green-400" />
            <Stat label="Frame time" value={`${r.frameTimeMs}ms`} color="text-cyan-400" />
            <Stat label="Target" value={r.targetDevice} color="text-orange-400" />
          </div>
          <div className={cn('flex items-center gap-2 text-xs p-2 rounded', r.withinBudget ? 'bg-green-500/10 text-green-400' : 'bg-yellow-500/10 text-yellow-400')}>
            {r.withinBudget ? <Sparkles className="w-3 h-3" /> : <AlertTriangle className="w-3 h-3" />}
            {r.withinBudget ? 'Within performance budget' : 'Over complexity budget'}
          </div>
          {r.tips.map((tip, i) => (
            <div key={i} className="text-xs text-zinc-400 flex items-center gap-2"><span className="text-orange-400">-</span> {tip}</div>
          ))}
        </div>
      )}
    </div>
  );
}

// ── Storyboard rows ──────────────────────────────────────────────────────
interface SceneRow { name: string; duration: string; transitionDuration: string; description: string }
function StoryboardTool() {
  const [rows, setRows] = useState<SceneRow[]>([
    { name: 'Establishing shot', duration: '3', transitionDuration: '0.5', description: '' },
    { name: 'Close-up', duration: '2', transitionDuration: '0.5', description: '' },
    { name: 'Reaction', duration: '2', transitionDuration: '0.5', description: '' },
  ]);
  const dispatch = useMacroDispatchFeedback<{
    scenes: { scene: number; name: string; startTime: number; duration: number; description: string }[];
    totalDuration: number; sceneCount: number; avgSceneDuration: number; message?: string;
  }>();

  const run = () => {
    const scenes = rows
      .filter((r) => r.name.trim())
      .map((r) => ({ name: r.name.trim(), duration: parseFloat(r.duration) || 2, transitionDuration: parseFloat(r.transitionDuration) || 0.5, description: r.description }));
    void dispatch.dispatch('animation', 'storyboardSequence', { scenes });
  };
  const busy = dispatch.status === 'dispatched' || dispatch.status === 'running';
  const r = dispatch.status === 'done' ? dispatch.result : null;

  return (
    <div className="space-y-3">
      <RowTable
        rows={rows}
        setRows={setRows}
        newRow={() => ({ name: '', duration: '2', transitionDuration: '0.5', description: '' })}
        columns={[
          { key: 'name', label: 'Scene name', type: 'text' },
          { key: 'duration', label: 'Duration (s)', type: 'number' },
          { key: 'transitionDuration', label: 'Transition (s)', type: 'number' },
          { key: 'description', label: 'Description', type: 'text' },
        ]}
      />
      <button type="button" onClick={run} disabled={busy || rows.filter((r) => r.name.trim()).length === 0}
        className="px-3 py-1.5 text-xs bg-cyan-600 hover:bg-cyan-500 disabled:opacity-50 text-white rounded-lg">
        {busy ? 'Sequencing…' : 'Build sequence'}
      </button>
      {dispatch.status === 'error' && <p className="text-xs text-rose-400">{dispatch.error}</p>}
      {r?.message && <p className="text-xs text-zinc-400 italic">{r.message}</p>}
      {r && r.scenes !== undefined && !r.message && (
        <div className="space-y-2 bg-zinc-950/50 rounded-lg p-3">
          <div className="grid grid-cols-3 gap-2">
            <Stat label="Scenes" value={r.sceneCount} color="text-orange-400" />
            <Stat label="Total" value={`${r.totalDuration}s`} color="text-cyan-400" />
            <Stat label="Avg scene" value={`${r.avgSceneDuration}s`} color="text-purple-400" />
          </div>
          {r.scenes.map((s) => (
            <div key={s.scene} className="flex items-center gap-3 p-2 bg-zinc-900 rounded text-xs">
              <span className="text-orange-400 font-bold w-6 text-center">{s.scene}</span>
              <span className="text-white font-medium flex-1 truncate">{s.name}</span>
              <span className="text-zinc-400">{s.startTime}s</span>
              <span className="text-zinc-400">{s.duration}s</span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function Stat({ label, value, color }: { label: string; value: string | number; color: string }) {
  return (
    <div className="p-2 bg-zinc-900 rounded text-center">
      <p className={cn('text-sm font-bold', color)}>{value}</p>
      <p className="text-[10px] text-zinc-400">{label}</p>
    </div>
  );
}

// ── Generic row-table builder ────────────────────────────────────────────
interface Column { key: string; label: string; type: 'text' | 'number' | 'select'; options?: string[] }
function RowTable<T extends Record<string, string>>({
  rows, setRows, newRow, columns,
}: { rows: T[]; setRows: (r: T[]) => void; newRow: () => T; columns: Column[] }) {
  const update = (i: number, key: string, value: string) => {
    const next = rows.slice();
    next[i] = { ...next[i], [key]: value };
    setRows(next);
  };
  return (
    <div className="space-y-1.5">
      {rows.map((row, i) => (
        <div key={i} className="flex items-center gap-1.5">
          {columns.map((c) => (
            c.type === 'select' ? (
              <select key={c.key} value={row[c.key]} onChange={(e) => update(i, c.key, e.target.value)} className={fieldClass()} aria-label={c.label}>
                {(c.options || []).map((o) => <option key={o} value={o}>{o}</option>)}
              </select>
            ) : (
              <input key={c.key} type={c.type} value={row[c.key]} placeholder={c.label}
                onChange={(e) => update(i, c.key, e.target.value)} className={fieldClass()} aria-label={c.label} />
            )
          ))}
          <button type="button" aria-label="Remove row" onClick={() => setRows(rows.filter((_, j) => j !== i))}
            disabled={rows.length <= 1} className="text-zinc-600 hover:text-rose-400 disabled:opacity-30 shrink-0">
            <Trash2 className="w-3.5 h-3.5" />
          </button>
        </div>
      ))}
      <button type="button" onClick={() => setRows([...rows, newRow()])}
        className="flex items-center gap-1 text-[11px] text-cyan-400 hover:text-cyan-300">
        <Plus className="w-3.5 h-3.5" /> Add row
      </button>
    </div>
  );
}

export function AnimationMotionToolkit() {
  const [tool, setTool] = useState<ToolId>('interpolate');
  const active = TOOLS.find((t) => t.id === tool)!;

  return (
    <div className="space-y-3">
      <p className="text-xs text-zinc-400">
        Standalone motion-planning calculators — separate from your saved animation projects above.
        Every result is a real <code className="text-zinc-300">animation.{active.macro}</code> macro call
        against the rows you enter here, never a client-side estimate.
      </p>
      <div className="flex flex-wrap gap-1 bg-zinc-900/70 border border-zinc-800 rounded-lg p-1">
        {TOOLS.map((t) => (
          <button key={t.id} type="button" onClick={() => setTool(t.id)}
            className={cn('flex items-center gap-1.5 px-2.5 py-1.5 text-[11px] rounded-lg',
              tool === t.id ? 'bg-cyan-600 text-white' : 'text-zinc-400 hover:text-white hover:bg-white/5')}>
            <t.icon className="w-3.5 h-3.5" /> {t.label}
          </button>
        ))}
      </div>
      <p className="text-[11px] text-zinc-500 italic">{active.blurb}</p>
      <div className="bg-zinc-900/70 border border-zinc-800 rounded-xl p-3">
        {tool === 'interpolate' && <KeyframeTool />}
        {tool === 'timing' && <TimingTool />}
        {tool === 'fps' && <FpsTool />}
        {tool === 'storyboard' && <StoryboardTool />}
      </div>
    </div>
  );
}
