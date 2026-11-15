/**
 * Sim toolkit outcome visibility (FIX-sim-010).
 * Goal Seek's result rendered below the viewport and Calibrate's run
 * showed no visible result: both tools render their outcome below a
 * long form and nothing brought it into view, so a successful run
 * read as "nothing happened" (the macros themselves return sound
 * results on the panels' default inputs — verified against the sim
 * domain). Both tools now anchor the outcome area and scroll it into
 * view when a result or an error lands.
 */
import { describe, it, expect } from 'vitest';
import * as fs from 'node:fs';
import * as path from 'node:path';

const src = fs.readFileSync(path.join(process.cwd(), 'components/sim/SimToolkit.tsx'), 'utf8');

describe('sim outcome visibility (FIX-sim-010)', () => {
  it('both Goal Seek and Calibrate scroll their outcome into view', () => {
    const anchors = src.match(/outcomeRef/g) || [];
    expect(anchors.length).toBeGreaterThanOrEqual(6); // 2 tools × (ref decl, effect use, JSX ref)
    expect(src).toContain("scrollIntoView({ behavior: 'smooth', block: 'nearest' })");
    const effects = src.match(/if \(res \|\| error\) outcomeRef\.current\?\.scrollIntoView/g) || [];
    expect(effects).toHaveLength(2);
  });
});
