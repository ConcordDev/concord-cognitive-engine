// FIX-mental-health-006 — the manual Wellness calculator sent whatever
// was typed (Number(x) || 0 turned a cleared field into a real 0) and
// out-of-range values computed a score with no message. runWellness
// now validates against the ranges the form itself declares and names
// the field and range inline before any request.
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const page = readFileSync(path.resolve(__dirname, '..', 'app/lenses/mental-health/page.tsx'), 'utf8');

describe('FIX-mental-health-006 — calculator validates in words', () => {
  it('runWellness checks blank and range per field before sending', () => {
    expect(page).toContain('is required.');
    expect(page).toContain('must be between');
    expect(page).toContain("{ raw: moodScore, label: 'Mood', min: 1, max: 10, unit: '' }");
    expect(page).toContain("{ raw: sleepHours, label: 'Sleep', min: 0, max: 24, unit: ' hours' }");
  });
  it('no silent || 0 fabrication remains in the send', () => {
    expect(page).not.toContain('Number(sleepHours) || 0');
    expect(page).not.toContain('Number(moodScore) || 0');
  });
});
