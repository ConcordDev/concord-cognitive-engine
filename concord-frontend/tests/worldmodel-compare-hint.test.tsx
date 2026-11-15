/**
 * WorldModel Compare hint render (FIX-worldmodel-006, panel half).
 * When compare_scenarios reports that both sides were configured the
 * same, the panel must surface that hint next to the verdict instead
 * of leaving a bare "no net difference" to confuse.
 */
import { describe, it, expect } from 'vitest';
import * as fs from 'node:fs';
import * as path from 'node:path';

const src = fs.readFileSync(path.join(process.cwd(), 'components/worldmodel/ComparePanel.tsx'), 'utf8');

describe('worldmodel compare hint render (FIX-worldmodel-006)', () => {
  it('renders the server hint when present', () => {
    expect(src).toContain('hint?: string | null');
    expect(src).toContain('text-amber-400');
  });
});
