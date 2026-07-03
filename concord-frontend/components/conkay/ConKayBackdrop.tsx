'use client';

// concord-frontend/components/conkay/ConKayBackdrop.tsx
//
// Chooses ConKay's holographic field renderer: the full-bleed Three.js scene
// (P1) when WebGL is available and motion is allowed, else the cheap 2D canvas
// surface. Owns the optional mic-amplitude stream (drives the listening field).
// The Three.js scene is loaded ssr:false so it never runs on the server or bloats
// the chat bundle until ConKay is actually entered.

import dynamic from 'next/dynamic';
import { useEffect, useRef, useState } from 'react';
import type { ConKayState } from './conkay-persona';
import { ConKaySurface } from './ConKaySurface';
import { useMicAmplitude } from './useMicAmplitude';

const ConKayScene = dynamic(() => import('./ConKayScene').then((m) => m.ConKayScene), { ssr: false });

export function ConKayBackdrop({
  state, listening, muted, className, ttsAmplitudeRef,
}: {
  state: ConKayState;
  listening: boolean;
  muted: boolean;
  className?: string;
  /**
   * Live 0..1 envelope of ConKay's OWN speech (from `useConKayVoice`'s
   * `ttsAmplitudeRef`), sampled from the real Piper/Web-Speech playback —
   * never synthetic. Optional so callers that don't wire voice still render.
   * K6-voice (F3): the scene pulses on the user's mic input OR ConKay's own
   * speech, not mic-only, so her replies visibly animate the field/tree too.
   */
  ttsAmplitudeRef?: React.MutableRefObject<number>;
}) {
  const [useThree, setUseThree] = useState<boolean | null>(null);

  useEffect(() => {
    const reduced = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
    let webgl = false;
    try {
      const c = document.createElement('canvas');
      webgl = !!(c.getContext('webgl2') || c.getContext('webgl'));
    } catch { webgl = false; }
    setUseThree(!reduced && webgl);
  }, []);

  // Mic amplitude only while the 3D field is up and actively listening.
  const micAmplitudeRef = useMicAmplitude(useThree === true && listening && !muted);

  // Combine mic input + ConKay's own speech into the single amplitude signal
  // ConKayScene consumes, so the field/tree pulses on EITHER the user talking
  // or Kay talking. Both source refs are already updated every frame by their
  // own owners (useMicAmplitude's analyser loop; useConKayVoice's envelope
  // loop) — this just takes the real max each frame via its own rAF, never a
  // fabricated or interval-driven value.
  const amplitudeRef = useRef(0);
  useEffect(() => {
    if (!useThree) return;
    let raf = 0;
    const tick = () => {
      const mic = micAmplitudeRef.current;
      const tts = ttsAmplitudeRef?.current ?? 0;
      amplitudeRef.current = Math.max(mic, tts);
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [useThree, micAmplitudeRef, ttsAmplitudeRef]);

  if (useThree === null) return null; // resolve client-side first (avoids SSR canvas)
  if (useThree) return <ConKayScene state={state} amplitudeRef={amplitudeRef} className={className} />;
  return <ConKaySurface state={state} className={className} />;
}

export default ConKayBackdrop;
