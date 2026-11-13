/**
 * FIX-byo-keys-013 (catalog legs) — the OpenRouter catalog was
 * hard-capped at the first 100 rows, unsortable, and rows were not
 * selectable. It now pages with Show more, offers sort orders, and
 * rows open a detail view. (The custom-provider label leg has no
 * substrate in-tree — the provider catalog is a static built-in
 * list — and is named for the desk as a feature build.)
 */
import { describe, it, expect } from 'vitest';
import * as fs from 'node:fs';
import * as path from 'node:path';

const read = (p: string) => fs.readFileSync(path.join(process.cwd(), p), 'utf8');

describe('FIX-byo-keys-013 — catalog browsing', () => {
  const s = read('components/byo-keys/OpenRouterCatalog.tsx');

  it('pages instead of hard-capping at 100', () => {
    expect(s).not.toContain('.slice(0, 100)');
    expect(s).toContain('Show more models');
    expect(s).toContain('showing {filtered.length} of {matched.length} matching');
  });

  it('offers sort orders and clickable rows with a detail view', () => {
    expect(s).toContain('aria-label="Sort models"');
    expect(s).toContain('Context, largest first');
    expect(s).toContain('aria-label={`Details for ${m.id}`}');
    expect(s).toContain('Model details:');
  });
});
