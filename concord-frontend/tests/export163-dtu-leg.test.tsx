// GB-1538 F1 — the .dtu leg of FIX-home-improvement-013 · FIX-organ-002 ·
// FIX-transfer-002: the three lens pages handed the realtime FEED to
// DTUExportButton as the export payload, so the .dtu bundle wrapped feed
// data (for home-improvement, the public recall feed) instead of the
// caller's own records. The pages now pass an empty payload; the button's
// designed empty path loads the caller's own lens export rows itself.

import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';

const PAGES: Record<string, string> = {
  'home-improvement': 'app/lenses/home-improvement/page.tsx',
  organ: 'app/lenses/organ/page.tsx',
  transfer: 'app/lenses/transfer/page.tsx',
};

function readPage(rel: string): string {
  const here = path.dirname(new URL(import.meta.url).pathname);
  return fs.readFileSync(path.join(here, '..', rel), 'utf8');
}

describe('export .dtu leg: pages export the caller\u2019s records, not the realtime feed', () => {
  for (const [domain, rel] of Object.entries(PAGES)) {
    it(`${domain}: DTUExportButton receives an empty payload, never realtimeData`, () => {
      const src = readPage(rel);
      const buttonLine = src.split('\n').find((l) => l.includes('DTUExportButton') && l.includes('domain='));
      expect(buttonLine, `${domain} page should mount DTUExportButton`).toBeTruthy();
      expect(buttonLine).toContain('data={{}}');
      expect(buttonLine).not.toContain('realtimeData');
    });
  }
});
