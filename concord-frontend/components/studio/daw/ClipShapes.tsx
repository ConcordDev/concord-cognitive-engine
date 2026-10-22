'use client';

import { memo } from 'react';
import type { DAWClip, AudioAssetMeta } from '@/lib/daw/types';

export const MidiThumb = memo(function MidiThumb({ clip, width, height }: { clip: DAWClip; width: number; height: number }) {
  const notes = clip.midiNotes || [];
  if (!notes.length || width < 8) return null;
  let lo = 127, hi = 0;
  for (const n of notes) { lo = Math.min(lo, n.pitch); hi = Math.max(hi, n.pitch); }
  const span = Math.max(12, hi - lo + 1);
  const len = clip.looped ? clip.loopLength : clip.lengthBeats;
  const reps = clip.looped ? Math.ceil(clip.lengthBeats / Math.max(0.25, len)) : 1;
  const bw = width / clip.lengthBeats;
  const rects = [];
  for (let r = 0; r < reps && rects.length < 600; r++) {
    for (const n of notes) {
      const x = (r * len + n.startBeat) * bw;
      if (x >= width) continue;
      const y = ((hi - n.pitch) / span) * (height - 4) + 2;
      rects.push(<rect key={`${r}-${n.id}`} x={x} y={y} width={Math.max(1, Math.min(n.lengthBeats * bw, width - x) - 0.5)} height={Math.max(1.5, (height - 4) / span)} rx={0.5} />);
    }
  }
  return <svg width={width} height={height} className="pointer-events-none absolute inset-0 fill-white/70">{rects}</svg>;
});

export const WaveThumb = memo(function WaveThumb({ asset, clip, width, height, bpm }: { asset?: AudioAssetMeta; clip: DAWClip; width: number; height: number; bpm: number }) {
  if (!asset || !asset.waveformPeaks?.length || width < 4) return null;
  const peaks = asset.waveformPeaks;
  const clipSec = (clip.lengthBeats * 60) / bpm;
  const offsetSec = clip.offset || 0;
  const mid = height / 2;
  const pts: string[] = [];
  const cols = Math.max(2, Math.min(600, Math.floor(width / 2)));
  for (let i = 0; i <= cols; i++) {
    const t = offsetSec + (i / cols) * clipSec;
    const idx = Math.floor((t / Math.max(0.001, asset.duration)) * peaks.length);
    const v = idx >= 0 && idx < peaks.length ? peaks[idx] : 0;
    const x = (i / cols) * width;
    pts.push(`${x.toFixed(1)},${(mid - v * mid * 0.9).toFixed(1)}`);
  }
  for (let i = cols; i >= 0; i--) {
    const t = offsetSec + (i / cols) * clipSec;
    const idx = Math.floor((t / Math.max(0.001, asset.duration)) * peaks.length);
    const v = idx >= 0 && idx < peaks.length ? peaks[idx] : 0;
    pts.push(`${((i / cols) * width).toFixed(1)},${(mid + v * mid * 0.9).toFixed(1)}`);
  }
  return <svg width={width} height={height} className="pointer-events-none absolute inset-0"><polygon points={pts.join(' ')} className="fill-white/60" /></svg>;
});
