// FIX-debug-015: metric-series answers an unnamed request with the
// metric list only, so the panel's first mount rendered "No samples yet"
// over samples that exist until a chip was clicked. Source-pin: the
// load path opens on the first returned metric when none is active.
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const SRC = readFileSync(join(__dirname, 'MetricsAndAlerts.tsx'), 'utf8');

describe('Metrics default selection (FIX-debug-015)', () => {
  it('defaults the active metric to the first returned name', () => {
    expect(SRC).toContain('if (!metric && names.length > 0) setActiveMetric(names[0]);');
  });
});
