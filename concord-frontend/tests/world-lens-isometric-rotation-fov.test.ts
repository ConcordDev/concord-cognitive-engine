// World Lens plan Phase 4 ("Camera") — isometric orbit rotation +
// context-sensitive FOV (the last two items in the phase's camera work,
// alongside Free mode and Cinematic mode covered by their own test files).
//
// Isometric mode was excluded from ConcordiaScene.tsx's per-frame camera
// update entirely — a fixed pose set once at scene construction
// (camera.position.set(200,150,200); camera.lookAt(0,0,0)) and never
// revisited, despite CameraControls.tsx's NE/SE/SW/NW compass buttons
// implying rotation worked (they were disabled with a "coming soon" label
// as a Phase 1d honesty fix, pending this phase).
//
// Context-sensitive FOV: HUDContextProvider's real, already-live
// `inputMode` (exploration/combat/dialogue/vehicle/photo/creation/
// spectator/lens_work) had almost no consumers anywhere in the app — the
// camera was never one of them. The existing camera-punch hit-stop kick
// and PhotoMode's freecam zoom both hardcoded a neutral base FOV of 55;
// both now read a dynamic, inputMode-driven base instead.
//
// Zoom interpolation (the plan's third Phase 4 camera item) turned out to
// already be handled: the follow/interior camera position is recomputed
// fresh from cameraZoomRef every frame and then LERPED toward that target
// (`delta * 8`) — a zoom slider/button change was already smoothly
// absorbed by that existing position lerp before this phase touched
// anything. No separate zoom-lerp code was added (it would have been
// redundant, and double-smoothing masks responsiveness) — noted here so
// this isn't mistaken for an unaddressed item.
//
// ConcordiaScene.tsx and page.tsx pull in Three.js/DOM dependencies too
// heavy for jsdom — this file follows the established source-pinning
// pattern (tests/world-lens-free-camera-mode.test.ts,
// tests/world-lens-cinematic-camera-mode.test.ts).

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
  path.resolve(__dirname, '..', 'components/world/WorldOsSurface.tsx'),
  'utf8'
);

describe('Phase 4 fix — isometric orbit rotation', () => {
  it('defines the four compass angles, with NE reproducing the original hardcoded pose', () => {
    expect(sceneSrc).toMatch(/const ISOMETRIC_ANGLES: Record<'NE' \| 'SE' \| 'SW' \| 'NW', number> = \{\s*\n\s*NE: Math\.PI \/ 4,/);
  });

  it('accepts a real isometricRotation prop, mirrored into a ref', () => {
    expect(sceneSrc).toMatch(/isometricRotation\?: 'NE' \| 'SE' \| 'SW' \| 'NW';/);
    expect(sceneSrc).toMatch(/const isometricRotationRef = useRef\(isometricRotation\);/);
    expect(sceneSrc).toMatch(/useEffect\(\(\) => \{ isometricRotationRef\.current = isometricRotation; \}, \[isometricRotation\]\);/);
  });

  it('orbits around origin at the original fixed distance/height, eased toward the target angle by the shortest path', () => {
    const block = sceneSrc.match(/if \(mode === 'isometric'\) \{[\s\S]*?\n {8}\}/);
    expect(block).toBeTruthy();
    const b = block![0];
    expect(b).toMatch(/const dist = 282\.84;/);
    expect(b).toMatch(/const height = 150;/);
    expect(b).toMatch(/while \(angleDiff > Math\.PI\) angleDiff -= Math\.PI \* 2;/);
    expect(b).toMatch(/while \(angleDiff < -Math\.PI\) angleDiff \+= Math\.PI \* 2;/);
    expect(b).toMatch(/camera\.position\.set\(Math\.sin\(angle\) \* dist, height, Math\.cos\(angle\) \* dist\);/);
    expect(b).toMatch(/camera\.lookAt\(0, 0, 0\);/);
  });
});

describe('Phase 4 fix — CameraControls.tsx rotation compass re-enabled + page.tsx real state', () => {
  it('page.tsx declares real cameraRotation state (was a hardcoded literal + no-op onRotate)', () => {
    expect(pageSrc).toMatch(/const \[cameraRotation, setCameraRotation\] = useState<'NE' \| 'SE' \| 'SW' \| 'NW'>\('NE'\);/);
  });

  it('page.tsx threads cameraRotation into both ConcordiaScene and CameraControls', () => {
    expect(pageSrc).toMatch(/isometricRotation=\{cameraRotation\}/);
    expect(pageSrc).toMatch(/rotation: cameraRotation,/);
    expect(pageSrc).toMatch(/onRotate=\{setCameraRotation\}/);
  });
});

describe('Phase 4 fix — context-sensitive FOV', () => {
  it('imports the real HUDContextProvider store and reads inputMode via a selector', () => {
    expect(sceneSrc).toMatch(/import \{ useHUDContext \} from '@\/components\/world\/concordia-hud\/HUDContextProvider';/);
    expect(sceneSrc).toMatch(/const inputMode = useHUDContext\(\(s\) => s\.inputMode\);/);
    expect(sceneSrc).toMatch(/const inputModeRef = useRef\(inputMode\);/);
  });

  it('defines a distinct FOV target for every real InputMode value, not just a subset', () => {
    // HUDContextProvider.tsx's InputMode union — kept in sync manually since
    // it's a plain string-keyed object, not the union type itself.
    for (const mode of ['exploration', 'combat', 'dialogue', 'vehicle', 'photo', 'creation', 'spectator', 'lens_work']) {
      expect(sceneSrc).toMatch(new RegExp(`\\b${mode}: `));
    }
    // Combat/vehicle widen for awareness/speed; dialogue tightens for intimacy.
    expect(sceneSrc).toMatch(/combat: 62,/);
    expect(sceneSrc).toMatch(/dialogue: 42,/);
    expect(sceneSrc).toMatch(/vehicle: 68,/);
  });

  it('eases contextFovRef toward the target every frame, applied before the punch/freecam blocks so they still layer on top', () => {
    const fovBlockIdx = sceneSrc.indexOf('const targetFov = INPUT_MODE_FOV[inputModeRef.current] ?? BASE_FOV;');
    const punchBlockIdx = sceneSrc.indexOf("// Sprint 1 (juice) — apply the camera-punch impulse");
    expect(fovBlockIdx).toBeGreaterThan(-1);
    expect(punchBlockIdx).toBeGreaterThan(fovBlockIdx);
  });

  it('the punch kick and its settle-back now read the dynamic context base instead of a hardcoded 55', () => {
    expect(sceneSrc).toMatch(/const baseFov = contextFovRef\.current;/);
    expect(sceneSrc).toMatch(/\} else if \(punch\.fov > 0 && Math\.abs\(camera\.fov - contextFovRef\.current\) > 0\.01\) \{/);
    expect(sceneSrc).toMatch(/camera\.fov = contextFovRef\.current;\s*\n\s*camera\.updateProjectionMatrix\(\);\s*\n\s*\}\s*\n\s*\}\s*\n\s*\n\s*\/\/ Phase BE1/);
  });
});
