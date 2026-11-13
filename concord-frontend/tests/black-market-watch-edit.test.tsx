/**
 * FIX-black-market-012 — saved Watchlist searches could only be
 * removed, never edited. A watch-update action now sits beside
 * watch-add/remove with the same validation (caller's own watch
 * only, duplicate guard excluding itself), and each saved search
 * row carries an edit control with an inline form.
 */
import { describe, it, expect } from 'vitest';
import * as fs from 'node:fs';
import * as path from 'node:path';

const read = (p: string) => fs.readFileSync(path.join(process.cwd(), p), 'utf8');

describe('FIX-black-market-012 — editable saved searches', () => {
  it('server registers watch-update with add-parity validation', () => {
    const s = read('../server/domains/black-market.js');
    expect(s).toContain('registerLensAction("black-market", "watch-update"');
    expect(s).toContain('w.id !== watchId && w.keyword === keyword');
  });

  it('each saved search offers edit, save and cancel', () => {
    const s = read('components/black-market/UndergroundExchange.tsx');
    expect(s).toContain('Edit watch ${w.keyword}');
    expect(s).toContain("'watch-update'");
    expect(s).toContain('Edit watch max price');
  });
});
