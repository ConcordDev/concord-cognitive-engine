/**
 * Forestry full-lens build — surface honesty pins (source-level; the
 * live behaviour pass is Product Review's re-pass on the deployed lens).
 *
 * S1: a failed fire load states itself in the view in product words, per
 * source, and the "Live wildfire" claims are off every surface.
 * S3: surfaces display the stand ID the forms accept.
 * S4: stand Delete asks first; validation sees pasted values.
 * F3: the GBIF panel names the query and the source when it has nothing.
 */

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const here = dirname(fileURLToPath(import.meta.url));
const read = (rel: string) => readFileSync(join(here, '..', rel), 'utf8');

describe('Forestry S1 — fire-data honesty at the surface', () => {
  const fire = read('components/forestry/FireIncidents.tsx');
  it('states an InciWeb failure in the view, in product words', () => {
    expect(fire).toContain("Couldn't reach InciWeb");
    expect(fire).toContain('firesError');
    expect(fire).not.toContain('inciweb ${');
  });
  it('fails the NIFC perimeter source independently of the incident list', () => {
    expect(fire).toContain('perimError');
    expect(fire).toContain("Couldn't load fire perimeters");
    expect(fire).not.toContain('No mapped perimeters currently in the NIFC feed.');
  });
  it('an empty result is stated as an empty result, with its pull time', () => {
    expect(fire).toContain('reports no active incidents');
    expect(fire).toContain('firesPulledAt');
  });
  it('the "Live wildfire" claims are off the tab, the feed strip and the panel header', () => {
    expect(read('app/lenses/forestry/page.tsx')).not.toContain('Live wildfire');
    expect(read('components/forestry/StandManager.tsx')).not.toContain('Live wildfire feed');
    expect(fire).not.toContain('Live wildfire');
  });
  it('the feed strip can present a product-worded failure', () => {
    expect(read('components/lens/LensFeedButton.tsx')).toContain('errorText');
    expect(read('components/forestry/StandManager.tsx')).toContain('The wildfire feed is unavailable');
  });
});

describe('Forestry S3/S4 — stand identity and small completions', () => {
  it('the stand row displays the stand ID its forms accept', () => {
    expect(read('components/forestry/StandManager.tsx')).toContain('stand id {st.id}');
  });
  it('stand Delete asks for confirmation before it fires', () => {
    const sm = read('components/forestry/StandManager.tsx');
    expect(sm).toContain('confirmDelete');
    expect(sm).toContain('Delete stand');
  });
  it('replanting links a project through a stand picker fed by stand-list', () => {
    const rp = read('components/forestry/ReplantingPanel.tsx');
    expect(rp).toContain('stand-list');
    expect(rp).toContain('Stand (optional)');
  });
  it('workbench validation falls back to the live DOM value (paste)', () => {
    const ap = read('components/forestry/ForestryActionPanel.tsx');
    expect(ap).toContain('acresRef.current?.value');
    expect(ap).toContain('treesRef.current?.value');
  });
});

describe('Forestry F3 — GBIF panel states its empties', () => {
  const gbif = read('components/environment/GbifPanel.tsx');
  it('names the query and the source when nothing matches', () => {
    expect(gbif).toContain('No GBIF match for');
    // Both folded PRs (#2168 environment, #2175 forestry) fixed this empty; the combined
    // build keeps environment's wording for the matched-but-no-records case.
    expect(gbif).toContain('No occurrences with coordinates recorded for');
  });
  it('does not leak the raw failure reason to the user', () => {
    expect(gbif).not.toContain('GBIF unreachable ({error})');
  });
});
