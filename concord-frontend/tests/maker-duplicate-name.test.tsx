/**
 * FIX-maker-001 — the duplicate-name hint becomes a refusal.
 * Source pins in the maker-build.test.tsx style; the store-level
 * behaviour is pinned in server/tests/maker-domain.test.js.
 */
import { describe, it, expect } from 'vitest';
import * as fs from 'node:fs';
import * as path from 'node:path';

const page = fs.readFileSync(
  path.resolve(__dirname, '../app/lenses/maker/page.tsx'),
  'utf8',
);
const domain = fs.readFileSync(
  path.resolve(__dirname, '../../server/domains/maker.js'),
  'utf8',
);

describe('maker duplicate names (FIX-maker-001)', () => {
  it('the create path refuses a duplicate before calling the server', () => {
    expect(page).toContain('if (isDuplicateName(trimmed, makes))');
    expect(page).toContain("setActionError('A make with this name is already on the bench.')");
  });

  it('the rename path refuses onto a sibling name', () => {
    expect(page).toContain('if (isDuplicateName(title, makes, editingId))');
  });

  it('the hint still shows while typing', () => {
    expect(page).toContain('A make with this name is already on the bench.</p>');
  });

  it('server refusals surface their words through errorFrom', () => {
    expect(page).toContain('data?.result?.error');
  });

  it('the store refuses duplicates on create and rename', () => {
    expect(domain).toContain('reason: "duplicate_name"');
    expect(domain).toContain('LOWER(name) = LOWER(?)');
  });
});
