// Mobile phase 2: pins the lens-local responsive shapes (390px) so they cannot silently regress.
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const read = (p: string) => readFileSync(join(__dirname, '..', p), 'utf8');

describe('mobile phase 2 lens layout', () => {
  it.each(['forum', 'lab', 'wallet'])('%s page does not pin 32px side padding on phones', (l) => {
    const src = read(`app/lenses/${l}/page.tsx`);
    expect(src).not.toMatch(/(^|[\s"'`])px-8(?=[\s"'`])/m);
    expect(src).toMatch(/px-4[^"']*sm:px-6 lg:px-8/);
  });

  it.each(['forum', 'lab'])('%s header stacks below sm instead of squeezing the title', (l) => {
    const src = read(`app/lenses/${l}/page.tsx`);
    expect(src).toContain('flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between');
    expect(src).not.toMatch(/flex shrink-0[^"]*items-center gap-3 pt-2/);
  });

  it('forum FAB clears the mobile nav and the help button', () => {
    const src = read('app/lenses/forum/page.tsx');
    expect(src).toContain('bottom-[calc(4rem+env(safe-area-inset-bottom,0px))]');
    expect(src).toContain('right-[4.75rem]');
    expect(src).not.toContain('fixed bottom-8 right-8');
  });

  it('logistics form/filter grids collapse to 2 columns on phones and keep their desktop width at lg', () => {
    for (const f of ['LoadBoardPanel', 'PickupsPanel', 'RateQuoter', 'ShipmentsPanel', 'CarriersPanel', 'FleetVehiclesPanel', 'DockAppointmentsPanel']) {
      const src = read(`components/logistics/${f}.tsx`);
      expect(src, f).toMatch(/grid-cols-2 sm:grid-cols-3 lg:grid-cols-[56]/);
      // a base col-span >= 3 inside a 2-col grid spawns implicit columns
      expect(src, f).not.toMatch(/(^|[\s"'`])col-span-[3-6](?=[\s"'`])/m);
    }
  });
});
