// Phase BA5 — confirm AvatarSystem3D wires the scar + drift hook.
//
// AvatarSystem3D.tsx is too large/heavy (refs, THREE.js scene graph,
// animation mixers) to mount and render in jsdom — same exemption this
// repo already applies to every other file in components/world-lens/ (see
// tests/world-lens-discharge-flash-wiring.test.ts's header comment and
// scripts/check-diff-coverage.mjs's SKIP array).
//
// What CAN be — and now is — exercised for real:
//   - `buildAvatarWearState`, the pure function AvatarSystem3D's effect
//     uses to turn a live `{ scars, drift }` snapshot into the shape the
//     per-frame render block reads off `wearUniformRef.current`. It's
//     exported from AvatarSystem3D.tsx specifically so this file can
//     exercise the REAL production function with real inputs instead of
//     regex-matching source text (same pattern as
//     world-lens-discharge-flash-wiring.test.ts's resolveDischargeVfx).
//   - `useAvatarScars` itself, real-rendered via `renderHook` + a mocked
//     `fetch`, at tests/hooks/useAvatarScars.test.ts — proves the hook
//     actually fetches/parses/clamps scars+drift, independent of
//     AvatarSystem3D.
//
// What's left as a static/structural pin (retitled, not faked, and kept
// in its own describe block with no behavior-claim language): whether
// AvatarSystem3D.tsx's own source names `useAvatarScars` in an import and
// a call-site pattern — a fact about that file's own unrendered source,
// not something this file can exercise at runtime without mounting the
// scene.

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildAvatarWearState } from '@/components/world-lens/AvatarSystem3D';
import type { AvatarScar } from '@/hooks/useAvatarScars';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const FILE = path.resolve(__dirname, '..', 'components', 'world-lens', 'AvatarSystem3D.tsx');

describe('AvatarSystem3D.tsx — static source facts about useAvatarScars (source-text pins, not runtime-verified)', () => {
  const source = readFileSync(FILE, 'utf8');

  it('source contains an import statement naming useAvatarScars (static pin — see this file\'s header for why it is not runtime-verified)', () => {
    expect(source).toMatch(/import\s*\{[^}]*\buseAvatarScars\b[^}]*\}\s*from\s*['"]@\/hooks\/useAvatarScars['"]/);
  });

  it('source contains a useAvatarScars(playerAvatar?.id) invocation pattern (static pin — see this file\'s header for why it is not runtime-verified)', () => {
    expect(source).toMatch(/useAvatarScars\s*\(\s*playerAvatar\??\.id\s*\)/);
  });
});

describe('Phase BA5 — buildAvatarWearState real behavior (scars + drift → wear-ref shape)', () => {
  // Real behavior: exercise the actual production function with real
  // inputs and assert on its real output. No source-text matching
  // involved anywhere in these two blocks.
  it('captures drift into the u_wear field the renderer reads', () => {
    const scars: AvatarScar[] = [];
    expect(buildAvatarWearState(0, scars).u_wear).toBe(0);
    expect(buildAvatarWearState(0.42, scars).u_wear).toBe(0.42);
    expect(buildAvatarWearState(1, scars).u_wear).toBe(1);
  });

  it('carries the real scars list through onto the same result, unmodified', () => {
    const scars: AvatarScar[] = [
      { id: 's1', region: 'torso', source: 'combat', severity: 0.6, acquired_at: 1000, visible_label: 'old wound' },
      { id: 's2', region: 'arms', source: 'fall', severity: 0.2, acquired_at: 2000, visible_label: null },
    ];
    const result = buildAvatarWearState(0.3, scars);
    expect(result.scars).toBe(scars); // same reference — pass-through, not a copy or a fabrication
    expect(result.scars).toHaveLength(2);
    expect(result.scars[0].id).toBe('s1');
    expect(result.scars[1].source).toBe('fall');
  });
});
