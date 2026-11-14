// GB-1539 §16 / FIX-urban-planning-005 — the .dtu leg: the urban-planning
// page handed DTUExportButton the dashboard COUNTS object as the export
// payload, so when counts were loaded the .dtu bundle wrapped counts
// instead of the caller's own parcels/scenarios/projects. Under the
// shared-exporter ruling (an export carries exactly the user's lens
// content) the page now passes an empty payload; the button's designed
// empty path loads the caller's own lens export rows itself. The counts
// state itself is untouched — the dashboard still renders from it.

import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';

function readPage(rel: string): string {
  const here = path.dirname(new URL(import.meta.url).pathname);
  return fs.readFileSync(path.join(here, '..', rel), 'utf8');
}

describe('export .dtu leg: urban-planning exports the caller’s records, not the dashboard counts', () => {
  it('DTUExportButton receives an empty payload, never the counts object', () => {
    const src = readPage('app/lenses/urban-planning/page.tsx');
    const buttonLine = src.split('\n').find((l) => l.includes('DTUExportButton') && l.includes('domain='));
    expect(buttonLine, 'urban-planning page should mount DTUExportButton').toBeTruthy();
    expect(buttonLine).toContain('data={{}}');
    expect(buttonLine).not.toContain('counts');
  });
});
