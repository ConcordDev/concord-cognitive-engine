// FIX-dx-platform-017 — PR Review must not present non-diff text as a
// clean review, and emptying the input must clear the old results.
// Source-level pins on the workbench (the import-names pattern).
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const wb = readFileSync(path.resolve(__dirname, '..', 'components/dx-platform/DxWorkbench.tsx'), 'utf8');

describe('FIX-dx-platform-017 — PR Review input honesty', () => {
  it('warns Not a unified diff before sending header-less text', () => {
    expect(wb).toContain('Not a unified diff');
    expect(wb).toContain("l.startsWith('+++ ')");
  });
  it('surfaces a server refusal instead of leaving silence', () => {
    expect(wb).toContain("err === 'not_a_diff' ? NOT_A_DIFF_MSG");
    expect(wb).toContain('role="alert"');
  });
  it('clears the previous review when the input is emptied', () => {
    expect(wb).toContain('if (!e.target.value.trim())');
    expect(wb).toContain('setResult(null); setDecisions({}); setGate(null); setTrend(null); setReviewError(null);');
  });
});
