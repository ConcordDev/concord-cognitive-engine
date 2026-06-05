'use client';

// concord-frontend/components/conkay/ConKayBackdrop.tsx
//
// Chooses ConKay's holographic field renderer: the full-bleed Three.js scene
// (P1) when WebGL is available and motion is allowed, else the cheap 2D canvas
// surface. Owns the optional mic-amplitude stream (drives the listening field).
// The Three.js scene is loaded ssr:false so it never runs on the server or bloats
// the chat bundle until ConKay is actually entered.

import dynamic from 'next/dynamic';
import { useEffect, useState } from 'react';
import type { ConKayState } from './conkay-persona';
import { ConKaySurface } from './ConKaySurface';
import { useMicAmplitude } from './useMicAmplitude';

const ConKayScene = dynamic(() => import('./ConKayScene').then((m) => m.ConKayScene), { ssr: false });

export function ConKayBackdrop({
  state, listening, muted, className,
}: {
  state: ConKayState;
  listening: boolean;
  muted: boolean;
  className?: string;
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
  const amplitudeRef = useMicAmplitude(useThree === true && listening && !muted);

  if (useThree === null) return null; // resolve client-side first (avoids SSR canvas)
  if (useThree) return <ConKayScene state={state} amplitudeRef={amplitudeRef} className={className} />;
  return <ConKaySurface state={state} className={className} />;
}

export default ConKayBackdrop;
