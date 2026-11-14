/**
 * Patients panel sort control (FIX-healthcare-011, panel half).
 * The panel had search but no way to sort; it now offers Name / MRN
 * ordering and renders the sorted rows.
 */
import { describe, it, expect } from 'vitest';
import * as fs from 'node:fs';
import * as path from 'node:path';

const src = fs.readFileSync(path.join(process.cwd(), 'components/healthcare/PatientsPanel.tsx'), 'utf8');

describe('healthcare patients sort (FIX-healthcare-011)', () => {
  it('offers a Name/MRN sort control and renders sorted rows', () => {
    expect(src).toContain('aria-label="Sort patients"');
    expect(src).toContain('Sort: MRN');
    expect(src).toContain('sorted.map');
  });
});
