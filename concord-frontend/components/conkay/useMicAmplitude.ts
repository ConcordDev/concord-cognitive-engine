'use client';

// concord-frontend/components/conkay/useMicAmplitude.ts
//
// Best-effort microphone amplitude (0..1) so ConKay's particle field reacts to
// the user's voice while listening. Uses getUserMedia + an AnalyserNode RMS,
// smoothed. Fully optional: on denial / unsupported / error it returns a ref
// that stays at 0 and the field falls back to its state-driven animation.
//
// Returns a ref (not state) on purpose — the Three.js frame loop reads it every
// frame without forcing React re-renders.

import { useEffect, useRef } from 'react';

export function useMicAmplitude(enabled: boolean): React.MutableRefObject<number> {
  const levelRef = useRef(0);

  useEffect(() => {
    if (!enabled || typeof navigator === 'undefined' || !navigator.mediaDevices?.getUserMedia) {
      levelRef.current = 0;
      return;
    }
    let stopped = false;
    let raf = 0;
    let ctx: AudioContext | null = null;
    let stream: MediaStream | null = null;

    const start = async () => {
      try {
        stream = await navigator.mediaDevices.getUserMedia({ audio: true });
        if (stopped) { stream.getTracks().forEach((t) => t.stop()); return; }
        const AC = (window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext);
        ctx = new AC();
        const src = ctx.createMediaStreamSource(stream);
        const analyser = ctx.createAnalyser();
        analyser.fftSize = 512;
        src.connect(analyser);
        const buf = new Uint8Array(analyser.frequencyBinCount);
        const tick = () => {
          analyser.getByteTimeDomainData(buf);
          let sum = 0;
          for (let i = 0; i < buf.length; i++) { const v = (buf[i] - 128) / 128; sum += v * v; }
          const rms = Math.sqrt(sum / buf.length); // 0..~1
          // smooth + gentle gain, clamp
          levelRef.current = Math.min(1, levelRef.current * 0.8 + Math.min(1, rms * 2.2) * 0.2);
          raf = requestAnimationFrame(tick);
        };
        tick();
      } catch {
        levelRef.current = 0; // denied / unavailable — field uses state animation
      }
    };
    start();

    return () => {
      stopped = true;
      cancelAnimationFrame(raf);
      try { stream?.getTracks().forEach((t) => t.stop()); } catch { /* noop */ }
      try { ctx?.close(); } catch { /* noop */ }
      levelRef.current = 0;
    };
  }, [enabled]);

  return levelRef;
}

export default useMicAmplitude;
