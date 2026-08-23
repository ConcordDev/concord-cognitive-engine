/**
 * useThreeDispose.ts — prevent WebGL context loss via automatic resource cleanup.
 *
 * The 64MB Emscripten WASM heap (used by Godot 4 WebAssembly) combined with
 * Three.js geometry/material/texture allocations accumulates over hours of
 * browsing. Without explicit disposal, browser GC cannot reclaim GPU memory
 * and the user's tab eventually triggers webglcontextlost — the entire 3D
 * canvas freezes or goes black.
 *
 * This hook walks a Three.js Object3D graph on unmount and calls .dispose()
 * on every geometry, material, and texture it finds. Also fires on
 * webglcontextlost to clean up immediately when the GPU is reclaimed.
 *
 * Use:
 *   const ref = useThreeDispose<THREE.Group>();
 *   return <group ref={ref}>...</group>;
 *
 * Or:
 *   useEffect(() => () => disposeDeep(sceneRef.current), []);
 */

import { useEffect, useRef } from 'react';
import * as THREE from 'three';

export function disposeObject(obj: THREE.Object3D | null): void {
  if (!obj) return;

  obj.traverse((child) => {
    // Geometry
    const mesh = child as THREE.Mesh;
    if (mesh.geometry) {
      try { mesh.geometry.dispose(); } catch { /* already disposed */ }
    }

    // Material(s) + textures
    const mat = mesh.material as THREE.Material | THREE.Material[] | undefined;
    if (Array.isArray(mat)) {
      mat.forEach((m) => disposeMaterial(m));
    } else if (mat) {
      disposeMaterial(mat);
    }
  });

  // Detach from parent
  if (obj.parent) obj.parent.remove(obj);
}

function disposeMaterial(mat: THREE.Material): void {
  try {
    // Dispose any textures the material owns
    Object.keys(mat).forEach((key) => {
      const val = (mat as any)[key];
      if (val && val.isTexture) {
        try { val.dispose(); } catch { /* */ }
      }
    });
    mat.dispose();
  } catch { /* */ }
}

/**
 * React hook: assign ref to a Three.js Object3D, and dispose it on unmount.
 */
export function useThreeDispose<T extends THREE.Object3D = THREE.Object3D>() {
  const ref = useRef<T | null>(null);

  useEffect(() => {
    return () => {
      if (ref.current) {
        disposeObject(ref.current);
        ref.current = null;
      }
    };
  }, []);

  return ref;
}

/**
 * Listen for webglcontextlost on a canvas and clean up the scene + textures.
 * Browser will fire webglcontextrestored after recovery — caller can rebuild.
 */
export function attachContextLossHandler(
  canvas: HTMLCanvasElement | null,
  onLost: () => void,
  onRestored?: () => void,
): () => void {
  if (!canvas) return () => {};

  const lostHandler = (e: Event) => {
    e.preventDefault(); // Tells browser we want to try to recover
    onLost();
  };
  const restoredHandler = () => {
    if (onRestored) onRestored();
  };

  canvas.addEventListener('webglcontextlost', lostHandler, false);
  canvas.addEventListener('webglcontextrestored', restoredHandler, false);

  return () => {
    canvas.removeEventListener('webglcontextlost', lostHandler);
    canvas.removeEventListener('webglcontextrestored', restoredHandler);
  };
}

/**
 * WASM heap pressure monitor.
 *
 * Godot 4 WebAssembly uses a 64MB Shared WebAssembly Heap. Long-running tabs
 * leak memory into it. When usage exceeds ~90%, the heap is exhausted and
 * the WebGL context is lost.
 *
 * Reads performance.memory.usedJSHeapSize (Chrome only) and triggers a
 * cleanup callback when it crosses a threshold.
 */
export interface WasmHeapMonitorOptions {
  warnAtMb?: number;     // log warning
  forceCleanupAtMb?: number; // force dispose
  intervalMs?: number;
  onWarn?: (used: number, total: number) => void;
  onForceCleanup?: (used: number, total: number) => void;
}

export function startWasmHeapMonitor(opts: WasmHeapMonitorOptions = {}): () => void {
  const warnAt = (opts.warnAtMb ?? 400) * 1024 * 1024;
  const forceAt = (opts.forceCleanupAtMb ?? 500) * 1024 * 1024;
  const interval = opts.intervalMs ?? 30_000;

  const tick = () => {
    const perf = performance as any;
    if (!perf.memory) return; // not Chrome
    const used = perf.memory.usedJSHeapSize;
    const total = perf.memory.totalJSHeapSize;
    if (used > forceAt) {
      opts.onForceCleanup?.(used, total);
    } else if (used > warnAt) {
      opts.onWarn?.(used, total);
    }
  };

  const handle = setInterval(tick, interval);
  return () => clearInterval(handle);
}

export default useThreeDispose;
