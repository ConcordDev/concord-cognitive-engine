// World Lens plan Phase 4 ("Camera") — Cinematic camera mode wiring.
//
// lib/world-lens/cinematic-director.ts's own doc comment claims: "Director
// takes camera control from CameraControls.tsx for the sequence duration,
// restores afterward." Neither half was true before this fix: (1) it
// dispatches concordia:cinematic-shot per shot with a real named camera
// template, but nothing listened, so the actual THREE.js camera never
// moved through a triggered sequence; (2) it dispatches
// concordia:cinematic-start/-end (consumed by the letterbox UI), but
// nothing ever switched app/lenses/world/page.tsx's cameraMode state to
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

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const sceneSrc = readFileSync(
  path.resolve(__dirname, '..', 'components/world-lens/ConcordiaScene.tsx'),
  'utf8'
);
const pageSrc = readFileSync(
  path.resolve(__dirname, '..', 'app/lenses/world/page.tsx'),
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

  it('the render loop interpolates position/lookAt/tilt every frame while cinematic mode is active with a shot queued', () => {
    const region = sceneSrc.match(
      /if \(mode === 'cinematic' && cinematicShotRef\.current\) \{[\s\S]*?\n {8}\}/
    );
    expect(region).toBeTruthy();
    const block = region![0];
    expect(block).toMatch(/const t = applyEasing\(cs\.easing, elapsedMs \/ cs\.durationMs\);/);
    expect(block).toMatch(/camera\.position\.set\(px, py, pz\);/);
    expect(block).toMatch(/camera\.lookAt\(lx, ly, lz\);/);
    expect(block).toMatch(/camera\.rotation\.z = cs\.startTilt \+ \(cs\.target\.tiltRad - cs\.startTilt\) \* t;/);
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
