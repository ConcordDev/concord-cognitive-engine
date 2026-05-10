'use client';

/**
 * EnterVRButton — small bottom-center button that requests a WebXR
 * immersive-vr session on the active Three.js renderer (set up by
 * ConcordiaScene with renderer.xr.enabled = true).
 *
 * On Vision Pro Safari (since visionOS 2) this is one tap → fully
 * spatial Concordia. On Quest 4 same. The button auto-hides when
 * navigator.xr is unavailable (desktop browsers, mobile Safari pre-iOS17,
 * etc.) so it doesn't add visual noise.
 *
 * Hand-tracking via the new `transient-pointer` input mode (Apple/W3C
 * 2026 spec extension) — Three.js handles it transparently when the
 * session declares the input source.
 */

import { useEffect, useState } from 'react';

// Use the runtime navigator.xr — it's typed in the lib.dom.d.ts as
// XRSystem when WebXR is supported. We avoid re-declaring its full
// shape (interface conflict) and just access via `(navigator as any).xr`
// at the use site. Renderer is a Three.js WebGLRenderer; we narrow to
// what we actually call.
interface RendererWithXR {
  xr: { setSession: (s: unknown | null) => Promise<void> };
}

declare global {
  interface Window {
    __concordiaRenderer?: RendererWithXR;
  }
}

export default function EnterVRButton() {
  const [supported, setSupported] = useState(false);
  const [active, setActive] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let alive = true;
    const nav = navigator as Navigator & { xr?: { isSessionSupported: (m: string) => Promise<boolean>; requestSession: (m: string, init?: { optionalFeatures?: string[]; requiredFeatures?: string[] }) => Promise<unknown> } };
    if (!nav.xr) { setSupported(false); return; }
    nav.xr.isSessionSupported('immersive-vr').then((s: boolean) => {
      if (alive) setSupported(s);
    }).catch(() => { if (alive) setSupported(false); });
    return () => { alive = false; };
  }, []);

  const enterVR = async () => {
    setError(null);
    const renderer = window.__concordiaRenderer;
    if (!renderer) { setError('Scene not ready'); return; }
    const nav2 = navigator as Navigator & { xr?: { requestSession: (m: string, init?: { optionalFeatures?: string[]; requiredFeatures?: string[] }) => Promise<{ end: () => Promise<void>; addEventListener: (e: string, cb: () => void) => void }> } };
    if (!nav2.xr) { setError('WebXR unavailable'); return; }
    try {
      const session = await nav2.xr.requestSession('immersive-vr', {
        optionalFeatures: ['local-floor', 'bounded-floor', 'hand-tracking', 'layers'],
      });
      await renderer.xr.setSession(session);
      setActive(true);
      session.addEventListener('end', () => setActive(false));
    } catch (err) {
      const e = err as Error;
      setError(e.message || 'Failed to enter VR');
    }
  };

  if (!supported) return null;

  return (
    <div className="fixed bottom-4 left-1/2 -translate-x-1/2 z-40 pointer-events-auto flex flex-col items-center gap-1">
      <button
        type="button"
        onClick={enterVR}
        disabled={active}
        className="bg-purple-700 hover:bg-purple-600 disabled:bg-zinc-700 text-white font-bold px-4 py-2 rounded-full shadow-xl text-sm uppercase tracking-wider"
      >
        {active ? 'In VR' : 'Enter VR'}
      </button>
      {error && <p className="text-[10px] text-red-400 font-mono">{error}</p>}
    </div>
  );
}
