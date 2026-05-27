/**
 * Auto-exposure controller.
 *
 * Periodically samples the rendered frame's centre luminance and ramps
 * the renderer's toneMappingExposure toward a target that keeps the
 * centre at a comfortable mid-grey (0.4 luminance). Inputs are kept
 * cheap: a small (8×8) downsampled patch sampled every N frames.
 *
 * Bounds clamp toneMappingExposure to [minExposure, maxExposure] so
 * dark/bright scenes can't blow out or crush.
 */

import type * as THREE_NS from 'three';

export interface AutoExposureOptions {
  /** Target centre luminance [0..1]. Default 0.40. */
  targetLuminance?: number;
  /** Min toneMappingExposure clamp. Default 0.55. */
  minExposure?: number;
  /** Max toneMappingExposure clamp. Default 1.85. */
  maxExposure?: number;
  /** Per-frame blend toward target [0..1]. Default 0.05. */
  blendFactor?:  number;
  /** Sample every N frames. Default 6. */
  sampleEveryNFrames?: number;
  /** Center sampling box size in pixels. Default 8. */
  sampleBoxPx?: number;
}

export interface AutoExposureAPI {
  /**
   * Call each frame. The renderer is the active WebGLRenderer; size
   * is the canvas size in CSS px. The function may sample pixels and
   * mutate renderer.toneMappingExposure.
   */
  tick(
    renderer: THREE_NS.WebGLRenderer,
    canvasWidth: number,
    canvasHeight: number,
  ): void;
  /** Current exposure being targeted. */
  getTargetExposure(): number;
  /** Current ramped exposure. */
  getCurrentExposure(): number;
  /** Reset to a known exposure (e.g. on quality preset change). */
  setExposure(value: number): void;
  dispose(): void;
}

export function createAutoExposure(opts: AutoExposureOptions = {}): AutoExposureAPI {
  const targetLuminance = opts.targetLuminance ?? 0.40;
  const minExposure     = opts.minExposure     ?? 0.55;
  const maxExposure     = opts.maxExposure     ?? 1.85;
  const blendFactor     = opts.blendFactor     ?? 0.05;
  const sampleEveryN    = Math.max(1, opts.sampleEveryNFrames ?? 6);
  const sampleBoxPx     = Math.max(2, opts.sampleBoxPx ?? 8);

  let frame = 0;
  let currentExposure = 1.0;
  let targetExposure = 1.0;
  let pixelBuffer: Uint8Array | null = null;
  let disposed = false;

  function sampleCentreLuminance(
    renderer: THREE_NS.WebGLRenderer,
    canvasWidth: number,
    canvasHeight: number,
  ): number | null {
    const gl = (renderer as unknown as { getContext: () => WebGL2RenderingContext | WebGLRenderingContext }).getContext();
    if (!gl) return null;
    const drawing = renderer.domElement;
    if (!drawing) return null;
    const drawW = drawing.width;
    const drawH = drawing.height;
    const cx = Math.floor(drawW / 2 - sampleBoxPx / 2);
    const cy = Math.floor(drawH / 2 - sampleBoxPx / 2);
    if (!pixelBuffer || pixelBuffer.length !== sampleBoxPx * sampleBoxPx * 4) {
      pixelBuffer = new Uint8Array(sampleBoxPx * sampleBoxPx * 4);
    }
    try {
      gl.readPixels(
        cx,
        Math.max(0, drawH - cy - sampleBoxPx), // OpenGL Y-flip
        sampleBoxPx,
        sampleBoxPx,
        gl.RGBA,
        gl.UNSIGNED_BYTE,
        pixelBuffer,
      );
    } catch {
      return null;
    }
    let sumLum = 0;
    let count = 0;
    for (let i = 0; i < pixelBuffer.length; i += 4) {
      const r = pixelBuffer[i]     / 255;
      const g = pixelBuffer[i + 1] / 255;
      const b = pixelBuffer[i + 2] / 255;
      sumLum += 0.299 * r + 0.587 * g + 0.114 * b;
      count++;
    }
    void canvasWidth; void canvasHeight; // unused but kept for future per-CSS overrides
    return count > 0 ? sumLum / count : null;
  }

  return {
    tick(renderer, canvasWidth, canvasHeight) {
      if (disposed) return;
      frame++;
      if (frame % sampleEveryN === 0) {
        const centreLum = sampleCentreLuminance(renderer, canvasWidth, canvasHeight);
        if (centreLum !== null && centreLum > 0.001) {
          // We want a future frame's centre luminance ≈ targetLuminance.
          // Current frame's exposed luminance = centreLum (already tone-
          // mapped). New exposure = current * (target / centre).
          const wantExposure = currentExposure * (targetLuminance / centreLum);
          targetExposure = Math.max(minExposure, Math.min(maxExposure, wantExposure));
        }
      }
      currentExposure += (targetExposure - currentExposure) * blendFactor;
      try {
        renderer.toneMappingExposure = currentExposure;
      } catch { /* idempotent */ }
    },

    getTargetExposure() { return targetExposure; },
    getCurrentExposure() { return currentExposure; },

    setExposure(v) {
      currentExposure = Math.max(minExposure, Math.min(maxExposure, v));
      targetExposure  = currentExposure;
    },

    dispose() {
      disposed = true;
      pixelBuffer = null;
    },
  };
}
