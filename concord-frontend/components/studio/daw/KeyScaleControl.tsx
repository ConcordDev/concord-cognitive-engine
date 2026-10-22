'use client';

import { useState } from 'react';
import type { DAWProject } from '@/lib/daw/types';
import { PITCH_ROOTS } from '@/lib/daw/dsp/pitch/core';
import type { ClipKeyResult } from '@/lib/daw/dsp/pitch/key-detect';

const SCALES: Array<{ value: string; label: string }> = [
  { value: 'major', label: 'Major' },
  { value: 'minor', label: 'Natural minor' },
  { value: 'harmonic minor', label: 'Harmonic minor' },
  { value: 'major pentatonic', label: 'Major pentatonic' },
  { value: 'minor pentatonic', label: 'Minor pentatonic' },
  { value: 'blues', label: 'Blues' },
  { value: 'dorian', label: 'Dorian' },
  { value: 'chromatic', label: 'Chromatic' },
  { value: 'custom', label: 'Custom' },
];

const C_MAJOR = 0b101010110101;

function scaleValue(scale: string): string {
  if (scale === 'natural minor') return 'minor';
  return SCALES.some((s) => s.value === scale) ? scale : scale;
}

export function KeyScaleControl({
  project, onChange, onDetect,
}: {
  project: DAWProject;
  onChange: (key: string, scale: string, scaleMask: number | undefined) => void;
  onDetect: () => Promise<ClipKeyResult>;
}) {
  const [status, setStatus] = useState('');
  const [busy, setBusy] = useState(false);
  const scale = scaleValue(project.scale);
  const custom = scale === 'custom';
  const mask = project.scaleMask && project.scaleMask > 0 ? project.scaleMask : C_MAJOR;
  const knownScale = SCALES.some((s) => s.value === scale);
  const keyKnown = (PITCH_ROOTS as readonly string[]).includes(project.key);

  const setScale = (next: string) => {
    if (next === 'custom') onChange(project.key, 'custom', mask);
    else onChange(project.key, next, undefined);
    setStatus('');
  };

  const togglePc = (pc: number) => {
    const bit = 1 << pc;
    const next = mask ^ bit;
    if (next === 0) {
      setStatus('A custom scale needs at least one note.');
      return;
    }
    onChange(project.key, 'custom', next);
    setStatus('');
  };

  return (
    <div className="relative ml-1 flex items-center gap-1">
      <label className="sr-only" htmlFor="studio-song-key">Song key</label>
      <select
        id="studio-song-key"
        aria-label="Song key"
        value={keyKnown ? project.key : project.key}
        onChange={(e) => onChange(e.target.value, custom ? 'custom' : scale, custom ? mask : undefined)}
        className="h-7 rounded bg-white/5 px-1 text-[11px] text-zinc-200 outline-none"
      >
        {!keyKnown && <option value={project.key}>{project.key}</option>}
        {PITCH_ROOTS.map((r) => <option key={r} value={r}>{r}</option>)}
      </select>
      <label className="sr-only" htmlFor="studio-song-scale">Song scale</label>
      <select
        id="studio-song-scale"
        aria-label="Song scale"
        value={knownScale ? scale : project.scale}
        onChange={(e) => setScale(e.target.value)}
        className="h-7 max-w-[9.5rem] rounded bg-white/5 px-1 text-[11px] text-zinc-200 outline-none"
      >
        {!knownScale && <option value={project.scale}>{project.scale}</option>}
        {SCALES.map((s) => <option key={s.value} value={s.value}>{s.label}</option>)}
      </select>
      <button
        type="button"
        disabled={busy}
        className="h-7 rounded bg-white/5 px-1.5 text-[11px] text-zinc-300 hover:bg-white/10 disabled:opacity-40"
        onClick={() => {
          setBusy(true);
          void onDetect().then((r) => {
            if (r.ok) {
              onChange(r.key, r.scale, undefined);
              const name = r.scale === 'minor' ? 'natural minor' : 'major';
              setStatus(r.fromCache ? `Saved analysis: ${r.key} ${name}.` : `Detected ${r.key} ${name}.`);
            } else setStatus(r.reason);
          }).finally(() => setBusy(false));
        }}
      >
        {busy ? 'Detecting…' : 'Detect key'}
      </button>
      {custom && (
        <div className="absolute left-0 top-8 z-30 flex w-56 flex-wrap gap-1 rounded-md border border-white/10 bg-[#1b1b24] p-1 shadow-xl">
          {PITCH_ROOTS.map((name, pc) => {
            const on = (mask & (1 << pc)) !== 0;
            return (
              <button
                key={name}
                type="button"
                aria-pressed={on}
                aria-label={`${name} ${on ? 'in scale' : 'out of scale'}`}
                onClick={() => togglePc(pc)}
                className={on ? 'rounded bg-violet-500/30 px-1.5 py-0.5 text-[10px] text-violet-100' : 'rounded bg-white/5 px-1.5 py-0.5 text-[10px] text-zinc-500'}
              >
                {name}
              </button>
            );
          })}
        </div>
      )}
      {status && <span className="max-w-[14rem] truncate text-[10px] text-zinc-400" title={status}>{status}</span>}
    </div>
  );
}
