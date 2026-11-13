// FIX-government-015: the case-files library view rendered TWO primary
// "New <type>" buttons at once — one in the panel header, one in the
// library toolbar. Source-pin: exactly one such button exists in the
// panel (the header's, the consistent position across views).
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const SRC = readFileSync(join(__dirname, 'CaseOpsPanel.tsx'), 'utf8');

describe('CaseOpsPanel New-button duplication (FIX-government-015)', () => {
  it('renders exactly one New <type> primary button', () => {
    const occurrences = SRC.match(/New \{currentType\}/g) ?? [];
    expect(occurrences.length).toBe(1);
  });

  it('the surviving button is the panel header one', () => {
    const headerAt = SRC.indexOf('<header className="flex items-center justify-between gap-3 flex-wrap">');
    const buttonAt = SRC.indexOf('New {currentType}');
    expect(headerAt).toBeGreaterThan(-1);
    expect(buttonAt).toBeGreaterThan(headerAt);
  });
});
