// World Lens plan Phase 4 ("Camera") — Free camera mode.
//
// ConcordiaScene.tsx's per-frame camera transform was entirely derived from
// the player's pose (follow/first-person/interior) or a fixed pose
// (isometric) — the guard that gated this block let 'free' through
// (`mode !== 'isometric' && mode !== 'cinematic'`) but no branch inside
// handled it, so the camera simply never moved: a true no-op, confirmed
// live before this fix. CameraControls.tsx already advertised a full "Free
// Camera Controls" hint panel (W/S/A/D) as if it worked.
//
// Fix: 'free' now owns an absolute running position (freeCamPosRef),
// seeded from wherever the camera already was the frame free mode is
// entered (never teleports on switch), flown via WASD relative to the
// shared cameraLookState yaw (the same mouse-look pointer-lock
// first-person/follow already use, extended to cover 'free' too) plus R/F
// for vertical and Shift for a speed boost. AvatarSystem3D.tsx's own WASD
// player-movement listener is separately gated to ignore WASD while
// cameraMode === 'free', so the two don't fight over the same keys — the
// player's own keysRef still fires (unaffected) and the guard is scoped
// exactly to zeroing the movement vector's WASD components, not tracking.
//
// ConcordiaScene.tsx and AvatarSystem3D.tsx pull in Three.js scene
// construction + Rapier physics that aren't mountable in jsdom — this file
// follows the established source-pinning pattern
// (tests/concordia-scene-resource-leak-fix.test.tsx,
// tests/concordia-scene-ultra-postfx-fix.test.tsx) for those two files only.
//
// CameraControls.tsx has no such constraint — it's a plain, prop-driven
// React component with no Three.js/canvas dependency — so its coverage
// below is a real `render()` + `screen` assertion against the mounted
// "Free Camera Controls" hint panel, not a source-text match.

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { render, screen } from '@testing-library/react';
import React from 'react';
import CameraControls, { type CameraState } from '@/components/world-lens/CameraControls';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const sceneSrc = readFileSync(
  path.resolve(__dirname, '..', 'components/world-lens/ConcordiaScene.tsx'),
  'utf8'
);
const avatarSrc = readFileSync(
  path.resolve(__dirname, '..', 'components/world-lens/AvatarSystem3D.tsx'),
  'utf8'
);

describe('Phase 4 fix — ConcordiaScene.tsx: free camera mode owns a real transform', () => {
  it('declares an absolute-position ref and a key-tracking set for free mode', () => {
    expect(sceneSrc).toMatch(/const freeCamPosRef = useRef<\{ x: number; y: number; z: number \} \| null>\(null\);/);
    expect(sceneSrc).toMatch(/const freeCamKeysRef = useRef<Set<string>>\(new Set\(\)\);/);
  });

  it('the pose-driven branch (follow/first-person/interior) now explicitly excludes free mode', () => {
    expect(sceneSrc).toMatch(/if \(mode !== 'isometric' && mode !== 'cinematic' && mode !== 'free' && getPose\) \{/);
  });

  it('free mode seeds its position from the camera\'s current spot the first frame it activates (never teleports)', () => {
    const freeBlock = sceneSrc.match(/if \(mode === 'free'\) \{[\s\S]*?\n {8}\} else if \(freeCamPosRef\.current\) \{/);
    expect(freeBlock).toBeTruthy();
    expect(freeBlock![0]).toMatch(/if \(!freeCamPosRef\.current\) \{\s*\n\s*freeCamPosRef\.current = \{ x: camera\.position\.x, y: camera\.position\.y, z: camera\.position\.z \};/);
  });

  it('clears the seeded position on leaving free mode, so the next entry re-seeds fresh', () => {
    expect(sceneSrc).toMatch(/\} else if \(freeCamPosRef\.current\) \{\s*\n[\s\S]*?\n\s*freeCamPosRef\.current = null;\s*\n\s*\}/);
  });

  it('moves relative to the shared cameraLookState yaw for WASD, with R/F vertical and a Shift speed boost', () => {
    expect(sceneSrc).toMatch(/if \(keys\.has\('w'\)\) \{ dx \+= Math\.sin\(yaw\); dz \+= -Math\.cos\(yaw\); \}/);
    expect(sceneSrc).toMatch(/if \(keys\.has\('r'\)\) fp\.y \+= speed;/);
    expect(sceneSrc).toMatch(/if \(keys\.has\('f'\)\) fp\.y -= speed;/);
    expect(sceneSrc).toMatch(/const boost = keys\.has\('shift'\) \? 2\.5 : 1;/);
  });

  it('applies the new absolute position + look direction to the real THREE.js camera', () => {
    expect(sceneSrc).toMatch(/camera\.position\.set\(fp\.x, fp\.y, fp\.z\);/);
    expect(sceneSrc).toMatch(/camera\.lookAt\(lookX, lookY, lookZ\);/);
  });

  it('extends the pointer-lock mouse-look whitelist to include free mode', () => {
    expect(sceneSrc).toMatch(/if \(mode !== 'follow' && mode !== 'first-person' && mode !== 'interior' && mode !== 'free'\) return;/);
  });

  it('tracks WASD/R/F only while cameraMode is actually free (never intercepts keys in other modes)', () => {
    const handlerBlock = sceneSrc.match(/function handleFreeCamKeyDown\(e: KeyboardEvent\) \{[\s\S]*?\n {4}\}/);
    expect(handlerBlock).toBeTruthy();
    expect(handlerBlock![0]).toMatch(/if \(cameraModeRef\.current !== 'free'\) return;/);
  });

  it('registers and tears down the free-cam key listeners alongside the other canvas/document listeners', () => {
    expect(sceneSrc).toMatch(/window\.addEventListener\('keydown', handleFreeCamKeyDown\);/);
    expect(sceneSrc).toMatch(/window\.addEventListener\('keyup', handleFreeCamKeyUp\);/);
    expect(sceneSrc).toMatch(/window\.removeEventListener\('keydown', handleFreeCamKeyDown\);/);
    expect(sceneSrc).toMatch(/window\.removeEventListener\('keyup', handleFreeCamKeyUp\);/);
  });
});

describe('Phase 4 fix — AvatarSystem3D.tsx: player WASD is suppressed during free camera mode', () => {
  it('the WASD movement-vector computation is gated on cameraMode !== \'free\'', () => {
    expect(avatarSrc).toMatch(/if \(cameraMode !== 'free'\) \{\s*\n\s*if \(keys\.has\('w'\)\) moveZ -= 1;\s*\n\s*if \(keys\.has\('s'\)\) moveZ \+= 1;\s*\n\s*if \(keys\.has\('a'\)\) moveX -= 1;\s*\n\s*if \(keys\.has\('d'\)\) moveX \+= 1;\s*\n\s*\}/);
  });
});

describe('Phase 4 fix — CameraControls.tsx: the Free hint panel matches what is actually wired', () => {
  function freeCameraState(): CameraState {
    return {
      mode: 'free',
      zoom: 50,
      rotation: 'NE',
      followTarget: 'avatar',
      cinematicPlaying: false,
      cinematicTime: 0,
      cinematicDuration: 0,
      transitioning: false,
    };
  }

  it('renders R/F vertical movement and the Shift speed boost in the Free hint panel, not just the original W/S/A/D subset', () => {
    render(
      React.createElement(CameraControls, {
        cameraState: freeCameraState(),
        onModeChange: () => {},
        onZoom: () => {},
        onRotate: () => {},
        onTransition: () => {},
      }),
    );

    expect(screen.getByText('Free Camera Controls')).toBeInTheDocument();

    // Original W/S/A/D subset — still present.
    expect(screen.getByText('W').closest('span')).toHaveTextContent('Forward');
    expect(screen.getByText('S').closest('span')).toHaveTextContent('Back');
    expect(screen.getByText('A').closest('span')).toHaveTextContent('Left');
    expect(screen.getByText('D').closest('span')).toHaveTextContent('Right');

    // The fix under test: R/F vertical + Shift speed boost actually render.
    expect(screen.getByText('R').closest('span')).toHaveTextContent('Up');
    expect(screen.getByText('F').closest('span')).toHaveTextContent('Down');
    expect(screen.getByText('Shift').closest('span')).toHaveTextContent('Speed boost');
  });
});
