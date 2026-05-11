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
const EXPERT_PATH = path.resolve(__dirname, '..', 'app/lenses/expert-mode/page.tsx');
const BYO_SRC = fs.readFileSync(BYO_PATH, 'utf8');
const EXPERT_SRC = fs.readFileSync(EXPERT_PATH, 'utf8');

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
    expect(EXPERT_SRC).toContain('renderAnswerWithChips');
    expect(EXPERT_SRC).toMatch(/\[\\s\*\(\\d\+/); // the [N] regex literal
  });

  test('surfaces cascade citation count when > 0', () => {
    expect(EXPERT_SRC).toMatch(/citationsRecorded/);
    expect(EXPERT_SRC).toMatch(/cascade citation/i);
  });

  test('links to /lenses/byo-keys for key configuration', () => {
    expect(EXPERT_SRC).toContain('/lenses/byo-keys');
  });

  test('shows "Concord default (free Ollama)" badge when no override', () => {
    expect(EXPERT_SRC).toMatch(/Concord default \(free Ollama\)/);
  });

  test('describes the revolving door in the empty state', () => {
    expect(EXPERT_SRC).toMatch(/revolving door/i);
  });
});
