import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

// Pin test (FIX-social-010, duplicate-controls + badge legs): on a phone
// the header cluster repeated the Inbox place's unread count with a second
// control (the topbar bell) and, being shrink-0, pushed the LIVE badge past
// the clipped page edge. The fix hides the bell below lg (the Inbox place
// carries the count there) and lets the cluster shrink/wrap whole.
// Source-level pins: the defects were class/placement strings in the page.
const src = readFileSync(join(__dirname, 'page.tsx'), 'utf8');

describe('Social header at phone width (FIX-social-010)', () => {
  it('the header cluster can shrink instead of protruding', () => {
    expect(src).toContain('flex min-w-0 flex-wrap items-center gap-2 pt-2');
    expect(src).not.toContain('flex shrink-0 flex-wrap items-center gap-2 pt-2');
  });

  it('the notification bell is desktop-only; the Inbox place carries the count on phones', () => {
    const bell = src.match(/<span className="hidden lg:inline-flex">\s*<NotificationBell/);
    expect(bell).not.toBeNull();
  });
});
