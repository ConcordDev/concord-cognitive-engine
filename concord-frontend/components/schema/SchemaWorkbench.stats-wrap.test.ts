// FIX-schema-012: at 390px the Registry entry's stats row was squeezed by the
// History/Edit/delete cluster and the first stat broke mid-phrase
// ("2 / fields"). Source-pin (the defect is absent wrap control on
// data-driven markup): the stats row wraps as whole units and no stat
// may break internally.
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const SRC = readFileSync(join(__dirname, 'SchemaWorkbench.tsx'), 'utf8');

describe('SchemaWorkbench registry stats at phone width (FIX-schema-012)', () => {
  it('the stats row wraps as whole units', () => {
    expect(SRC).toContain('mt-1 flex flex-wrap gap-x-3 gap-y-0.5 text-[10px] text-zinc-400');
  });

  it('no stat breaks mid-phrase', () => {
    expect(SRC).toContain('<span className="whitespace-nowrap">{s.fieldCount} fields</span>');
    expect(SRC).toContain('<span className="whitespace-nowrap">{s.versionCount} version');
    expect(SRC).toContain('<span className="whitespace-nowrap">updated ');
  });
});
