'use client';

import { useEffect, useRef, useSyncExternalStore } from 'react';
import { getStudioEngine, type TransportState } from '@/lib/daw/playback-engine';

/** Transport state (re-renders only on play/stop/launch changes, never per tick). */
const EMPTY_LAUNCHED = {};

export function useTransportState(): { state: TransportState; launched: Record<string, { clipId: string; launchBeat: number } | undefined> } {
  const engine = getStudioEngine();
  const state = useSyncExternalStore((cb) => engine.subscribe(cb), () => engine.transportState, () => 'stopped' as TransportState);
  const launched = useSyncExternalStore((cb) => engine.subscribe(cb), () => engine.launchedClips, () => EMPTY_LAUNCHED);
  return { state, launched: launched as Record<string, { clipId: string; launchBeat: number } | undefined> };
}

/**
 * Run `fn(beat)` every animation frame while mounted. Writes go straight to
 * the DOM through refs, so the audio clock never triggers React renders.
 */
export function useBeatFrame(fn: (beat: number) => void): void {
  const ref = useRef(fn);
  ref.current = fn;
  useEffect(() => {
    let raf = 0;
    const loop = () => {
      ref.current(getStudioEngine().getBeat());
      raf = requestAnimationFrame(loop);
    };
    raf = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(raf);
  }, []);
}

export function formatPosition(beat: number, beatsPerBar: number): string {
  if (beat < 0) return `-${Math.ceil(-beat / beatsPerBar)}.${(((Math.floor(beat) % beatsPerBar) + beatsPerBar) % beatsPerBar) + 1}`;
  const bar = Math.floor(beat / beatsPerBar) + 1;
  const b = Math.floor(beat % beatsPerBar) + 1;
  const sixteenth = Math.floor((beat % 1) * 4) + 1;
  return `${bar}.${b}.${sixteenth}`;
}

export function formatTime(beat: number, bpm: number): string {
  const s = Math.max(0, (beat * 60) / bpm);
  const m = Math.floor(s / 60);
  return `${m}:${(s % 60).toFixed(1).padStart(4, '0')}`;
}
