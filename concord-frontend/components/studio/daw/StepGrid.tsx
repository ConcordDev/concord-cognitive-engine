'use client';

import { useState } from 'react';
import type { DAWClip, DAWProject, DAWTrack, DrumPattern, DrumStep } from '@/lib/daw/types';
import { DRUM_LANES } from '@/lib/daw/presets';
import { emptyPattern } from '@/lib/daw/drum-steps';
import { newId } from '@/lib/daw/project';
import { cn } from '@/lib/utils';

const OFF: DrumStep = { active: false, velocity: 100, probability: 1, flam: false };

function sized(pattern: DrumPattern, steps: number): DrumPattern {
  const rows = DRUM_LANES.map((lane, i) => {
    const row = pattern.tracks[i];
    return {
      padId: row?.padId || lane.name,
      steps: Array.from({ length: steps }, (_, s) => row?.steps[s] || { ...OFF }),
    };
  });
  return { ...pattern, steps, resolution: pattern.resolution > 0 ? pattern.resolution : 0.25, tracks: rows };
}

export function StepGrid({ project, track, clip, onEdit }: {
  project: DAWProject;
  track: DAWTrack;
  clip: DAWClip;
  onEdit: (fn: (p: DAWProject) => DAWProject) => void;
}) {
  const pattern = clip.patternId ? project.drumPatterns?.[clip.patternId] : undefined;
  const [sel, setSel] = useState<{ row: number; step: number } | null>(null);
  const write = (next: DrumPattern) => onEdit((p) => ({
    ...p,
    drumPatterns: { ...(p.drumPatterns || {}), [next.id]: next },
    tracks: p.tracks.map((t) => t.id !== track.id ? t : {
      ...t,
      clips: t.clips.map((c) => c.id === clip.id ? { ...c, patternId: next.id } : c),
    }),
  }));
  if (!pattern) {
    return (
      <div className="flex h-full flex-col items-start gap-2 p-3 text-xs text-zinc-400">
        <p>Steps play instead of notes drawn on this clip. Make a pattern to start.</p>
        <button type="button" className="rounded bg-white/10 px-2 py-1 text-zinc-100" onClick={() => write(emptyPattern(newId('pat'), 16))}>Make 16-step pattern</button>
      </div>
    );
  }
  const current = sized(pattern, pattern.steps === 32 || pattern.steps === 64 ? pattern.steps : 16);
  const picked = sel ? current.tracks[sel.row]?.steps[sel.step] : undefined;
  const patchStep = (row: number, step: number, patch: Partial<DrumStep>) => {
    const next = sized(current, current.steps);
    const cell = { ...(next.tracks[row].steps[step] || OFF), ...patch };
    next.tracks[row].steps[step] = cell;
    write(next);
  };
  return (
    <div className="flex h-full min-h-0 flex-col gap-2 p-2">
      <div className="flex flex-wrap items-center gap-2 text-[11px] text-zinc-400">
        <span>This pattern plays instead of piano-roll notes.</span>
        <label>Steps
          <select aria-label="Step count" className="ml-1 rounded bg-black/40 px-1 py-0.5 text-zinc-100" value={current.steps} onChange={(e) => write(sized(current, Number(e.target.value)))}>
            {[16, 32, 64].map((n) => <option key={n} value={n}>{n}</option>)}
          </select>
        </label>
        <button type="button" className="rounded bg-white/10 px-2 py-0.5 text-zinc-200" onClick={() => onEdit((p) => ({
          ...p,
          tracks: p.tracks.map((t) => t.id !== track.id ? t : { ...t, clips: t.clips.map((c) => c.id === clip.id ? { ...c, patternId: undefined } : c) }),
        }))}>Use drawn notes</button>
      </div>
      <div className="min-h-0 flex-1 overflow-auto">
        {DRUM_LANES.map((lane, row) => (
          <div key={lane.pitch} className="mb-1 flex items-center gap-1">
            <span className="w-16 shrink-0 text-[10px] text-zinc-500">{lane.name}</span>
            <div className="flex flex-wrap gap-0.5">
              {current.tracks[row].steps.map((step, i) => (
                <button
                  key={i}
                  type="button"
                  aria-label={`${lane.name} step ${i + 1}${step.active ? ', on' : ', off'}`}
                  aria-pressed={step.active}
                  onClick={() => { setSel({ row, step: i }); patchStep(row, i, { active: !step.active }); }}
                  className={cn('h-5 w-5 rounded-sm', step.active ? 'bg-violet-400' : i % 4 === 0 ? 'bg-white/15' : 'bg-white/5', sel?.row === row && sel.step === i && 'ring-1 ring-white')}
                />
              ))}
            </div>
          </div>
        ))}
      </div>
      {picked && sel && (
        <div className="flex flex-wrap items-center gap-3 border-t border-white/5 pt-2 text-[10px] text-zinc-400">
          <label className="flex items-center gap-1">Velocity
            <input aria-label="Step velocity" type="range" min={1} max={127} value={picked.velocity || 100} onChange={(e) => patchStep(sel.row, sel.step, { velocity: Number(e.target.value) })} />
          </label>
          <label className="flex items-center gap-1">Probability
            <input aria-label="Step probability" type="range" min={0} max={100} value={Math.round((picked.probability ?? 1) * 100)} onChange={(e) => patchStep(sel.row, sel.step, { probability: Number(e.target.value) / 100 })} />
            <span>{Math.round((picked.probability ?? 1) * 100)}%</span>
          </label>
          <label className="flex items-center gap-1"><input aria-label="Flam" type="checkbox" checked={!!picked.flam} onChange={(e) => patchStep(sel.row, sel.step, { flam: e.target.checked })} />Flam</label>
        </div>
      )}
    </div>
  );
}
