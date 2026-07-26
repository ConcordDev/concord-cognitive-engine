// World Lens plan Phase 5 ("Auto-exposure timing + render resilience") —
// two bugs found while investigating a report that Concordia's 3D canvas
// renders mostly black/frozen even though the HUD overlays (a separate,
// React-driven render path) stay live and data-driven.
//
// Bug A (ordering): createAutoExposure()'s tick() samples the canvas's own
// drawing buffer via `gl.readPixels()` to drive renderer.toneMappingExposure.
// The WebGLRenderer here is built WITHOUT `preserveDrawingBuffer: true` (the
// default), so per the WebGL spec the drawing buffer's contents are only
// well-defined within the SAME task that rendered them — a read after
// control returns to the browser (i.e. in a LATER animation frame) is
// implementation-defined. The tick previously ran BEFORE renderSceneFrame()
// in the per-frame loop, so it sampled the PRIOR frame's buffer across a
// full compositor boundary: exactly the "readback outside a rAF frame" trap.
// Fix: sample immediately AFTER the render that produced the buffer, in the
// same synchronous turn.
//
// Bug B (resilience): the animate loop's gameLoop() has no outer try/catch
// and re-arms itself with `requestAnimationFrame(gameLoop)` as its OWN LAST
// STATEMENT. The render call was previously unguarded, so any exception it
// throws (composer/SSGI/shader-compile/context-loss — all more likely under
// a stressed software WebGL rasterizer) stops the loop forever: the 3D
// canvas freezes (and, once the un-preserved backbuffer is reclaimed by the
// browser, can go black) while HUD overlays on a separate render path keep
// updating — exactly the reported symptom shape. Fix: never let a render
// exception escape; fall back to the simplest possible render path so the
// caller's requestAnimationFrame re-arm is always reached.
//
// ConcordiaScene.tsx isn't mountable in jsdom (Three.js scene construction,
// Rapier physics, dozens of world-lens libraries) — this file drives the
// real extracted function with fake ref/renderer/autoExposure spies, the
// same convention tests/concordia-scene-ultra-postfx-fix.test.tsx already
// established for renderSceneFrame.

import { describe, it, expect, vi } from 'vitest';
import { renderFrameAndSampleExposure } from '@/components/world-lens/ConcordiaScene';

function makeRefs() {
  return {
    ssgiPassRef: { current: null as { render: (t: unknown) => void } | null },
    composerRef: { current: null as { render: (delta: number) => void } | null },
    ssgiOutputTargetRef: { current: null as unknown | null },
  };
}

describe('Phase 5 fix — auto-exposure samples AFTER render, not before', () => {
  it('calls the render path before autoExposure.tick, in that order', () => {
    const refs = makeRefs();
    const renderer = { render: vi.fn() };
    const order: string[] = [];
    refs.composerRef.current = { render: () => order.push('render') };
    const autoExposure = { tick: () => order.push('expose') };

    renderFrameAndSampleExposure(refs, renderer, 'scene', 'camera', 0.016, autoExposure, 800, 600);

    expect(order).toEqual(['render', 'expose']);
  });

  it('passes the SAME renderer + live canvas size through to autoExposure.tick', () => {
    const refs = makeRefs();
    const renderer = { render: vi.fn() };
    const tick = vi.fn();
    refs.composerRef.current = { render: vi.fn() };

    renderFrameAndSampleExposure(refs, renderer, 'scene', 'camera', 0.016, { tick }, 1440, 900);

    expect(tick).toHaveBeenCalledWith(renderer, 1440, 900);
  });

  it('skips the tick cleanly when no autoExposure pass is active (quality=low, or construction failed)', () => {
    const refs = makeRefs();
    const renderer = { render: vi.fn() };
    refs.composerRef.current = { render: vi.fn() };

    expect(() =>
      renderFrameAndSampleExposure(refs, renderer, 'scene', 'camera', 0.016, null, 800, 600)
    ).not.toThrow();
    expect(() =>
      renderFrameAndSampleExposure(refs, renderer, 'scene', 'camera', 0.016, undefined, 800, 600)
    ).not.toThrow();
  });

  it('still dispatches through the real renderSceneFrame branch selection (composer-only path renders, bare renderer does not)', () => {
    const refs = makeRefs();
    const renderer = { render: vi.fn() };
    const composerRender = vi.fn();
    refs.composerRef.current = { render: composerRender };

    renderFrameAndSampleExposure(refs, renderer, 'scene', 'camera', 0.02, null, 800, 600);

    expect(composerRender).toHaveBeenCalledWith(0.02);
    expect(renderer.render).not.toHaveBeenCalled();
  });
});

describe('Phase 5 fix — a throwing render path never freezes the loop', () => {
  it('a throwing composer.render() does not propagate — falls back to renderer.render(scene, camera)', () => {
    const refs = makeRefs();
    const renderer = { render: vi.fn() };
    refs.composerRef.current = { render: () => { throw new Error('shader compile failed'); } };
    const scene = { id: 'scene' };
    const camera = { id: 'camera' };

    expect(() =>
      renderFrameAndSampleExposure(refs, renderer, scene, camera, 0.016, null, 800, 600)
    ).not.toThrow();
    expect(renderer.render).toHaveBeenCalledWith(scene, camera);
  });

  it('a throwing autoExposure.tick() (e.g. a lost-context readPixels) also falls back to a bare render, not just a swallowed error', () => {
    const refs = makeRefs();
    const renderer = { render: vi.fn() };
    refs.composerRef.current = { render: vi.fn() };
    const autoExposure = { tick: () => { throw new Error('INVALID_OPERATION: readPixels'); } };
    const scene = { id: 'scene' };
    const camera = { id: 'camera' };

    renderFrameAndSampleExposure(refs, renderer, scene, camera, 0.016, autoExposure, 800, 600);

    expect(renderer.render).toHaveBeenCalledWith(scene, camera);
  });

  it('reports the error via onError so callers can log it, but still never throws', () => {
    const refs = makeRefs();
    const renderer = { render: vi.fn() };
    refs.composerRef.current = { render: () => { throw new Error('boom'); } };
    const onError = vi.fn();

    expect(() =>
      renderFrameAndSampleExposure(refs, renderer, 'scene', 'camera', 0.016, null, 800, 600, onError)
    ).not.toThrow();
    expect(onError).toHaveBeenCalledTimes(1);
    expect(onError.mock.calls[0][0]).toBeInstanceOf(Error);
  });

  it('even a throwing FALLBACK render (context genuinely gone) is swallowed, not propagated — the caller must always reach its requestAnimationFrame re-arm', () => {
    const refs = makeRefs();
    const renderer = { render: vi.fn(() => { throw new Error('context lost'); }) };
    refs.composerRef.current = { render: () => { throw new Error('composer also dead'); } };
    const onError = vi.fn();

    expect(() =>
      renderFrameAndSampleExposure(refs, renderer, 'scene', 'camera', 0.016, null, 800, 600, onError)
    ).not.toThrow();
    // Called once for the primary failure, once for the fallback failure.
    expect(onError).toHaveBeenCalledTimes(2);
  });

  it('the happy path (nothing throws) does not invoke the fallback render at all', () => {
    const refs = makeRefs();
    const renderer = { render: vi.fn() };
    const composerRender = vi.fn();
    refs.composerRef.current = { render: composerRender };

    renderFrameAndSampleExposure(refs, renderer, 'scene', 'camera', 0.016, { tick: vi.fn() }, 800, 600);

    expect(composerRender).toHaveBeenCalledTimes(1);
    expect(renderer.render).not.toHaveBeenCalled();
  });
});
