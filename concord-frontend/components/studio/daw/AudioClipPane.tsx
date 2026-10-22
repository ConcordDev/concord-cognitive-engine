'use client';

import { useEffect, useRef, useState } from 'react';
import type { DAWClip, DAWProject } from '@/lib/daw/types';
import type { PitchEditDoc } from '@/lib/daw/pitch-edit-types';
import { sliceClipToGrid } from '@/lib/daw/clip-edit';
import { PitchEditor } from './PitchEditor';

interface Pcm {
  channels: Float32Array[];
  sampleRate: number;
}

/** Pitch Editor and a waveform editor for the same audio clip. */
export function AudioClipPane({ clip, project, pcm, onEdits, onClip, onProject }: {
  clip: DAWClip;
  project: DAWProject;
  pcm: Pcm | null;
  onEdits: (doc: PitchEditDoc | null, key?: string) => void;
  onClip: (patch: Partial<DAWClip>, key?: string) => void;
  onProject: (project: DAWProject) => void;
}) {
  const [mode, setMode] = useState<'pitch' | 'wave'>('pitch');
  return (
    <div className="flex h-full flex-col">
      <div className="flex h-6 flex-shrink-0 items-center gap-1 border-b border-white/5 px-2">
        <button type="button" onClick={() => setMode('pitch')} className={mode === 'pitch' ? 'text-[10px] text-white' : 'text-[10px] text-zinc-500'}>Pitch</button>
        <button type="button" onClick={() => setMode('wave')} className={mode === 'wave' ? 'text-[10px] text-white' : 'text-[10px] text-zinc-500'}>Waveform</button>
        <span className="ml-2 text-[10px] text-zinc-600">S splits. Arrows nudge. Alt-drag slips. Shift+Delete ripples.</span>
      </div>
      <div className="min-h-0 flex-1">
        {mode === 'pitch' ? (
          <PitchEditor clip={clip} project={project} pcm={pcm} onEdits={onEdits} />
        ) : (
          <WaveEditor clip={clip} project={project} pcm={pcm} onClip={onClip} onProject={onProject} />
        )}
      </div>
    </div>
  );
}

function WaveEditor({ clip, project, pcm, onClip, onProject }: {
  clip: DAWClip;
  project: DAWProject;
  pcm: Pcm | null;
  onClip: (patch: Partial<DAWClip>, key?: string) => void;
  onProject: (project: DAWProject) => void;
}) {
  const canvas = useRef<HTMLCanvasElement>(null);
  const [sel, setSel] = useState<{ a: number; b: number } | null>(null);
  const [zoom, setZoom] = useState(1);
  const channel = pcm?.channels[0];
  const sr = pcm?.sampleRate || 48000;
  const dur = channel ? channel.length / sr : 0;
  useEffect(() => {
    const node = canvas.current;
    if (!node || !channel) return;
    const ctx = node.getContext('2d');
    if (!ctx) return;
    const w = node.width;
    const h = node.height;
    ctx.clearRect(0, 0, w, h);
    ctx.fillStyle = '#8b5cf6';
    const view = dur / zoom;
    for (let x = 0; x < w; x++) {
      const t0 = (x / w) * view;
      const t1 = ((x + 1) / w) * view;
      let peak = 0;
      const i0 = Math.floor(t0 * sr);
      const i1 = Math.min(channel.length, Math.ceil(t1 * sr));
      for (let i = i0; i < i1; i += Math.max(1, Math.floor((i1 - i0) / 32))) peak = Math.max(peak, Math.abs(channel[i] || 0));
      const bh = Math.max(1, peak * (h - 4));
      ctx.fillRect(x, (h - bh) / 2, 1, bh);
    }
    if (sel) {
      const x0 = (Math.min(sel.a, sel.b) / view) * w;
      const x1 = (Math.max(sel.a, sel.b) / view) * w;
      ctx.fillStyle = 'rgba(255,255,255,0.15)';
      ctx.fillRect(x0, 0, Math.max(1, x1 - x0), h);
    }
  }, [channel, dur, sel, sr, zoom]);
  const range = () => {
    if (!sel || !dur) return null;
    const a = Math.max(0, Math.min(sel.a, sel.b));
    const b = Math.min(dur, Math.max(sel.a, sel.b));
    return b - a > 0.01 ? { start: a, end: b } : null;
  };
  const addRegion = (patch: { gainDb: number; reverse: boolean }) => {
    const span = range();
    if (!span) return;
    onClip({ regionEdits: [...(clip.regionEdits || []), { ...span, ...patch }] }, `region-${clip.id}`);
  };
  return (
    <div className="flex h-full flex-col gap-1 p-2">
      <canvas
        ref={canvas}
        width={800}
        height={140}
        className="h-28 w-full rounded bg-black/40"
        aria-label="Clip waveform"
        onWheel={(e) => { e.preventDefault(); setZoom((z) => Math.max(1, Math.min(16, z * (e.deltaY < 0 ? 1.2 : 1 / 1.2)))); }}
        onPointerDown={(e) => {
          const rect = e.currentTarget.getBoundingClientRect();
          const t = ((e.clientX - rect.left) / rect.width) * (dur / zoom);
          setSel({ a: t, b: t });
          const move = (ev: PointerEvent) => {
            const x = ((ev.clientX - rect.left) / rect.width) * (dur / zoom);
            setSel({ a: t, b: Math.max(0, x) });
          };
          window.addEventListener('pointermove', move);
          window.addEventListener('pointerup', () => window.removeEventListener('pointermove', move), { once: true });
        }}
      />
      <div className="flex flex-wrap gap-1 text-[10px]">
        <button type="button" className="rounded bg-white/5 px-2 py-1 text-zinc-200" onClick={() => {
          const span = range();
          if (!span || !channel) return;
          const a = Math.round(span.start * sr);
          const b = Math.min(channel.length, Math.round(span.end * sr));
          let peak = 0;
          for (let i = a; i < b; i++) peak = Math.max(peak, Math.abs(channel[i] || 0));
          if (peak > 1e-6) addRegion({ gainDb: -20 * Math.log10(peak), reverse: false });
        }}>Normalize selection</button>
        <button type="button" className="rounded bg-white/5 px-2 py-1 text-zinc-200" onClick={() => addRegion({ gainDb: 0, reverse: true })}>Reverse selection</button>
        <button type="button" className="rounded bg-white/5 px-2 py-1 text-zinc-200" onClick={() => addRegion({ gainDb: 1, reverse: false })}>Selection +1 dB</button>
        <button type="button" className="rounded bg-white/5 px-2 py-1 text-zinc-200" disabled={!channel} onClick={() => {
          if (!channel) return;
          onProject(sliceClipToGrid(project, clip.id, channel, sr, project.bpm || 120, 0.25));
        }}>Slice to grid</button>
      </div>
    </div>
  );
}
