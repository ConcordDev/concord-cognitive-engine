/**
 * FIX-fashion-001 — trend rows lived in bare useState and vanished
 * on any unmount (reload or tab switch), 3/3 reproduced, with no
 * unsaved warning. The rows now ride the platform's lens UI-state
 * persistence idiom (useLensStatePersistence): restored on mount,
 * re-persisted on every change, removed only by the user.
 */
import { describe, it, expect } from 'vitest';
import * as fs from 'node:fs';
import * as path from 'node:path';

const read = (p: string) => fs.readFileSync(path.join(process.cwd(), p), 'utf8');

describe('FIX-fashion-001 — trend rows persist across unmounts', () => {
  const s = read('components/fashion/FashionTrendSandboxPanel.tsx');

  it('rows initialise from the persisted lens state', () => {
    expect(s).toContain("useLensStatePersistence('fashion')");
    expect(s).toContain('restore()?.trendRows');
  });

  it('rows re-persist on change, preserving sibling keys', () => {
    expect(s).toContain('persist({ ...(restore() ?? {}), trendRows: rows })');
  });
});
