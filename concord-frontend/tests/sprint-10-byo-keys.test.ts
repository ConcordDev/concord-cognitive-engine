// concord-frontend/tests/sprint-10-byo-keys.test.ts
//
// Sprint 10D acceptance — frontend wire-up checks.
//
// We can't render the full Next.js page in vitest without a Next app
// runtime, so this test reads the page source and pins the integration
// points: the macros are called with correct domain/name pairs, the
// provider-badge map covers all 4 providers, and the page mounts the
// expected layout primitives.

import { describe, test, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';

const BYO_PATH = path.resolve(__dirname, '..', 'app/lenses/byo-keys/page.tsx');
const BYO_SRC = fs.readFileSync(BYO_PATH, 'utf8');

// The expert-mode lens was refactored to delegate to components/expert-mode/*;
// scan the page + every expert-mode component as one integration surface.
function readDirSrc(rel: string): string {
  const dir = path.resolve(__dirname, '..', rel);
  try {
    return fs.readdirSync(dir)
      .filter(f => f.endsWith('.tsx') || f.endsWith('.ts'))
      .map(f => fs.readFileSync(path.join(dir, f), 'utf8'))
      .join('\n');
  } catch { return ''; }
}
const EXPERT_SRC =
  fs.readFileSync(path.resolve(__dirname, '..', 'app/lenses/expert-mode/page.tsx'), 'utf8') +
  '\n' + readDirSrc('components/expert-mode');

describe('Sprint 10D — BYO keys lens', () => {
  test('calls all 5 byo_keys macros', () => {
    for (const macro of ['list', 'set', 'remove', 'set_active', 'test', 'available_providers']) {
      expect(BYO_SRC).toContain(`'${macro}'`);
    }
  });

  test('renders all 5 brain slots', () => {
    for (const slot of ['conscious', 'subconscious', 'utility', 'repair', 'vision']) {
      expect(BYO_SRC).toContain(`'${slot}'`);
    }
  });

  test('API key field is type=password (never plaintext in DOM)', () => {
    expect(BYO_SRC).toContain('type="password"');
  });

  test('warns user about non-recoverability after save', () => {
    expect(BYO_SRC).toMatch(/never returned to the frontend after save/i);
  });

  test('describes the revolving door mechanic in the footer copy', () => {
    expect(BYO_SRC).toMatch(/revolving door/i);
    expect(BYO_SRC).toMatch(/cascade/i);
  });
});

describe('Sprint 10D — Expert mode lens', () => {
  test('calls expert_mode.answer macro', () => {
    expect(EXPERT_SRC).toContain("'expert_mode'");
    expect(EXPERT_SRC).toContain("'answer'");
  });

  test('renders provider badges for all 4 providers', () => {
    for (const provider of ['anthropic', 'openai', 'xai', 'google']) {
      expect(EXPERT_SRC).toContain(provider);
    }
  });

  test('renders citation chips inline in the answer', () => {
    expect(EXPERT_SRC).toMatch(/chip/i);
    expect(EXPERT_SRC).toMatch(/citation/i);
  });

  test('surfaces cascade citation count when > 0', () => {
    expect(EXPERT_SRC).toMatch(/citationsRecorded/);
    expect(EXPERT_SRC).toMatch(/cascade/i);
  });

  test('links to /lenses/byo-keys for key configuration', () => {
    expect(EXPERT_SRC).toContain('/lenses/byo-keys');
  });

  test('describes the free-Ollama default when no BYO override is set', () => {
    expect(EXPERT_SRC).toMatch(/free Ollama/i);
  });

  test('describes BYO provider routing on the expert-mode surface', () => {
    expect(EXPERT_SRC).toMatch(/provider/i);
    expect(EXPERT_SRC).toMatch(/byo/i);
  });
});
