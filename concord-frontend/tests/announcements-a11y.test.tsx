/**
 * FIX-announcements-002 — two legs. Contrast: the page's one faint
 * text ("Publishing is admin-only") sat at zinc-500; the cards,
 * rail and compose panel already use zinc-400. Raised to zinc-400.
 * Mobile chips: the kind filter renders through NorthStarFrame's
 * tab strip, which at branch head already scrolls sideways with a
 * fade affordance (the shared strip fix) instead of clipping — the
 * leg is discharged by that shared fix and pinned here as
 * verify-only: the page must keep routing its filter through the
 * frame's tabs.
 */
import { describe, it, expect } from 'vitest';
import * as fs from 'node:fs';
import * as path from 'node:path';

const read = (p: string) => fs.readFileSync(path.join(process.cwd(), p), 'utf8');

describe('FIX-announcements-002 — announcements contrast + chip strip', () => {
  it('no zinc-500 text remains in the announcements surface', () => {
    for (const f of ['app/lenses/announcements/page.tsx', 'components/announcements/AnnouncementCard.tsx', 'components/announcements/RoadmapRail.tsx', 'components/announcements/ComposePanel.tsx']) {
      expect(read(f).includes('text-zinc-500'), `${f} zinc-500`).toBe(false);
    }
    expect(read('app/lenses/announcements/page.tsx')).toContain('Publishing is admin-only');
  });

  it('the kind filter rides the frame tab strip (verify-only, shared fix)', () => {
    const page = read('app/lenses/announcements/page.tsx');
    expect(page).toContain('tabsLabel="Filter by kind"');
    const frame = read('components/lens/NorthStarFrame.tsx');
    expect(frame).toContain('overflow-x-auto');
    expect(frame).toContain('data-fade-right');
  });
});
