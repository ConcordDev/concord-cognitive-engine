'use client';

/**
 * useAmbientAudio — the lens's synthesized tone bed, for surfaces
 * other than the Sounds view. A guided session used to run as a
 * silent visual timer under a "narrated by" label (F2); the repair
 * is sound under an honest label: while a session runs, the player
 * plays the category's tone bed from meditation.soundscapeConfig —
 * the same deterministic Web-Audio synthesis the SoundscapePlayer
 * renders, labelled "synthesized locally" exactly as the Sounds
 * view labels it. Narration credits exist nowhere in this lens:
 * no recorded narration exists, so no entry claims it.
 */

import { useCallback, useEffect, useRef, useState } from 'react';
import { lensRun } from '@/lib/api/client';

interface ToneBed {
  kind?: string;
  drone?: number[];
  gain?: number;
  noise?: string;
  noiseGain?: number;
}

function makeNoiseBuffer(ctx: AudioContext, tint: string): AudioBuffer {
  const len = ctx.sampleRate * 2;
  const buf = ctx.createBuffer(1, len, ctx.sampleRate);
  const d = buf.getChannelData(0);
  let last = 0;
  let b0 = 0, b1 = 0, b2 = 0;
  for (let i = 0; i < len; i++) {
    const white = Math.random() * 2 - 1;
    if (tint === 'brown') {
      last = (last + 0.02 * white) / 1.02;
      d[i] = last * 3.5;
    } else if (tint === 'pink') {
      b0 = 0.99765 * b0 + white * 0.0990460;
      b1 = 0.96300 * b1 + white * 0.2965164;
      b2 = 0.57000 * b2 + white * 1.0526913;
      d[i] = (b0 + b1 + b2 + white * 0.1848) * 0.25;
    } else {
      d[i] = white * 0.6;
    }
  }
  return buf;
}

export function useAmbientAudio(category: string) {
  const [bed, setBed] = useState<ToneBed | null>(null);
  const [sounding, setSounding] = useState(false);
  const ctxRef = useRef<AudioContext | null>(null);
  const nodesRef = useRef<AudioNode[]>([]);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const r = await lensRun('meditation', 'soundscapeConfig', { category });
      if (!cancelled) setBed((r.data?.result as ToneBed) || null);
    })();
    return () => { cancelled = true; };
  }, [category]);

  const stop = useCallback(() => {
    nodesRef.current.forEach((n) => {
      try { (n as OscillatorNode).stop?.(); } catch { /* not a source */ }
      try { n.disconnect(); } catch { /* already gone */ }
    });
    nodesRef.current = [];
    setSounding(false);
  }, []);

  const start = useCallback(() => {
    if (!bed) return;
    const Ctor = window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
    if (!Ctor) return;
    const ctx = ctxRef.current || new Ctor();
    ctxRef.current = ctx;
    void ctx.resume();
    const master = ctx.createGain();
    master.gain.value = 0.55;
    master.connect(ctx.destination);
    const built: AudioNode[] = [master];
    for (const freq of bed.drone || []) {
      const osc = ctx.createOscillator();
      osc.type = 'sine';
      osc.frequency.value = freq;
      const g = ctx.createGain();
      g.gain.value = (bed.gain || 0.15) / (bed.drone?.length || 1);
      osc.connect(g); g.connect(master);
      osc.start();
      built.push(osc, g);
    }
    if (bed.noiseGain) {
      const src = ctx.createBufferSource();
      src.buffer = makeNoiseBuffer(ctx, bed.noise || 'pink');
      src.loop = true;
      const g = ctx.createGain();
      g.gain.value = bed.noiseGain;
      src.connect(g); g.connect(master);
      src.start();
      built.push(src, g);
    }
    nodesRef.current = built;
    setSounding(true);
  }, [bed]);

  useEffect(() => () => { stop(); ctxRef.current?.close().catch(() => {}); }, [stop]);

  return { start, stop, sounding, ready: !!bed };
}
