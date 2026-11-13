/**
 * FIX-hypothesis-003 — a 300-character Lab statement enabled Propose,
 * and the Statistics t-test left Run Test enabled with empty samples
 * and alpha = 2, with no min/max or aria-invalid anywhere. The
 * statement is now capped at 280 with a live counter (the fleet's
 * capped-field shape); Run Test disables until the samples are real
 * and alpha is in (0, 1); the alpha input carries type/min/max/step
 * and aria-invalid with a worded hint.
 */
import { describe, it, expect } from 'vitest';
import * as fs from 'node:fs';
import * as path from 'node:path';

const read = (p: string) => fs.readFileSync(path.join(process.cwd(), p), 'utf8');

describe('FIX-hypothesis-003 — proposal + statistics input validation', () => {
  const lab = read('components/hypothesis/HypothesisLab.tsx');
  const stats = read('components/hypothesis/StatsWorkbench.tsx');

  it('the statement is capped with a live counter', () => {
    expect(lab).toContain('maxLength={280}');
    expect(lab).toContain('{newStatement.length} / 280');
  });

  it('Run Test is gated on sample and alpha validity', () => {
    expect(stats).toContain('const canRun = alphaValid && inputsValid');
    expect(stats).toContain('disabled={busy || !canRun}');
    expect(stats).toContain("tKind === 'one-sample'");
  });

  it('the alpha input is a ranged number field with aria-invalid', () => {
    expect(stats).toContain('type="number" min={0.001} max={0.999} step={0.01}');
    expect(stats).toContain('aria-invalid={!alphaValid}');
    expect(stats).toContain('α must be between 0 and 1 (exclusive).');
  });
});
