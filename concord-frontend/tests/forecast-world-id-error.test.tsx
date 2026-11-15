/**
 * FIX-forecast-006 — an unknown World id gave no error: the run
 * returned without error text, refresh() only set an error when the
 * payload carried one, and the weather card silently disappeared
 * into a generic empty state. Both load paths now fall back to a
 * worded error naming the world id, and the empty state names the
 * id it looked up.
 */
import { describe, it, expect } from 'vitest';
import * as fs from 'node:fs';
import * as path from 'node:path';

const read = (p: string) => fs.readFileSync(path.join(process.cwd(), p), 'utf8');

describe('FIX-forecast-006 — unknown world id is worded', () => {
  const s = read('app/lenses/forecast/page.tsx');

  it('refresh falls back to a worded error naming the id', () => {
    expect(s).toContain('No forecast could be loaded for world "${worldId}" — the world id may not exist.');
  });

  it('compose falls back to a worded error naming the id', () => {
    expect(s).toContain('Couldn\'t compose a forecast for world "${worldId}" — the world id may not exist.');
  });

  it('the empty state names the world id', () => {
    expect(s).toContain('No forecast yet for world');
    expect(s).toContain('{worldId}');
  });
});
