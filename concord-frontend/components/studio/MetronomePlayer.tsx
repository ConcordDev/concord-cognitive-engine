'use client';

import { useEffect, useRef } from 'react';

/**
 * Headless Web Audio metronome. Schedules click oscillators ahead of time
 * (Chris Wilson lookahead pattern) so the clicks stay steady even if the
 * main thread is busy. No DOM output.
 *
 * Higher-pitched click on beat 1, lower on subsequent beats.
 */
export function MetronomePlayer({
  enabled,
  playing,
  bpm,
  beatsPerBar = 4,
}: {
  enabled: boolean;
  playing: boolean;
  bpm: number;
  beatsPerBar?: number;
}) {
  const ctxRef = useRef<AudioContext | null>(null);
  const gainRef = useRef<GainNode | null>(null);
  const nextNoteTimeRef = useRef(0);
  const currentBeatRef = useRef(0);
  const timerRef = useRef<number | null>(null);

  const SCHEDULE_AHEAD_S = 0.1;
  const LOOKAHEAD_MS = 25;

  useEffect(() => {
    if (!enabled || !playing) {
      // tear down loop
      if (timerRef.current) { window.clearInterval(timerRef.current); timerRef.current = null; }
      return;
    }
    if (typeof window === 'undefined') return;

    if (!ctxRef.current) {
      const AC = window.AudioContext || (window as any).webkitAudioContext;
      if (!AC) return;
      ctxRef.current = new AC();
      const g = ctxRef.current.createGain();
      g.gain.value = 0.18;
      g.connect(ctxRef.current.destination);
      gainRef.current = g;
    }
    const ctx = ctxRef.current;
    if (ctx.state === 'suspended') ctx.resume().catch(() => {});

    nextNoteTimeRef.current = ctx.currentTime + 0.05;
    currentBeatRef.current = 0;

    function scheduleClick(beat: number, when: number) {
      if (!ctx || !gainRef.current) return;
      const osc = ctx.createOscillator();
      const env = ctx.createGain();
      const isDownbeat = beat === 0;
      osc.type = 'square';
      osc.frequency.value = isDownbeat ? 1500 : 900;
      env.gain.setValueAtTime(0, when);
      env.gain.linearRampToValueAtTime(isDownbeat ? 1.0 : 0.55, when + 0.001);
      env.gain.exponentialRampToValueAtTime(0.0001, when + 0.05);
      osc.connect(env);
      env.connect(gainRef.current);
      osc.start(when);
      osc.stop(when + 0.06);
    }

    function tick() {
      if (!ctx) return;
      const secondsPerBeat = 60 / Math.max(20, Math.min(400, bpm));
      while (nextNoteTimeRef.current < ctx.currentTime + SCHEDULE_AHEAD_S) {
        scheduleClick(currentBeatRef.current, nextNoteTimeRef.current);
        nextNoteTimeRef.current += secondsPerBeat;
        currentBeatRef.current = (currentBeatRef.current + 1) % Math.max(1, beatsPerBar);
      }
    }

    timerRef.current = window.setInterval(tick, LOOKAHEAD_MS);
    tick();

    return () => {
      if (timerRef.current) { window.clearInterval(timerRef.current); timerRef.current = null; }
    };
  }, [enabled, playing, bpm, beatsPerBar]);

  useEffect(() => () => {
    if (timerRef.current) window.clearInterval(timerRef.current);
    if (ctxRef.current) { ctxRef.current.close().catch(() => {}); ctxRef.current = null; }
  }, []);

  return null;
}

export default MetronomePlayer;
