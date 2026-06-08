'use client';

// ARPreview — REAL WebXR augmented-reality preview of a DTU (Track 4).
//
// Replaces the former mock (setTimeout-simulated "tracking", a CSS fake camera,
// and a fabricated `AR_CAPTURE_…` base64 string). This version:
//   - feature-detects navigator.xr.isSessionSupported('immersive-ar')
//   - launches a genuine immersive-ar session (raw Three.js renderer.xr — the
//     same pattern the AR lens page already uses), with hit-test placement
//   - falls back honestly to a QR/"open on a supported device" panel when WebXR
//     is unavailable (no fake camera, no simulated tracking)
//   - captures from the live WebXR canvas (toDataURL) — only when a real
//     session is running; otherwise the button is disabled.
//
// HONEST CAVEAT: the immersive-ar path can only be exercised on AR hardware
// (Quest/ARCore/visionOS). On desktop/SSR navigator.xr is absent, so the
// unsupported fallback renders — verified by tests/ar-preview-fallback.test.tsx.

import React, { useState, useCallback, useEffect, useRef } from 'react';
import { ds } from '@/lib/design-system';

type ScalePreset = '1:1' | '1:50' | '1:200';

interface DTUData {
  name: string;
  dimensions?: { width: number; height: number; depth: number };
  validationColors?: boolean;
}

interface ARPreviewProps {
  dtuId: string;
  dtuData: DTUData;
  onCapture?: (imageData: string) => void;
  /** Optional caller hint; the component also live-detects WebXR. */
  supported?: boolean;
}

const SCALE_LABELS: Record<ScalePreset, string> = {
  '1:1': 'Real World (1:1)',
  '1:50': 'Tabletop (1:50)',
  '1:200': 'Miniature (1:200)',
};
const SCALE_FACTORS: Record<ScalePreset, number> = { '1:1': 1, '1:50': 0.02, '1:200': 0.005 };

type XrNavigator = Navigator & {
  xr?: {
    isSessionSupported?: (mode: string) => Promise<boolean>;
    requestSession?: (mode: string, opts?: Record<string, unknown>) => Promise<unknown>;
  };
};

export default function ARPreview({ dtuId, dtuData, onCapture, supported }: ARPreviewProps) {
  // null = still detecting; true/false = resolved.
  const [xrSupported, setXrSupported] = useState<boolean | null>(supported === false ? false : null);
  const [sessionActive, setSessionActive] = useState(false);
  const [scale, setScale] = useState<ScalePreset>('1:50');
  const [status, setStatus] = useState<string>('');
  const [launching, setLaunching] = useState(false);

  // Live refs to the active session/renderer so End + Capture act on the real thing.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const sessionRef = useRef<any>(null);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const rendererRef = useRef<any>(null);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);

  const panelStyle = ds.panelFloating;
  const dims = dtuData.dimensions ?? { width: 10, height: 15, depth: 8 };
  const factor = SCALE_FACTORS[scale];
  const scaledDims = {
    width: (dims.width * factor).toFixed(2),
    height: (dims.height * factor).toFixed(2),
    depth: (dims.depth * factor).toFixed(2),
  };

  // Real WebXR feature-detection (runs client-side only).
  useEffect(() => {
    if (supported === false) { setXrSupported(false); return; }
    let alive = true;
    const xr = (typeof navigator !== 'undefined' ? (navigator as XrNavigator).xr : undefined);
    if (!xr?.isSessionSupported) { setXrSupported(false); return; }
    xr.isSessionSupported('immersive-ar')
      .then((ok) => { if (alive) setXrSupported(!!ok); })
      .catch(() => { if (alive) setXrSupported(false); });
    return () => { alive = false; };
  }, [supported]);

  const endAR = useCallback(() => {
    try { rendererRef.current?.setAnimationLoop?.(null); } catch { /* noop */ }
    try { sessionRef.current?.end?.(); } catch { /* noop */ }
    sessionRef.current = null;
    rendererRef.current = null;
    canvasRef.current = null;
    setSessionActive(false);
    setStatus('');
  }, []);

  const startAR = useCallback(async () => {
    const xr = (navigator as XrNavigator).xr;
    if (!xr?.requestSession) { setStatus('WebXR unavailable on this device.'); return; }
    setLaunching(true);
    setStatus('Requesting AR session…');
    try {
      const THREE = await import('three');
      const session = await xr.requestSession('immersive-ar', {
        requiredFeatures: ['local-floor'],
        optionalFeatures: ['hit-test', 'dom-overlay'],
      });
      sessionRef.current = session;

      const canvas = document.createElement('canvas');
      canvasRef.current = canvas;
      const gl = canvas.getContext('webgl2', { xrCompatible: true }) as WebGLRenderingContext;
      const renderer = new THREE.WebGLRenderer({ canvas, context: gl, preserveDrawingBuffer: true });
      renderer.xr.enabled = true;
      rendererRef.current = renderer;
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      await renderer.xr.setSession(session as any);

      const sceneScale = SCALE_FACTORS[scale];
      const scene = new THREE.Scene();
      const camera = new THREE.PerspectiveCamera();
      scene.add(new THREE.HemisphereLight(0xffffff, 0x444466, 1));

      // The DTU rendered to real-world scale (metres).
      const geo = new THREE.BoxGeometry(
        Math.max(0.02, dims.width * sceneScale),
        Math.max(0.02, dims.height * sceneScale),
        Math.max(0.02, dims.depth * sceneScale),
      );
      const dtuMesh = new THREE.Mesh(
        geo,
        new THREE.MeshStandardMaterial({ color: 0x22d3ee, transparent: true, opacity: 0.85 }),
      );
      dtuMesh.visible = false; // appears once the user places it via hit-test
      scene.add(dtuMesh);

      // A reticle that snaps to detected real-world surfaces (hit-test).
      const reticle = new THREE.Mesh(
        new THREE.RingGeometry(0.07, 0.09, 24).rotateX(-Math.PI / 2),
        new THREE.MeshBasicMaterial({ color: 0x22d3ee }),
      );
      reticle.matrixAutoUpdate = false;
      reticle.visible = false;
      scene.add(reticle);

      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const xrSession = session as any;
      let hitTestSource: unknown = null;
      try {
        const viewerSpace = await xrSession.requestReferenceSpace?.('viewer');
        hitTestSource = await xrSession.requestHitTestSource?.({ space: viewerSpace });
      } catch { hitTestSource = null; }

      // Tap to place the DTU at the reticle.
      xrSession.addEventListener?.('select', () => {
        if (reticle.visible) {
          dtuMesh.position.setFromMatrixPosition(reticle.matrix);
          dtuMesh.visible = true;
          setStatus('DTU placed.');
        }
      });
      xrSession.addEventListener?.('end', () => endAR());

      setSessionActive(true);
      setStatus('Point at a surface, then tap to place.');

      renderer.setAnimationLoop((_t: number, frame?: unknown) => {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const f = frame as any;
        if (f && hitTestSource && !dtuMesh.visible) {
          const refSpace = renderer.xr.getReferenceSpace();
          const results = f.getHitTestResults?.(hitTestSource) || [];
          if (results.length && refSpace) {
            const pose = results[0].getPose(refSpace);
            if (pose) {
              reticle.visible = true;
              reticle.matrix.fromArray(pose.transform.matrix);
            }
          } else {
            reticle.visible = false;
          }
        }
        renderer.render(scene, camera);
      });
    } catch (err) {
      setStatus(`Could not start AR: ${(err as Error)?.message || 'unknown error'}`);
      endAR();
    } finally {
      setLaunching(false);
    }
  }, [scale, dims.width, dims.height, dims.depth, endAR]);

  const handleCapture = useCallback(() => {
    // Real capture from the live WebXR canvas (preserveDrawingBuffer is on).
    const canvas = canvasRef.current;
    if (!canvas || !onCapture) return;
    try {
      onCapture(canvas.toDataURL('image/png'));
      setStatus('Captured.');
    } catch {
      setStatus('Capture unavailable for this session.');
    }
  }, [onCapture]);

  useEffect(() => () => { endAR(); }, [endAR]); // cleanup on unmount

  // ── Unsupported / detecting fallback (honest — no fake camera) ──
  if (xrSupported === false) {
    return (
      <div className={`${panelStyle} p-6 flex flex-col items-center gap-4 max-w-md mx-auto`}>
        <div className="text-4xl">📱</div>
        <h2 className="text-lg font-bold text-white">AR Not Available Here</h2>
        <p className="text-sm text-white/50 text-center">
          WebXR immersive-AR isn’t supported on this device/browser. Open this DTU on an AR-capable
          device (recent Android/Chrome or a headset) to place it in your space.
        </p>
        <div className="w-44 h-44 bg-white rounded-lg flex items-center justify-center p-2">
          <div className="w-full h-full border-2 border-black rounded grid grid-cols-5 grid-rows-5 gap-0.5 p-2">
            {Array.from({ length: 25 }).map((_, i) => (
              <div key={i} className={`rounded-sm ${[0, 1, 2, 4, 5, 6, 10, 12, 14, 18, 20, 22, 23, 24].includes(i) ? 'bg-black' : 'bg-white'}`} />
            ))}
          </div>
        </div>
        <p className="text-xs text-white/30">concordia.world/ar/{dtuId}</p>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-4 w-full max-w-2xl">
      <div className={`${panelStyle} p-4`}>
        <div className="flex items-center justify-between">
          <div>
            <h2 className="text-lg font-bold text-white">AR Preview</h2>
            <p className="text-sm text-white/50">{dtuData.name}</p>
          </div>
          <div className="flex items-center gap-2">
            <span className={`w-2.5 h-2.5 rounded-full ${sessionActive ? 'bg-green-500 animate-pulse' : 'bg-white/30'}`} />
            <span className="text-xs text-white/50">{sessionActive ? 'Session live' : xrSupported === null ? 'Detecting…' : 'Ready'}</span>
          </div>
        </div>
      </div>

      {!sessionActive ? (
        <div className={`${panelStyle} p-8 flex flex-col items-center gap-4`}>
          <div className="w-24 h-24 rounded-full bg-gradient-to-br from-cyan-500/20 to-purple-500/20 border border-white/10 flex items-center justify-center">
            <span className="text-4xl">🥽</span>
          </div>
          <p className="text-sm text-white/60 text-center max-w-xs">
            Project this DTU into your physical space with real WebXR augmented reality.
          </p>
          <div className={`${panelStyle} p-3 w-full`}>
            <h3 className="text-xs text-white/50 uppercase tracking-wider mb-2">Scale</h3>
            <div className="flex flex-col gap-1.5">
              {(Object.keys(SCALE_LABELS) as ScalePreset[]).map((s) => (
                <button key={s} onClick={() => setScale(s)}
                  className={`px-3 py-2 rounded text-sm text-left transition-all ${scale === s ? 'bg-cyan-400/15 text-cyan-300 border border-cyan-400/40' : 'bg-white/5 text-white/60 border border-white/10 hover:border-white/20'}`}>
                  {SCALE_LABELS[s]}
                </button>
              ))}
            </div>
          </div>
          <button onClick={startAR} disabled={launching || xrSupported === null}
            className="px-6 py-3 rounded-lg font-semibold text-sm bg-gradient-to-r from-cyan-500 to-blue-600 text-white hover:from-cyan-400 hover:to-blue-500 transition-all disabled:opacity-50">
            {launching ? 'Starting AR…' : xrSupported === null ? 'Checking device…' : 'Enter AR'}
          </button>
          {status && <p className="text-xs text-white/40 text-center">{status}</p>}
        </div>
      ) : (
        <div className={`${panelStyle} p-6 flex flex-col items-center gap-4`}>
          <p className="text-sm text-cyan-200 text-center">{status || 'AR session running on your device.'}</p>
          <p className="text-xs text-white/40 text-center max-w-xs">
            The live view is rendered through your device’s AR display. Tap a detected surface to place
            the DTU ({scaledDims.width} × {scaledDims.height} × {scaledDims.depth} m at {scale}).
          </p>
          <div className="flex gap-2">
            <button onClick={handleCapture} disabled={!onCapture}
              className="py-2 px-4 rounded-lg text-sm font-medium bg-white/10 text-white/70 hover:bg-white/20 transition-all disabled:opacity-30">
              📸 Capture
            </button>
            <button onClick={endAR}
              className="py-2 px-4 rounded-lg text-sm font-medium bg-red-500/20 text-red-300 hover:bg-red-500/30 transition-all">
              End AR
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
