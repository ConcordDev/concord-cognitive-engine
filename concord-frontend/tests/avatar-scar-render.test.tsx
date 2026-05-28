// Phase BA5 — confirm AvatarSystem3D wires the scar + drift hook.
//
// We don't render the full Three.js scene in a unit test (jsdom has no
// WebGL). Static assert on the imports + invocation pattern. Same
// shape as the Phase AA2 worker-wired test.

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const FILE = path.resolve(__dirname, '..', 'components', 'world-lens', 'AvatarSystem3D.tsx');

describe('Phase BA5 — scars + drift wired into AvatarSystem3D', () => {
  const source = readFileSync(FILE, 'utf8');

  it('imports useAvatarScars hook', () => {
    expect(source).toMatch(/import\s*\{\s*useAvatarScars\s*\}\s*from\s*['"]@\/hooks\/useAvatarScars['"]/);
  });

  it('invokes useAvatarScars with the player id', () => {
    expect(source).toMatch(/useAvatarScars\s*\(\s*playerAvatar\??\.id\s*\)/);
  });

  it('captures drift into a wear ref the renderer can read', () => {
    expect(source).toMatch(/wearUniformRef/);
    expect(source).toMatch(/u_wear:\s*avatarDrift/);
  });

  it('carries the scars list onto the same ref', () => {
    expect(source).toMatch(/scars:\s*avatarScars/);
  });
});
