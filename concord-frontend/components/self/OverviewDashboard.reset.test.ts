// FIX-self-010: the overview editor offered no way back to the default
// layout. Source-pin: a Reset control exists and routes to resetLayout.
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const SRC = readFileSync(join(__dirname, 'OverviewDashboard.tsx'), 'utf8');

describe('Overview layout reset (FIX-self-010)', () => {
  it('the editor carries a Reset to default control wired to resetLayout', () => {
    expect(SRC).toContain("lensRun('self', 'resetLayout', {})");
    expect(SRC).toContain('Reset to default');
  });
});
