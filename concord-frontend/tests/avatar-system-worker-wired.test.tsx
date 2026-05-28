// Phase AA2 — confirm AvatarSystem3D imports + uses useAvatarAnimator.
//
// We don't render the full Three.js scene in a unit test (jsdom doesn't
// have WebGL); instead we statically assert the import + invocation
// pattern is present in the file. This pins the wiring against future
// regressions where the hook gets accidentally removed.

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const FILE = path.resolve(__dirname, '..', 'components', 'world-lens', 'AvatarSystem3D.tsx');

describe('Phase AA2 — Avatar Web Worker wired into AvatarSystem3D', () => {
  const source = readFileSync(FILE, 'utf8');

  it('imports useAvatarAnimator', () => {
    expect(source).toMatch(/import\s*\{\s*useAvatarAnimator\s*\}\s*from\s*['"]@\/hooks\/useAvatarAnimator['"]/);
  });

  it('imports serializableToGaitPose', () => {
    expect(source).toMatch(/import\s*\{\s*serializableToGaitPose\s*\}\s*from\s*['"]@\/lib\/concordia\/animator-protocol['"]/);
  });

  it('initialises the hook inside the component', () => {
    expect(source).toMatch(/const\s+avatarAnimator\s*=\s*useAvatarAnimator\(\)/);
  });

  it('calls avatarAnimator.requestGait at least twice (player + NPC)', () => {
    const matches = source.match(/avatarAnimator\.requestGait\(/g) || [];
    expect(matches.length).toBeGreaterThanOrEqual(2);
  });

  it('falls back to inline synthesizeGait when worker returns null', () => {
    // The fallback pattern: `workerPose ? serializableToGaitPose(workerPose) : synthesizeGait(...)`
    expect(source).toMatch(/serializableToGaitPose\(workerPose\)\s*:\s*synthesizeGait/);
  });
});
