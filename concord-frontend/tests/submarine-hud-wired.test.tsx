// Phase CA2 — confirm SubmarineHUD polls dive-state.

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const FILE = path.resolve(__dirname, '..', 'components', 'world', 'SubmarineHUD.tsx');

describe('Phase CA2 — Submarine HUD wired to dive-state', () => {
  const source = readFileSync(FILE, 'utf8');

  it('polls /api/players/me/dive-state', () => {
    expect(source).toMatch(/\/api\/players\/me\/dive-state/);
  });

  it('reads oxygen_pct, swim_depth, max_depth_explored, drowningDamage', () => {
    expect(source).toMatch(/oxygenPct/);
    expect(source).toMatch(/swimDepth/);
    expect(source).toMatch(/maxDepthExplored/);
    expect(source).toMatch(/drowningDamage/);
  });

  it('renders sonar contacts list', () => {
    expect(source).toMatch(/sonarContacts/);
    expect(source).toMatch(/Sonar/);
  });

  it('flips colors at 30% (lowOx) and 10% (criticalOx)', () => {
    expect(source).toMatch(/oxygenPct < 30/);
    expect(source).toMatch(/oxygenPct < 10/);
    expect(source).toMatch(/CRITICAL/);
  });
});
