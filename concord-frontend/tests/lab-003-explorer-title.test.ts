// FIX-lab-003 — explorer constraints were sent unvalidated (NaN
// poisoned the range, min >= max "explored" a range that cannot vary,
// and a half-blank named constraint was silently dropped), and the
// New Entry title had no maxlength while the server silently sliced
// it to 200. Pins for the form-side guards.
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const page = readFileSync(path.resolve(__dirname, '..', 'app/lenses/lab/page.tsx'), 'utf8');
const eln = readFileSync(path.resolve(__dirname, '..', 'components/lab/ELNWorkbench.tsx'), 'utf8');

describe('FIX-lab-003 — explorer + title validation', () => {
  it('explorer refuses non-numeric and inverted constraints in words, naming the parameter', () => {
    expect(page).toContain('needs a numeric min and max.');
    expect(page).toContain('min must be less than max.');
    expect(page).not.toContain('if (c.key.trim() && c.min && c.max)');
  });
  it('entry title input carries the 200 cap and create states it', () => {
    expect(eln).toContain('maxLength={200}');
    expect(eln).toContain('Entry title must be 200 characters or fewer.');
  });
});
