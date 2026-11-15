/**
 * FIX-ethics-011 — the Multi-Framework toolkit only explained its
 * scoring inputs AFTER a submit came back 'Unscored'. The guidance
 * now appears before Analyze whenever a named option is missing its
 * benefit/harm scores, and the option fields carry accessible names.
 */
import { describe, it, expect } from 'vitest';
import * as fs from 'node:fs';
import * as path from 'node:path';

const read = (p: string) => fs.readFileSync(path.join(process.cwd(), p), 'utf8');

describe('FIX-ethics-011 — guidance before submit', () => {
  const s = read('components/ethics/DecisionToolkit.tsx');

  it('shows the scoring guidance while a named option lacks scores', () => {
    expect(s).toContain("o.name.trim() && (o.benefitScore === '' || o.harmScore === '')");
    expect(s).toContain('give each option both scores (0–100), or describe it with ethical keywords, before analyzing');
  });

  it('option fields are named', () => {
    expect(s).toContain('aria-label={`Option ${i + 1} benefit score 0-100`}');
    expect(s).toContain('aria-label={`Option ${i + 1} harm score 0-100`}');
  });
});
