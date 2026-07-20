/**
 * World Lens plan Phase 6c — ConcordiaScene's camera-punch hit-stop shake
 * + FOV zoom-kick (Sprint 1 juice) had zero reduced-motion gating before
 * this fix. It's real WebGL camera transform math (positional/rotational
 * shake applied to `camera.position`/`camera.rotation.z`, plus a fast FOV
 * punch-zoom) — exactly the vestibular-trigger effects
 * `prefers-reduced-motion` exists for, and it sits outside what the
 * app-wide `AccessibilityDOMApplier` (a CSS-level `html.a11y-reduce-motion
 * *` animation kill) can reach, since it isn't a DOM/CSS animation.
 *
 * Source-pinning (not a render test) per this session's established
 * pattern for this file — ConcordiaScene is a heavy imperative Three.js
 * component well beyond what jsdom can usefully mount.
 */

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const src = readFileSync(
  path.resolve(__dirname, '..', 'components/world-lens/ConcordiaScene.tsx'),
  'utf8'
);

describe('ConcordiaScene — camera-punch reduced-motion gate (Phase 6c)', () => {
  it('imports useAccessibilitySettings', () => {
    expect(src).toMatch(/import \{ useAccessibilitySettings \} from '@\/hooks\/useAccessibilitySettings';/);
  });

  it('reads effectiveReducedMotion and mirrors it into a ref (matching the inputModeRef pattern)', () => {
    expect(src).toMatch(/const \{ effectiveReducedMotion \} = useAccessibilitySettings\(\);/);
    expect(src).toMatch(/const reducedMotionRef = useRef\(effectiveReducedMotion\);/);
    expect(src).toMatch(/useEffect\(\(\) => \{ reducedMotionRef\.current = effectiveReducedMotion; \}, \[effectiveReducedMotion\]\);/);
  });

  it('handleCameraPunch early-returns on reducedMotionRef before touching the trauma engine or the punch window', () => {
    const handlerIdx = src.indexOf('const handleCameraPunch = (e: Event) => {');
    expect(handlerIdx).toBeGreaterThan(-1);
    const handlerSlice = src.slice(handlerIdx, handlerIdx + 1000);
    const guardIdx = handlerSlice.indexOf('if (reducedMotionRef.current) return;');
    const traumaIdx = handlerSlice.indexOf('traumaShakeRef.current.addTrauma');
    const punchRefIdx = handlerSlice.indexOf('cameraPunchRef.current = {');
    expect(guardIdx).toBeGreaterThan(-1);
    expect(guardIdx).toBeLessThan(traumaIdx);
    expect(guardIdx).toBeLessThan(punchRefIdx);
  });

  it('the guard is inside the concordia:camera-punch handler, not a different one', () => {
    const punchIdx = src.indexOf('const handleCameraPunch');
    const listenerIdx = src.indexOf("window.addEventListener('concordia:camera-punch', handleCameraPunch);");
    expect(punchIdx).toBeGreaterThan(-1);
    expect(listenerIdx).toBeGreaterThan(punchIdx);
  });
});
