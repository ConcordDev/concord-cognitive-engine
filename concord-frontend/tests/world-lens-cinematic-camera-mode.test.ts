// World Lens plan Phase 4 ("Camera") — Cinematic camera mode wiring.
//
// lib/world-lens/cinematic-director.ts's own doc comment claims: "Director
// takes camera control from CameraControls.tsx for the sequence duration,
// restores afterward." Neither half was true before this fix: (1) it
// dispatches concordia:cinematic-shot per shot with a real named camera
// template, but nothing listened, so the actual THREE.js camera never
// moved through a triggered sequence; (2) it dispatches
// concordia:cinematic-start/-end (consumed by the letterbox UI), but
// nothing ever switched components/world/WorldOsSurface.tsx's cameraMode state to
// 'cinematic', so ConcordiaScene.tsx's per-frame camera code (gated on
// cameraMode !== 'cinematic') never even ran for a director-triggered
// sequence — only for a user manually picking "Cinematic" from the
// CameraControls dropdown, which the director itself never does.
//
// Fix: page.tsx now listens for cinematic-start/-end and switches
// cameraMode to 'cinematic' (saving/restoring whatever mode was active),
// and ConcordiaScene.tsx listens for cinematic-shot, resolves the target
// framing via cinematic-shot-geometry.ts's computeShotFraming (see
// tests/lib/cinematic-shot-geometry.test.ts for the real behavioral
// coverage of that pure function), and interpolates the real camera
// every frame while cameraMode === 'cinematic'.
//
// ConcordiaScene.tsx and page.tsx pull in Three.js scene construction that
// isn't mountable in jsdom — this file follows the established
// source-pinning pattern (tests/concordia-scene-resource-leak-fix.test.tsx,
// tests/world-lens-free-camera-mode.test.ts).

import { describe, it, expect, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { applyCinematicShotFrame } from '@/components/world-lens/ConcordiaScene';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const sceneSrc = readFileSync(
  path.resolve(__dirname, '..', 'components/world-lens/ConcordiaScene.tsx'),
  'utf8'
);
const pageSrc = readFileSync(
  path.resolve(__dirname, '..', 'components/world/WorldOsSurface.tsx'),
  'utf8'
);

describe('Phase 4 fix — ConcordiaScene.tsx: cinematic-shot events drive the real camera', () => {
  it('imports the shot-geometry helpers', () => {
    expect(sceneSrc).toMatch(/import \{ computeShotFraming, applyEasing, type ShotFraming \} from '@\/lib\/world-lens\/cinematic-shot-geometry';/);
  });

  it('declares a ref holding the active shot\'s start→target interpolation state', () => {
    expect(sceneSrc).toMatch(/const cinematicShotRef = useRef<\{/);
    expect(sceneSrc).toMatch(/target: ShotFraming;/);
  });

  it('listens for concordia:cinematic-shot and resolves target framing via computeShotFraming', () => {
    const handlerBlock = sceneSrc.match(/function handleCinematicShot\(e: Event\) \{[\s\S]*?\n {4}\}/);
    expect(handlerBlock).toBeTruthy();
    expect(handlerBlock![0]).toMatch(/const target = computeShotFraming\(/);
  });

  it('honestly skips NPC-targeted shots instead of guessing a position (no NPC lookup exists in this component)', () => {
    expect(sceneSrc).toMatch(/if \(detail\.target_npc\) return; \/\/ honest gap/);
  });

  it('match_cut interpolates near-instantly regardless of the shot\'s own duration_ms', () => {
    expect(sceneSrc).toMatch(/const interpMs = detail\.camera === 'match_cut' \? 120 : Math\.max\(200, detail\.duration_ms \?\? 1000\);/);
  });

  it('registers and tears down the cinematic-shot listener', () => {
    expect(sceneSrc).toMatch(/window\.addEventListener\('concordia:cinematic-shot', handleCinematicShot\);/);
    expect(sceneSrc).toMatch(/window\.removeEventListener\('concordia:cinematic-shot', handleCinematicShot\);/);
  });

});

describe('Phase 4 fix — applyCinematicShotFrame: real per-frame interpolation', () => {
  it('the render loop is wired to this real function (source pin) AND the function itself interpolates position/lookAt/tilt from the shot start toward its target, easing by elapsed/duration (real fake-camera call)', () => {
    // The render-loop call site: `if (mode === 'cinematic' && ...) { applyCinematicShotFrame(camera, cinematicShotRef.current, performance.now()); }`.
    // ConcordiaScene.tsx can't be mounted in jsdom (no WebGL/Rapier), so the
    // wiring fact stays a source pin — but it sits in THIS test, alongside a
    // real call into the exact same exported function below, rather than
    // standing alone as an unverifiable claim.
    expect(sceneSrc).toMatch(/if \(mode === 'cinematic' && cinematicShotRef\.current\) \{\s*\n\s*applyCinematicShotFrame\(camera, cinematicShotRef\.current, performance\.now\(\)\);\s*\n\s*\}/);

    const positionSet = vi.fn();
    const lookAt = vi.fn();
    const camera = { position: { set: positionSet }, lookAt, rotation: { z: 0 } };
    const cs = {
      startPos: { x: 0, y: 0, z: 0 },
      startLook: { x: 0, y: 0, z: -1 },
      startTilt: 0,
      target: { position: { x: 10, y: 20, z: 30 }, lookAt: { x: 1, y: 2, z: 3 }, tiltRad: 0.4 },
      startTime: 1000,
      durationMs: 1000,
      easing: 'linear',
    };

    // Halfway through the shot (linear easing => t === 0.5).
    applyCinematicShotFrame(camera, cs, 1500);

    expect(positionSet).toHaveBeenCalledWith(5, 10, 15);
    expect(lookAt).toHaveBeenCalledWith(0.5, 1, 1);
    expect(camera.rotation.z).toBeCloseTo(0.2, 10);
  });

  it('reaches the exact target framing once elapsed time reaches the shot duration', () => {
    const positionSet = vi.fn();
    const lookAt = vi.fn();
    const camera = { position: { set: positionSet }, lookAt, rotation: { z: 0 } };
    const cs = {
      startPos: { x: 0, y: 0, z: 0 },
      startLook: { x: 0, y: 0, z: -1 },
      startTilt: 0,
      target: { position: { x: 10, y: 20, z: 30 }, lookAt: { x: 1, y: 2, z: 3 }, tiltRad: 0.4 },
      startTime: 0,
      durationMs: 1000,
      easing: 'linear',
    };

    applyCinematicShotFrame(camera, cs, 1000);

    expect(positionSet).toHaveBeenCalledWith(10, 20, 30);
    expect(lookAt).toHaveBeenCalledWith(1, 2, 3);
    expect(camera.rotation.z).toBeCloseTo(0.4, 10);
  });

  it('holds the start framing at elapsed === 0 (a shot that just started this frame)', () => {
    const positionSet = vi.fn();
    const lookAt = vi.fn();
    const camera = { position: { set: positionSet }, lookAt, rotation: { z: 0 } };
    const cs = {
      startPos: { x: 5, y: 5, z: 5 },
      startLook: { x: 0, y: 0, z: -1 },
      startTilt: 0.1,
      target: { position: { x: 10, y: 20, z: 30 }, lookAt: { x: 1, y: 2, z: 3 }, tiltRad: 0.4 },
      startTime: 2000,
      durationMs: 1000,
      easing: 'linear',
    };

    applyCinematicShotFrame(camera, cs, 2000);

    expect(positionSet).toHaveBeenCalledWith(5, 5, 5);
    expect(lookAt).toHaveBeenCalledWith(0, 0, -1);
    expect(camera.rotation.z).toBeCloseTo(0.1, 10);
  });
});

describe('Phase 4 fix — page.tsx: cinematic-director.ts\'s "takes camera control, restores afterward" contract is real', () => {
  it('listens for concordia:cinematic-start and switches cameraMode to cinematic, saving the prior mode', () => {
    const block = pageSrc.match(/function onCinematicStart\(\) \{[\s\S]*?\n {4}\}/);
    expect(block).toBeTruthy();
    expect(block![0]).toMatch(/setCameraMode\(\(prev\) => \{\s*\n\s*preCinematicCameraModeRef\.current = prev;\s*\n\s*return 'cinematic';\s*\n\s*\}\);/);
  });

  it('listens for concordia:cinematic-end and restores the saved prior mode', () => {
    const block = pageSrc.match(/function onCinematicEnd\(\) \{[\s\S]*?\n {4}\}/);
    expect(block).toBeTruthy();
    expect(block![0]).toMatch(/const prev = preCinematicCameraModeRef\.current;\s*\n\s*if \(prev\) setCameraMode\(prev\);/);
  });

  it('registers and tears down both listeners', () => {
    expect(pageSrc).toMatch(/window\.addEventListener\('concordia:cinematic-start', onCinematicStart\);/);
    expect(pageSrc).toMatch(/window\.addEventListener\('concordia:cinematic-end', onCinematicEnd\);/);
    expect(pageSrc).toMatch(/window\.removeEventListener\('concordia:cinematic-start', onCinematicStart\);/);
    expect(pageSrc).toMatch(/window\.removeEventListener\('concordia:cinematic-end', onCinematicEnd\);/);
  });
});
