/**
 * FIX-marketplace-008 — at 390 px the browse rail (a fixed 288 px
 * column beside the content) left the main column ~78 px and the
 * Shop Manager sidebar kept 192 px, squeezing/covering content.
 * The browse layout stacks on mobile; the sidebar collapses to an
 * icon rail with named buttons below sm.
 */
import { describe, it, expect } from 'vitest';
import * as fs from 'node:fs';
import * as path from 'node:path';

const read = (p: string) => fs.readFileSync(path.join(process.cwd(), p), 'utf8');

describe('FIX-marketplace-008 — mobile layout', () => {
  it('browse stacks the rail below the content on mobile', () => {
    const s = read('components/marketplace/BrowsePanel.tsx');
    expect(s).toContain('flex flex-col gap-6 items-start lg:flex-row');
    expect(s).toContain('w-full shrink-0 space-y-4 lg:sticky lg:top-4 lg:w-72');
  });

  it('shop sidebar is an icon rail below sm', () => {
    const s = read('components/marketplace/ShopfrontShell.tsx');
    expect(s).toContain('w-14 sm:w-48');
    expect(s).toContain('aria-label={n.label}');
    expect(s).toContain('min-w-0 flex-1 overflow-y-auto');
  });
});
